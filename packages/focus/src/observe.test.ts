import { PAGE_SCRIPT_ECMA_VERSION } from '@auto-qa/core';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OBSERVE_OPTIONS, observeScript, observeTargets } from './observe';
import type { ObserveTarget } from './observe';

const targets: ObserveTarget[] = [
	{ name: '검색창', selector: '[data-spotlight-id="searchInput"]', textIncludes: null, items: null },
	{ name: '추천 검색어', selector: '#section-x', textIncludes: null, items: '.spottable' }
];

describe('observeScript', () => {
	it('구형 TV 엔진(ES2017)에서 파싱되는 문법만 쓴다', () => {
		expect(() => parse(observeScript(targets), { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
	});

	it('대상과 옵션(기본값과 합침)을 JSON으로 넣는다', () => {
		const script = observeScript(targets, { focusSelector: '.focused' });
		expect(script).toContain(JSON.stringify({ ...DEFAULT_OBSERVE_OPTIONS, focusSelector: '.focused' }));
		expect(script).toContain('추천 검색어');
	});
});

describe('observeTargets', () => {
	it('주어진 실행기로 스크립트를 평가한다 (드라이버에 묶이지 않음)', async () => {
		const seen: string[] = [];
		const fake = {
			evaluate: <T>(expression: string): Promise<T> => {
				seen.push(expression);
				return Promise.resolve({ focus: null, targets: [], errors: [] } as T);
			}
		};
		const result = await observeTargets(fake, targets);
		expect(result.focus).toBeNull();
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain('searchInput');
	});
});
