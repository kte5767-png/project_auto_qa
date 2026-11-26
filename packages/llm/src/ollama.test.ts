import { afterEach, describe, expect, it } from 'vitest';
import { extractJson, LlmError, OllamaClient } from './ollama';
import type { FakeOllama } from './testing';
import { startFakeOllama } from './testing';

let fake: FakeOllama | undefined;
afterEach(async () => {
	await fake?.close();
	fake = undefined;
});

describe('OllamaClient', () => {
	it('외부 주소로는 만들 수 없다', () => {
		expect(() => new OllamaClient({ host: 'https://api.example.com' })).toThrow(/D-026/);
	});

	it('모델 목록·기능·실행 중 메모리·버전을 읽는다', async () => {
		fake = await startFakeOllama([
			{ name: 'vision:2b', capabilities: ['completion', 'vision'], sizeBytes: 2e9, reply: () => '{}' }
		]);
		const client = new OllamaClient({ host: fake.url });
		expect(await client.version()).toBe('0.99.0-fake');
		expect(await client.models()).toEqual([
			{ name: 'vision:2b', sizeBytes: 2e9, family: 'fake', parameterSize: '1B', quantization: 'Q4_K_M' }
		]);
		expect(await client.show('vision:2b')).toEqual({
			capabilities: ['completion', 'vision'],
			license: 'Apache License 2.0'
		});
		expect(await client.running()).toEqual([]);
		await client.chat({ model: 'vision:2b', messages: [{ role: 'user', content: 'hi' }] });
		expect(await client.running()).toEqual([
			{ name: 'vision:2b', sizeBytes: 2e9, vramBytes: 0, contextLength: 4096 }
		]);
		await client.unload('vision:2b');
		expect(await client.running()).toEqual([]);
	});

	it('요청을 Ollama 형식으로 보내고 결과·시간을 정리한다', async () => {
		fake = await startFakeOllama([{ name: 'm', reply: () => '```json\n{"verdict":"pass"}\n```', evalMs: 2000 }]);
		const client = new OllamaClient({ host: fake.url });
		const result = await client.chat({
			model: 'm',
			messages: [
				{ role: 'system', content: 's' },
				{ role: 'user', content: 'u', images: ['QUJD'] }
			],
			schema: {
				type: 'object',
				properties: { verdict: { type: 'string', enum: ['pass'] } },
				required: ['verdict']
			},
			options: { temperature: 0, seed: 42, numCtx: 4096, numPredict: 256 },
			think: false,
			keepAlive: '5m'
		});
		expect(fake.requests.at(-1)?.body).toEqual({
			model: 'm',
			messages: [
				{ role: 'system', content: 's' },
				{ role: 'user', content: 'u', images: ['QUJD'] }
			],
			stream: false,
			options: { temperature: 0, seed: 42, num_ctx: 4096, num_predict: 256 },
			format: {
				type: 'object',
				properties: { verdict: { type: 'string', enum: ['pass'] } },
				required: ['verdict']
			},
			think: false,
			keep_alive: '5m'
		});
		expect(result.json).toEqual({ verdict: 'pass' });
		expect(result.errors).toEqual([]);
		expect(result.metrics).toMatchObject({
			loadMs: 500,
			outputTokens: 20,
			outputMs: 2000,
			tokensPerSecond: 10,
			promptTokens: 100
		});
	});

	it('JSON이 아니거나 스키마에 맞지 않으면 오류를 담는다', async () => {
		fake = await startFakeOllama([
			{ name: 'm', reply: (r) => (r.messages[0]?.content === 'a' ? '그냥 글' : '{"verdict":"fail"}') }
		]);
		const client = new OllamaClient({ host: fake.url });
		const schema = {
			type: 'object' as const,
			properties: { verdict: { type: 'string' as const, enum: ['pass'] } }
		};
		const notJson = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'a' }], schema });
		expect(notJson.errors).toEqual(['JSON이 아님: 그냥 글']);
		const wrong = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'b' }], schema });
		expect(wrong.errors).toEqual(['$.verdict: pass 중 하나여야 함 ("fail")']);
	});

	it('서버 오류·연결 실패는 LlmError', async () => {
		fake = await startFakeOllama([]);
		const client = new OllamaClient({ host: fake.url });
		await expect(client.chat({ model: '없는모델', messages: [] })).rejects.toThrow(/404.*not found/);
		const url = fake.url;
		await fake.close();
		fake = undefined;
		const err = await new OllamaClient({ host: url, timeoutMs: 2000 }).version().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LlmError);
		expect(String(err)).toMatch(/Ollama에 연결하지 못함/);
	});

	it('extractJson은 코드 울타리를 벗긴다', () => {
		expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
		expect(extractJson(' {"a":1} ')).toBe('{"a":1}');
	});
});
