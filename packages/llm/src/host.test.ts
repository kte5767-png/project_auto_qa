import { describe, expect, it } from 'vitest';
import { assertLocalEndpoint, isLocalHost } from './host';

describe('로컬 LLM 주소만 허용 (D-026)', () => {
	it('이 PC와 사설 IP는 로컬로 본다', () => {
		for (const h of [
			'localhost',
			'127.0.0.1',
			'127.1.2.3',
			'::1',
			'[::1]',
			'10.0.0.5',
			'172.16.0.1',
			'172.31.255.255',
			'192.168.0.10'
		])
			expect(isLocalHost(h)).toBe(true);
		for (const h of [
			'8.8.8.8',
			'172.32.0.1',
			'192.169.0.1',
			'api.openai.com',
			'ollama.com',
			'999.1.1.1',
			'11.0.0.1'
		])
			expect(isLocalHost(h)).toBe(false);
	});

	it('외부 주소는 막고, 내부망 이름은 허용 목록에 있을 때만 받는다', () => {
		expect(assertLocalEndpoint('http://127.0.0.1:11434').port).toBe('11434');
		expect(() => assertLocalEndpoint('https://api.example.com')).toThrow(/외부 주소로는 보내지 않음/);
		expect(() => assertLocalEndpoint('http://gpu-pc.corp:11434')).toThrow(/허용 목록/);
		expect(assertLocalEndpoint('http://gpu-pc.corp:11434', ['GPU-PC.corp']).hostname).toBe('gpu-pc.corp');
		expect(() => assertLocalEndpoint('ftp://127.0.0.1')).toThrow(/http/);
		expect(() => assertLocalEndpoint('주소 아님')).toThrow(/올바르지 않음/);
	});
});
