import WebSocket from 'ws';

/**
 * 개발자 모드 앱 디버거(Web Inspector, TV IP:9998)에 CDP로 연결한다 (D-023).
 * 구형 엔진(Chromium 68)도 지원하는 기본 CDP 명령만 쓴다: Runtime.evaluate, Page.captureScreenshot, Input.dispatchKeyEvent.
 * 한 페이지에는 디버거 클라이언트가 하나만 붙을 수 있는 엔진이 있으므로, TV 앱에 DevTools 창이 열려 있으면 닫고 쓴다.
 */

export interface InspectorTarget {
	id: string;
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl: string | null;
}

export class InspectorError extends Error {
	override name = 'InspectorError';
}

export class ScriptError extends Error {
	override name = 'ScriptError';
}

type FetchLike = (
	url: string,
	init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

async function getJson(url: string, timeoutMs: number, fetchImpl: FetchLike): Promise<unknown> {
	const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) throw new InspectorError(`${url} → HTTP ${response.status}`);
	return JSON.parse(await response.text()) as unknown;
}

function toTarget(raw: unknown): InspectorTarget | null {
	if (raw === null || typeof raw !== 'object') return null;
	const t = raw as Record<string, unknown>;
	if (typeof t['id'] !== 'string') return null;
	return {
		id: t['id'],
		type: typeof t['type'] === 'string' ? t['type'] : 'page',
		title: typeof t['title'] === 'string' ? t['title'] : '',
		url: typeof t['url'] === 'string' ? t['url'] : '',
		webSocketDebuggerUrl: typeof t['webSocketDebuggerUrl'] === 'string' ? t['webSocketDebuggerUrl'] : null
	};
}

/** 디버깅 대상 목록. 구형 서버는 /json만 있으므로 /json/list 다음에 /json을 시도한다 */
export async function listTargets(
	host: string,
	port: number,
	options: { timeoutMs?: number; fetchImpl?: FetchLike } = {}
): Promise<InspectorTarget[]> {
	const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
	const timeoutMs = options.timeoutMs ?? 5000;
	let lastError: unknown = null;
	for (const path of ['/json/list', '/json']) {
		try {
			const data = await getJson(`http://${host}:${port}${path}`, timeoutMs, fetchImpl);
			if (Array.isArray(data)) return data.map(toTarget).filter((t): t is InspectorTarget => t !== null);
		} catch (error) {
			lastError = error;
		}
	}
	throw new InspectorError(
		`앱 디버거(${host}:${port})에 연결하지 못했습니다: ${(lastError as Error | null)?.message ?? '응답 없음'}. TV가 개발자 모드인지, 앱이 실행 중인지 확인해 주세요.`
	);
}

/** 엔진 정보 (/json/version). 구형 서버는 없을 수 있다 */
export async function inspectorVersion(
	host: string,
	port: number,
	options: { timeoutMs?: number; fetchImpl?: FetchLike } = {}
): Promise<Record<string, string> | null> {
	try {
		const data = await getJson(
			`http://${host}:${port}/json/version`,
			options.timeoutMs ?? 5000,
			options.fetchImpl ?? (fetch as unknown as FetchLike)
		);
		return data !== null && typeof data === 'object' ? (data as Record<string, string>) : null;
	} catch {
		return null;
	}
}

/** "Chrome/68.0.3440.106" 또는 User-Agent에서 Chromium 주 버전 */
export function chromiumMajor(text: string | undefined): number | null {
	const match = /Chrom(?:e|ium)\/(\d+)/.exec(text ?? '');
	return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * 검수 대상 앱의 페이지를 고른다. 앱 ID가 있으면 URL·제목에 그 ID가 있는 페이지만 (다른 앱을 잘못 잡지 않도록),
 * 앱 ID가 없으면 페이지가 하나일 때만 그 페이지.
 */
export function pickAppTarget(targets: readonly InspectorTarget[], appId: string | null): InspectorTarget | null {
	const pages = targets.filter((t) => t.type === 'page');
	if (appId !== null) {
		return pages.find((t) => t.url.includes(appId) || t.title.includes(appId)) ?? null;
	}
	return pages.length === 1 ? (pages[0] ?? null) : null;
}

/** TV가 알려 주는 웹소켓 주소의 호스트(127.0.0.1 등)를 실제 TV 주소로 바꾼다 */
export function normalizeDebuggerUrl(target: InspectorTarget, host: string, port: number): string {
	const raw = target.webSocketDebuggerUrl ?? `ws://${host}:${port}/devtools/page/${target.id}`;
	const url = new URL(raw);
	url.hostname = host;
	url.port = String(port);
	return url.toString();
}

interface CdpResponse {
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: { message?: string };
}

export class CdpConnection {
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }
	>();
	private readonly listeners = new Map<string, ((params: Record<string, unknown>) => void)[]>();
	private closed = false;

	private constructor(private readonly ws: WebSocket) {
		ws.on('message', (data) => {
			let message: CdpResponse;
			try {
				message = JSON.parse(String(data)) as CdpResponse;
			} catch {
				return;
			}
			if (message.id !== undefined) {
				const waiter = this.pending.get(message.id);
				if (waiter === undefined) return;
				this.pending.delete(message.id);
				if (message.error !== undefined) waiter.reject(new InspectorError(message.error.message ?? 'CDP 오류'));
				else waiter.resolve(message.result ?? {});
			} else if (message.method !== undefined) {
				for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
			}
		});
		ws.on('close', () => {
			this.closed = true;
			for (const waiter of this.pending.values())
				waiter.reject(new InspectorError('앱 디버거 연결이 끊어졌습니다.'));
			this.pending.clear();
		});
	}

	static connect(url: string, timeoutMs = 5000): Promise<CdpConnection> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: timeoutMs });
			ws.once('open', () => resolve(new CdpConnection(ws)));
			ws.once('error', (error) =>
				reject(
					new InspectorError(
						`앱 디버거 웹소켓 연결 실패 (${error.message}). TV 앱에 DevTools 창이 열려 있으면 닫고 다시 시도해 주세요.`
					)
				)
			);
		});
	}

	get isClosed(): boolean {
		return this.closed;
	}

	send(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<Record<string, unknown>> {
		if (this.closed) return Promise.reject(new InspectorError('앱 디버거 연결이 끊어졌습니다.'));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new InspectorError(`CDP 응답 시간 초과: ${method}`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (r) => {
					clearTimeout(timer);
					resolve(r);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				}
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	on(method: string, listener: (params: Record<string, unknown>) => void): void {
		this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
	}

	/** JS 식 평가. Promise면 기다리고, 결과는 JSON 값으로 받는다. 페이지 예외는 ScriptError */
	async evaluate<T>(expression: string, timeoutMs = 30_000): Promise<T> {
		const response = await this.send(
			'Runtime.evaluate',
			{ expression, returnByValue: true, awaitPromise: true },
			timeoutMs
		);
		const details = response['exceptionDetails'] as
			{ text?: string; exception?: { description?: string } } | undefined;
		if (details !== undefined) {
			throw new ScriptError(
				`페이지 스크립트 오류: ${details.exception?.description ?? details.text ?? '알 수 없음'}`
			);
		}
		const result = response['result'] as { value?: unknown } | undefined;
		return result?.value as T;
	}

	async captureScreenshot(type: 'png' | 'jpeg', quality?: number): Promise<Uint8Array> {
		const params: Record<string, unknown> = { format: type };
		if (type === 'jpeg') params['quality'] = quality ?? 70;
		const response = await this.send('Page.captureScreenshot', params);
		const data = response['data'];
		if (typeof data !== 'string') throw new InspectorError('화면 캡처 결과가 없습니다.');
		return new Uint8Array(Buffer.from(data, 'base64'));
	}

	close(): void {
		this.closed = true;
		this.ws.close();
	}
}
