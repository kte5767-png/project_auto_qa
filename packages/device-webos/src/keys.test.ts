import { PAGE_SCRIPT_ECMA_VERSION, REMOTE_KEYS } from '@auto-qa/core';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { SSAP_BUTTONS, keyProbeInstallScript, keyProbeWaitScript } from './keys';

describe('SSAP 버튼', () => {
	it('모든 리모컨 키에 버튼 이름이 있다 (OK = ENTER)', () => {
		expect(Object.keys(SSAP_BUTTONS).sort()).toEqual([...REMOTE_KEYS].sort());
		expect(SSAP_BUTTONS.OK).toBe('ENTER');
	});
});

describe('키 도착 확인 스크립트', () => {
	it('구형 TV 엔진(ES2017)에서 파싱된다', () => {
		for (const script of [keyProbeInstallScript(), keyProbeWaitScript(3, 1000)]) {
			expect(() => parse(script, { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
		}
	});

	it('기다리는 기준값과 제한 시간을 넣는다', () => {
		expect(keyProbeWaitScript(3, 1000)).toContain('{"before":3,"timeoutMs":1000}');
	});
});
