import { assertLocalEndpoint } from './host';
import { validateJson } from './schema';
import type { ChatRequest, ChatResult, LlmClient, ModelDetails, ModelInfo, RunningModel } from './types';

/**
 * Ollama HTTP API 클라이언트 (stream 없이 한 번에 받음). 이 PC·내부망 주소만 받는다 (D-026).
 * API: POST /api/chat, GET /api/tags, POST /api/show, GET /api/ps, GET /api/version, POST /api/generate(keep_alive 0 = 내림)
 */

export interface OllamaOptions {
	/** 기본 http://127.0.0.1:11434 */
	host?: string;
	/** 요청 하나의 최대 시간. CPU 실행은 느리므로 넉넉하게 (기본 10분) */
	timeoutMs?: number;
	/** 내부망 서버 이름 허용 목록 */
	allowHosts?: string[];
}

export class LlmError extends Error {
	constructor(
		message: string,
		readonly status: number | null = null
	) {
		super(message);
		this.name = 'LlmError';
	}
}

const ms = (ns: unknown): number => (typeof ns === 'number' ? Math.round(ns / 1e4) / 100 : 0);
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 응답 앞뒤의 ```json 울타리는 벗긴다 (format을 무시하는 모델 대비) */
export function extractJson(content: string): string {
	const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(content);
	return (fenced?.[1] ?? content).trim();
}

export class OllamaClient implements LlmClient {
	readonly endpoint: URL;
	private readonly timeoutMs: number;

	constructor(options: OllamaOptions = {}) {
		this.endpoint = assertLocalEndpoint(options.host ?? 'http://127.0.0.1:11434', options.allowHosts);
		this.timeoutMs = options.timeoutMs ?? 600_000;
	}

	private async call(path: string, body?: unknown): Promise<Record<string, unknown>> {
		const url = new URL(path, this.endpoint);
		let response: Response;
		try {
			response = await fetch(url, {
				method: body === undefined ? 'GET' : 'POST',
				headers: body === undefined ? undefined : { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs)
			});
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			throw new LlmError(
				`Ollama에 연결하지 못함 (${this.endpoint.host}): ${reason}. Ollama가 실행 중인지 확인하세요`
			);
		}
		const text = await response.text();
		let data: Record<string, unknown> = {};
		try {
			data = obj(JSON.parse(text));
		} catch {
			// 오류 본문이 JSON이 아닐 수 있음
		}
		if (!response.ok) {
			throw new LlmError(
				`Ollama ${path} 실패 (${response.status}): ${str(data['error']) ?? text.slice(0, 200)}`,
				response.status
			);
		}
		return data;
	}

	async version(): Promise<string> {
		return str((await this.call('/api/version'))['version']) ?? '?';
	}

	async models(): Promise<ModelInfo[]> {
		return list((await this.call('/api/tags'))['models']).map((m) => {
			const o = obj(m);
			const details = obj(o['details']);
			return {
				name: str(o['name']) ?? str(o['model']) ?? '?',
				sizeBytes: num(o['size']),
				family: str(details['family']),
				parameterSize: str(details['parameter_size']),
				quantization: str(details['quantization_level'])
			};
		});
	}

	async show(model: string): Promise<ModelDetails> {
		const data = await this.call('/api/show', { model });
		const license = str(data['license']);
		return {
			capabilities: list(data['capabilities']).filter((c): c is string => typeof c === 'string'),
			license: license === null ? null : (license.split('\n')[0] ?? '').trim().slice(0, 80)
		};
	}

	async running(): Promise<RunningModel[]> {
		return list((await this.call('/api/ps'))['models']).map((m) => {
			const o = obj(m);
			return {
				name: str(o['name']) ?? str(o['model']) ?? '?',
				sizeBytes: num(o['size']),
				vramBytes: num(o['size_vram']),
				contextLength: typeof o['context_length'] === 'number' ? o['context_length'] : null
			};
		});
	}

	async unload(model: string): Promise<void> {
		await this.call('/api/generate', { model, keep_alive: 0 });
	}

	async chat(request: ChatRequest): Promise<ChatResult> {
		const o = request.options ?? {};
		const options: Record<string, number> = {};
		if (o.temperature !== undefined) options['temperature'] = o.temperature;
		if (o.seed !== undefined) options['seed'] = o.seed;
		if (o.numCtx !== undefined) options['num_ctx'] = o.numCtx;
		if (o.numPredict !== undefined) options['num_predict'] = o.numPredict;
		const body: Record<string, unknown> = {
			model: request.model,
			messages: request.messages.map((m) => ({
				role: m.role,
				content: m.content,
				...(m.images === undefined || m.images.length === 0 ? {} : { images: m.images })
			})),
			stream: false,
			options
		};
		if (request.schema !== undefined) body['format'] = request.schema;
		if (request.think !== undefined) body['think'] = request.think;
		if (request.keepAlive !== undefined) body['keep_alive'] = request.keepAlive;

		const started = performance.now();
		const data = await this.call('/api/chat', body);
		const wallMs = Math.round(performance.now() - started);
		const message = obj(data['message']);
		const content = typeof message['content'] === 'string' ? message['content'] : '';
		const outputTokens = num(data['eval_count']);
		const outputMs = ms(data['eval_duration']);

		let json: unknown;
		const errors: string[] = [];
		if (request.schema !== undefined) {
			try {
				json = JSON.parse(extractJson(content));
				errors.push(...validateJson(request.schema, json));
			} catch {
				errors.push(`JSON이 아님: ${content.slice(0, 120)}`);
			}
		}
		return {
			model: str(data['model']) ?? request.model,
			content,
			thinking: str(message['thinking']),
			doneReason: str(data['done_reason']),
			json,
			errors,
			metrics: {
				wallMs,
				totalMs: ms(data['total_duration']),
				loadMs: ms(data['load_duration']),
				promptTokens: num(data['prompt_eval_count']),
				promptMs: ms(data['prompt_eval_duration']),
				outputTokens,
				outputMs,
				tokensPerSecond: outputMs > 0 ? Math.round((outputTokens / outputMs) * 10000) / 10 : null
			}
		};
	}
}
