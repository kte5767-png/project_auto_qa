import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SSAP_MANIFEST, SsapClient, SsapError, buttonFrame, registerMessage } from './ssap';
import { closedPort, startFakeSsap } from './testing/fakeTv';
import type { FakeSsap } from './testing/fakeTv';

let server: FakeSsap | null = null;
afterEach(async () => {
	await server?.close();
	server = null;
});

describe('메시지 형식', () => {
	it('등록 메시지: 저장된 키가 있으면 넣는다', () => {
		expect(registerMessage('r1', null, DEFAULT_SSAP_MANIFEST).payload).not.toHaveProperty('client-key');
		expect(registerMessage('r1', 'abc', DEFAULT_SSAP_MANIFEST).payload).toMatchObject({
			'client-key': 'abc',
			pairingType: 'PROMPT',
			forcePairing: false
		});
	});

	it('버튼 프레임은 끝에 빈 줄이 있는 텍스트', () => {
		expect(buttonFrame('ENTER')).toBe('type:button\nname:ENTER\n\n');
		expect(() => buttonFrame('UP\nname:HOME')).toThrow(SsapError);
	});
});

describe('SsapClient (가짜 TV)', () => {
	it('보안 포트가 닫혀 있으면 일반 포트로 연결하고, 첫 등록은 TV 허용 창을 거친다', async () => {
		server = await startFakeSsap({ issuedClientKey: 'issued-1' });
		const client = await SsapClient.connect('127.0.0.1', {
			securePort: await closedPort(),
			plainPort: server.port
		});
		expect(client.url).toBe(`ws://127.0.0.1:${server.port}`);
		let prompted = 0;
		const key = await client.register(null, DEFAULT_SSAP_MANIFEST, { onPrompt: () => prompted++ });
		expect(key).toBe('issued-1');
		expect(prompted).toBe(1);
		client.close();
	});

	it('저장된 키로는 허용 창 없이 등록된다', async () => {
		server = await startFakeSsap({ knownClientKey: 'saved' });
		const client = await SsapClient.connect('127.0.0.1', {
			securePort: await closedPort(),
			plainPort: server.port
		});
		expect(await client.register('saved')).toBe('saved');
		expect(server.prompts).toBe(0);
		client.close();
	});

	it('포인터 소켓으로 버튼을 보낸다', async () => {
		server = await startFakeSsap();
		const client = await SsapClient.connect('127.0.0.1', {
			securePort: await closedPort(),
			plainPort: server.port
		});
		await client.register(null);
		const pointer = await client.openPointerSocket();
		await pointer.button('UP');
		await pointer.button('ENTER');
		await expect.poll(() => server?.buttons).toEqual(['UP', 'ENTER']);
		pointer.close();
		client.close();
	});

	it('등록 거절·권한 부족은 SsapError', async () => {
		server = await startFakeSsap({ rejectRegistration: true });
		const client = await SsapClient.connect('127.0.0.1', {
			securePort: await closedPort(),
			plainPort: server.port
		});
		await expect(client.register(null)).rejects.toThrow(/cancelled/);
		client.close();
		await server.close();

		server = await startFakeSsap({ denyPointer: true });
		const client2 = await SsapClient.connect('127.0.0.1', {
			securePort: await closedPort(),
			plainPort: server.port
		});
		await client2.register(null);
		await expect(client2.openPointerSocket()).rejects.toThrow(/insufficient/);
		client2.close();
	});

	it('TV에 연결할 수 없으면 확인할 설정을 알려 준다', async () => {
		await expect(
			SsapClient.connect('127.0.0.1', {
				securePort: await closedPort(),
				plainPort: await closedPort(),
				timeoutMs: 1000
			})
		).rejects.toThrow(/LG Connect Apps/);
	});
});
