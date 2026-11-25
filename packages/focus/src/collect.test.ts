import { PAGE_SCRIPT_ECMA_VERSION } from '@auto-qa/core';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COLLECT_OPTIONS, collectFocusScript, collectFocusState } from './collect';

describe('collectFocusScript', () => {
	it('구형 TV 엔진(ES2017)에서 파싱되는 문법만 쓴다', () => {
		expect(() => parse(collectFocusScript(), { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
	});

	it('옵션을 기본값과 합쳐 넣는다', () => {
		const script = collectFocusScript({ selector: '.focused' });
		expect(script).toContain(JSON.stringify({ ...DEFAULT_COLLECT_OPTIONS, selector: '.focused' }));
	});
});

describe('collectFocusState', () => {
	it('주어진 실행기로 스크립트를 평가한다 (드라이버에 묶이지 않음)', async () => {
		const seen: string[] = [];
		const fake = {
			evaluate: <T>(expression: string): Promise<T> => {
				seen.push(expression);
				return Promise.resolve({ active: null } as T);
			}
		};
		const state = await collectFocusState(fake, { selector: '.x' });
		expect(state.active).toBeNull();
		expect(seen[0]).toContain('".x"');
	});
});
