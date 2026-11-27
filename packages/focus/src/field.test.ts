import { PAGE_SCRIPT_ECMA_VERSION } from '@auto-qa/core';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { fieldOverflows, fieldScript, fieldShowsEnd } from './field';
import type { FieldView } from './field';

const view = (v: Partial<FieldView>): FieldView => ({
	found: true,
	focused: true,
	value: '',
	maxLength: null,
	scrollLeft: 0,
	scrollWidth: 100,
	clientWidth: 100,
	textOverflow: 'clip',
	...v
});

describe('fieldScript', () => {
	it('구형 TV 엔진(ES2017)에서 파싱되는 문법만 쓴다', () => {
		expect(() => parse(fieldScript(), { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
	});
});

describe('입력란 모양', () => {
	it('넘치는지, 끝이 보이게 스크롤됐는지', () => {
		expect(fieldOverflows(view({}))).toBe(false);
		const long = view({ scrollWidth: 400, clientWidth: 100 });
		expect(fieldOverflows(long)).toBe(true);
		expect(fieldShowsEnd(long)).toBe(false);
		expect(fieldShowsEnd({ ...long, scrollLeft: 299 })).toBe(true);
	});
});
