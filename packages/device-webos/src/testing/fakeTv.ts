/**
 * 테스트용 가짜 TV: SSAP 서버(등록·포인터 소켓)와 Web Inspector(CDP) 서버를 흉내 낸다.
 * 실제 TV 없이 드라이버·스파이크 흐름을 검증하는 데 쓴다.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';

export interface FakeSsapOptions {
	/** 듣는 포트 (기본: 빈 포트) */
	port?: number;
	/** 이 키면 허용 창 없이 등록 */
	knownClientKey?: string;
	/** 새로 발급할 키 */
	issuedClientKey?: string;
	/** 등록 요청을 거절 */
	rejectRegistration?: boolean;
	/** 포인터 소켓 요청을 거절 (권한 부족 흉내) */
	denyPointer?: boolean;
	/** 버튼을 받으면 호출 */
	onButton?: (name: string) => void;
}

export interface FakeSsap {
	port: number;
	prompts: number;
	buttons: string[];
	registrations: Record<string, unknown>[];
	close(): Promise<void>;
}

/** 일반(ws) SSAP 서버. 경로 /pointer 가 포인터 소켓이다 */
export async function startFakeSsap(options: FakeSsapOptions = {}): Promise<FakeSsap> {
	const http = createServer();
	const wss = new WebSocketServer({ server: http });
	const state: FakeSsap = {
		port: 0,
		prompts: 0,
		buttons: [],
		registrations: [],
		close: () =>
			new Promise((resolve) => {
				for (const client of wss.clients) client.terminate();
				wss.close(() => http.close(() => resolve()));
			})
	};
	wss.on('connection', (ws: WebSocket, req) => {
		if (req.url === '/pointer') {
			ws.on('message', (data) => {
				const text = String(data);
				const match = /^type:button\nname:([A-Z0-9_]+)\n\n$/.exec(text);
				if (match?.[1] !== undefined) {
					state.buttons.push(match[1]);
					options.onButton?.(match[1]);
				}
			});
			return;
		}
		ws.on('message', (data) => {
			const message = JSON.parse(String(data)) as {
				type: string;
				id: string;
				uri?: string;
				payload?: Record<string, unknown>;
			};
			if (message.type === 'register') {
				state.registrations.push(message.payload ?? {});
				if (options.rejectRegistration === true) {
					ws.send(JSON.stringify({ type: 'error', id: message.id, error: '403 cancelled' }));
					return;
				}
				const key = message.payload?.['client-key'];
				if (key !== options.knownClientKey || key === undefined) {
					state.prompts++;
					ws.send(
						JSON.stringify({
							type: 'response',
							id: message.id,
							payload: { pairingType: 'PROMPT', returnValue: true }
						})
					);
				}
				const issued =
					key === options.knownClientKey && key !== undefined ? key : (options.issuedClientKey ?? 'new-key');
				setTimeout(() => {
					ws.send(JSON.stringify({ type: 'registered', id: message.id, payload: { 'client-key': issued } }));
				}, 5);
				return;
			}
			if (message.type === 'request' && message.uri?.endsWith('getPointerInputSocket') === true) {
				const payload =
					options.denyPointer === true
						? { returnValue: false, errorText: '401 insufficient permissions' }
						: { returnValue: true, socketPath: `ws://127.0.0.1:${state.port}/pointer` };
				ws.send(JSON.stringify({ type: 'response', id: message.id, payload }));
			}
		});
	});
	await new Promise<void>((resolve) => http.listen(options.port ?? 0, '127.0.0.1', resolve));
	state.port = (http.address() as AddressInfo).port;
	return state;
}

export interface FakeInspectorOptions {
	targets?: { id: string; title: string; url: string; type?: string }[];
	/** Runtime.evaluate 처리. 값을 돌려주거나 Error를 던지면 예외 결과로 응답 */
	evaluate?: (expression: string) => unknown;
	/** 다른 CDP 메서드 처리 */
	onMethod?: (method: string, params: Record<string, unknown>) => unknown;
	/** /json/list 대신 /json만 지원하는 구형 서버 흉내 */
	legacyListPath?: boolean;
	/** webSocketDebuggerUrl의 호스트를 127.0.0.1 대신 이 값으로 (TV가 다른 주소를 알려 주는 경우) */
	advertisedHost?: string;
}

export interface FakeInspector {
	port: number;
	methods: string[];
	close(): Promise<void>;
}

export async function startFakeInspector(options: FakeInspectorOptions = {}): Promise<FakeInspector> {
	const targets = options.targets ?? [
		{
			id: 'page-1',
			title: 'com.autoqa.sampletvapp',
			url: 'file:///media/developer/apps/usr/palm/applications/com.autoqa.sampletvapp/index.html'
		}
	];
	const state: FakeInspector = { port: 0, methods: [], close: () => Promise.resolve() };
	const http = createServer((req, res) => {
		const listPath = options.legacyListPath === true ? '/json' : '/json/list';
		if (req.url === listPath || (options.legacyListPath !== true && req.url === '/json')) {
			const host = options.advertisedHost ?? '127.0.0.1';
			res.setHeader('content-type', 'application/json');
			res.end(
				JSON.stringify(
					targets.map((t) => ({
						id: t.id,
						type: t.type ?? 'page',
						title: t.title,
						url: t.url,
						webSocketDebuggerUrl: `ws://${host}:${state.port}/devtools/page/${t.id}`
					}))
				)
			);
			return;
		}
		if (req.url === '/json/version') {
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({ Browser: 'Chrome/68.0.3440.106', 'Protocol-Version': '1.3' }));
			return;
		}
		res.statusCode = 404;
		res.end('not found');
	});
	const wss = new WebSocketServer({ server: http });
	wss.on('connection', (ws: WebSocket) => {
		ws.on('message', (data) => {
			const message = JSON.parse(String(data)) as {
				id: number;
				method: string;
				params?: Record<string, unknown>;
			};
			state.methods.push(message.method);
			const reply = (result: unknown): void => {
				ws.send(JSON.stringify({ id: message.id, result }));
			};
			if (message.method === 'Runtime.evaluate') {
				const expression = String(message.params?.['expression'] ?? '');
				try {
					const value = options.evaluate === undefined ? null : options.evaluate(expression);
					reply({ result: { type: typeof value, value } });
				} catch (error) {
					reply({
						result: { type: 'object', subtype: 'error' },
						exceptionDetails: { text: 'Uncaught', exception: { description: (error as Error).message } }
					});
				}
				return;
			}
			if (message.method === 'Page.captureScreenshot') {
				reply({ data: Buffer.from('fake-image').toString('base64') });
				return;
			}
			const custom = options.onMethod?.(message.method, message.params ?? {});
			reply(custom ?? {});
		});
	});
	state.close = () =>
		new Promise((resolve) => {
			for (const client of wss.clients) client.terminate();
			wss.close(() => http.close(() => resolve()));
		});
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	state.port = (http.address() as AddressInfo).port;
	return state;
}

/** 아무도 듣지 않는 포트 (연결 거부 흉내) */
export async function closedPort(): Promise<number> {
	const http = createServer();
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	const port = (http.address() as AddressInfo).port;
	await new Promise<void>((resolve) => http.close(() => resolve()));
	return port;
}
