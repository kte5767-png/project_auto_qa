import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 테스트·시연용 가짜 Ollama 서버 (실제 모델 없이 비교 도구 흐름을 확인).
 * 모델마다 응답 함수를 준다. 받은 요청은 requests에 쌓인다.
 */

export interface FakeChatRequest {
	model: string;
	messages: { role: string; content: string; images?: string[] }[];
	format?: unknown;
	options?: Record<string, unknown>;
	think?: unknown;
	keep_alive?: unknown;
}

export interface FakeModel {
	name: string;
	capabilities?: string[];
	sizeBytes?: number;
	/** 응답 내용 (JSON 문자열 등). 오류를 내려면 throw */
	reply: (request: FakeChatRequest) => string;
	/** 응답 하나의 가짜 소요 시간 (ms, 실제로 기다리지는 않음) */
	evalMs?: number;
}

export interface FakeOllama {
	url: string;
	requests: { path: string; body: unknown }[];
	loaded: Set<string>;
	close(): Promise<void>;
}

export async function startFakeOllama(models: readonly FakeModel[], version = '0.99.0-fake'): Promise<FakeOllama> {
	const requests: FakeOllama['requests'] = [];
	const loaded = new Set<string>();
	const byName = new Map(models.map((m) => [m.name, m]));
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const path = req.url ?? '/';
			let body: unknown;
			try {
				body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
			} catch {
				body = null;
			}
			requests.push({ path, body });
			const send = (status: number, data: unknown): void => {
				res.writeHead(status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(data));
			};
			const b = (body ?? {}) as Record<string, unknown>;
			const model = byName.get(String(b['model'] ?? ''));
			switch (path) {
				case '/api/version':
					return send(200, { version });
				case '/api/tags':
					return send(200, {
						models: models.map((m) => ({
							name: m.name,
							model: m.name,
							size: m.sizeBytes ?? 1e9,
							details: { family: 'fake', parameter_size: '1B', quantization_level: 'Q4_K_M' }
						}))
					});
				case '/api/show':
					if (model === undefined) return send(404, { error: `model '${String(b['model'])}' not found` });
					return send(200, {
						capabilities: model.capabilities ?? ['completion'],
						license: 'Apache License 2.0'
					});
				case '/api/ps':
					return send(200, {
						models: [...loaded].map((name) => ({
							name,
							model: name,
							size: byName.get(name)?.sizeBytes ?? 1e9,
							size_vram: 0,
							context_length: 4096
						}))
					});
				case '/api/generate':
					if (b['keep_alive'] === 0) loaded.delete(String(b['model']));
					return send(200, { model: b['model'], response: '', done: true, done_reason: 'unload' });
				case '/api/chat': {
					if (model === undefined) return send(404, { error: `model '${String(b['model'])}' not found` });
					const wasLoaded = loaded.has(model.name);
					loaded.add(model.name);
					let content: string;
					try {
						content = model.reply(b as unknown as FakeChatRequest);
					} catch (e) {
						return send(500, { error: e instanceof Error ? e.message : String(e) });
					}
					const evalNs = (model.evalMs ?? 100) * 1e6;
					return send(200, {
						model: model.name,
						created_at: new Date(0).toISOString(),
						message: { role: 'assistant', content },
						done: true,
						done_reason: 'stop',
						total_duration: evalNs + (wasLoaded ? 0 : 5e8),
						load_duration: wasLoaded ? 0 : 5e8,
						prompt_eval_count: 100,
						prompt_eval_duration: 1e7,
						eval_count: 20,
						eval_duration: evalNs
					});
				}
				default:
					return send(404, { error: 'not found' });
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		loaded,
		close: () => new Promise<void>((resolve) => server.close(() => resolve()))
	};
}
