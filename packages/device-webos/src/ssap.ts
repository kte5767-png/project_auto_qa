import WebSocket from 'ws';

/**
 * SSAP(LG TV 원격 제어 웹소켓) 클라이언트 (D-023).
 * - 최초 1회 페어링: TV 화면에 허용 창이 뜨고, 허용하면 client-key를 받는다. 이후에는 key로 바로 등록된다.
 * - 리모컨 버튼(방향키·OK·Back·Home)은 포인터 입력 소켓으로 보낸다. 실제 리모컨과 같은 시스템 경로다.
 * TV의 보안 포트(3001)는 자체 서명 인증서를 쓰므로 이 연결에 한해 인증서 검증을 끈다.
 */

export interface SsapManifest {
	manifestVersion: number;
	appVersion: string;
	permissions: string[];
	[key: string]: unknown;
}

/**
 * 기본 manifest (서명 없음). 리모컨 입력에 필요한 권한만 요청한다.
 * TV가 이 manifest로 포인터 입력을 허용하지 않으면 WEBOS_SSAP_MANIFEST로 다른 manifest 파일을 지정한다.
 */
export const DEFAULT_SSAP_MANIFEST: SsapManifest = {
	manifestVersion: 1,
	appVersion: '1.0',
	permissions: [
		'LAUNCH',
		'CONTROL_INPUT_JOYSTICK',
		'CONTROL_MOUSE_AND_KEYBOARD',
		'READ_INSTALLED_APPS',
		'READ_RUNNING_APPS',
		'READ_INPUT_DEVICE_LIST',
		'READ_NETWORK_STATE',
		'READ_TV_INFO'
	]
};

export const POINTER_SOCKET_URI = 'ssap://com.webos.service.networkinput/getPointerInputSocket';

export class SsapError extends Error {
	override name = 'SsapError';
}

export interface SsapMessage {
	type: string;
	id?: string;
	payload?: Record<string, unknown>;
	error?: string;
}

export function registerMessage(id: string, clientKey: string | null, manifest: SsapManifest): SsapMessage {
	const payload: Record<string, unknown> = { forcePairing: false, pairingType: 'PROMPT', manifest };
	if (clientKey !== null) payload['client-key'] = clientKey;
	return { type: 'register', id, payload };
}

export function requestMessage(
	id: string,
	uri: string,
	payload: Record<string, unknown> = {}
): SsapMessage & { uri: string } {
	return { type: 'request', id, uri, payload };
}

/** 포인터 소켓 버튼 프레임. JSON이 아니라 `type:button\nname:UP\n\n` 형식이며 끝의 빈 줄이 필요하다. */
export function buttonFrame(name: string): string {
	if (!/^[A-Z0-9_]+$/.test(name)) throw new SsapError(`버튼 이름 형식이 올바르지 않습니다: ${name}`);
	return `type:button\nname:${name}\n\n`;
}

function openSocket(url: string, timeoutMs: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, {
			rejectUnauthorized: false,
			perMessageDeflate: false,
			handshakeTimeout: timeoutMs
		});
		const onError = (error: Error): void => {
			ws.removeAllListeners();
			ws.terminate();
			reject(error);
		};
		ws.once('open', () => {
			ws.off('error', onError);
			resolve(ws);
		});
		ws.once('error', onError);
	});
}

export interface SsapConnectOptions {
	securePort?: number;
	plainPort?: number;
	timeoutMs?: number;
}

export class PointerSocket {
	constructor(private readonly ws: WebSocket) {}

	button(name: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.ws.send(buttonFrame(name), (error) =>
				error === undefined || error === null ? resolve() : reject(error)
			);
		});
	}

	close(): void {
		this.ws.close();
	}
}

export class SsapClient {
	private nextId = 1;
	private readonly pending = new Map<string, (message: SsapMessage) => void>();
	private closedError: Error | null = null;

	private constructor(
		private readonly ws: WebSocket,
		readonly url: string
	) {
		ws.on('message', (data) => {
			let message: SsapMessage;
			try {
				message = JSON.parse(String(data)) as SsapMessage;
			} catch {
				return;
			}
			if (message.id !== undefined) this.pending.get(message.id)?.(message);
		});
		ws.on('close', () => {
			this.closedError = new SsapError('TV와의 SSAP 연결이 끊어졌습니다.');
		});
	}

	/** 보안 포트(wss) 먼저, 안 되면 일반 포트(ws)로 연결한다 */
	static async connect(host: string, options: SsapConnectOptions = {}): Promise<SsapClient> {
		const timeoutMs = options.timeoutMs ?? 5000;
		const urls = [`wss://${host}:${options.securePort ?? 3001}`, `ws://${host}:${options.plainPort ?? 3000}`];
		const errors: string[] = [];
		for (const url of urls) {
			try {
				return new SsapClient(await openSocket(url, timeoutMs), url);
			} catch (error) {
				errors.push(`${url}: ${(error as Error).message}`);
			}
		}
		throw new SsapError(
			`TV의 SSAP에 연결하지 못했습니다 (${errors.join(' / ')}). TV가 켜져 있는지, 설정 > 네트워크 > LG Connect Apps(모바일 TV 켜기)가 켜져 있는지 확인해 주세요.`
		);
	}

	private send(message: SsapMessage): void {
		if (this.closedError !== null) throw this.closedError;
		this.ws.send(JSON.stringify(message));
	}

	/** 같은 id로 오는 응답을 기다린다. accept가 true를 돌려주는 메시지에서 끝난다 */
	private waitFor(id: string, timeoutMs: number, accept: (m: SsapMessage) => boolean): Promise<SsapMessage> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new SsapError(`SSAP 응답 시간 초과 (${id})`));
			}, timeoutMs);
			this.pending.set(id, (message) => {
				if (message.type === 'error') {
					clearTimeout(timer);
					this.pending.delete(id);
					reject(new SsapError(`SSAP 오류: ${message.error ?? JSON.stringify(message.payload)}`));
					return;
				}
				if (accept(message)) {
					clearTimeout(timer);
					this.pending.delete(id);
					resolve(message);
				}
			});
		});
	}

	/**
	 * 등록. client-key가 없으면 TV에 허용 창이 뜬다 (onPrompt 호출). 허용하면 새 client-key를 돌려준다.
	 */
	async register(
		clientKey: string | null,
		manifest: SsapManifest = DEFAULT_SSAP_MANIFEST,
		options: { timeoutMs?: number; onPrompt?: () => void } = {}
	): Promise<string> {
		const id = `register_${this.nextId++}`;
		const waiting = this.waitFor(id, options.timeoutMs ?? 60_000, (m) => {
			if (m.type === 'response' && m.payload?.['pairingType'] === 'PROMPT') options.onPrompt?.();
			return m.type === 'registered';
		});
		this.send(registerMessage(id, clientKey, manifest));
		const message = await waiting;
		const key = message.payload?.['client-key'];
		if (typeof key !== 'string' || key === '') throw new SsapError('TV가 client-key를 주지 않았습니다.');
		return key;
	}

	async request<T extends Record<string, unknown>>(
		uri: string,
		payload: Record<string, unknown> = {},
		timeoutMs = 10_000
	): Promise<T> {
		const id = `req_${this.nextId++}`;
		const waiting = this.waitFor(id, timeoutMs, (m) => m.type === 'response');
		this.send(requestMessage(id, uri, payload));
		const message = await waiting;
		const result = (message.payload ?? {}) as T;
		if (result['returnValue'] === false) {
			throw new SsapError(`SSAP 요청 실패 ${uri}: ${String(result['errorText'] ?? JSON.stringify(result))}`);
		}
		return result;
	}

	/** 포인터 입력 소켓을 연다 (리모컨 버튼 입력용) */
	async openPointerSocket(timeoutMs = 5000): Promise<PointerSocket> {
		const result = await this.request<{ socketPath?: unknown }>(POINTER_SOCKET_URI);
		if (typeof result.socketPath !== 'string') {
			throw new SsapError(
				'포인터 입력 소켓 주소를 받지 못했습니다. manifest 권한(CONTROL_INPUT_JOYSTICK 등)을 확인해 주세요.'
			);
		}
		return new PointerSocket(await openSocket(result.socketPath, timeoutMs));
	}

	close(): void {
		this.ws.close();
	}
}
