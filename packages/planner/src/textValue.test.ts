import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RESULT_CANDIDATES,
	noResultText,
	overLimitText,
	pickMostResults,
	resolveTextValue,
	textCandidates,
	textValueError
} from './textValue';

const ctx = { seed: '4.6', data: { flight: 'Seoul to Bali' } };

describe('resolveTextValue', () => {
	it('글자 그대로', () => {
		expect(resolveTextValue('Bali', ctx)).toEqual({ value: 'Bali', kind: 'literal' });
	});

	it('@no-result: 같은 seed면 같은 글자, seed가 다르면 다른 글자, 자음만', () => {
		const a = resolveTextValue('@no-result', ctx);
		const b = resolveTextValue('@no-result', ctx);
		expect(a).toEqual(b);
		expect(a).toMatchObject({ kind: 'no-result' });
		const value = 'value' in a ? a.value : '';
		expect(value).toMatch(/^[bcdfghjklmnpqrstvwxz]{12}$/);
		expect(noResultText('4.8')).not.toBe(value);
		expect(resolveTextValue('@no-result:20', ctx)).toMatchObject({ value: expect.stringMatching(/^.{20}$/) });
	});

	it('@over-limit:N은 N + 1자, 몇 번째 글자인지 보이게 숫자 반복', () => {
		expect(overLimitText(12)).toBe('1234567890123');
		const r = resolveTextValue('@over-limit:255', ctx);
		expect('value' in r ? r.value.length : 0).toBe(256);
	});

	it('@data:이름은 프로필 테스트 데이터, 없으면 이유', () => {
		expect(resolveTextValue('@data:flight', ctx)).toEqual({ value: 'Seoul to Bali', kind: 'data' });
		expect(resolveTextValue('@data:hotel', ctx)).toEqual({
			error: expect.stringContaining('"hotel"')
		});
	});

	it('@most-results는 실행기가 고른 값을 쓰고, 고르기 전에는 이유', () => {
		expect(resolveTextValue('@most-results', ctx)).toEqual({ error: expect.stringContaining('아직 고르지 않음') });
		expect(resolveTextValue('@most-results', { ...ctx, chosen: { '@most-results': 'o' } })).toEqual({
			value: 'o',
			kind: 'most-results'
		});
		// 후보가 다른 글자는 따로 고른다
		expect(resolveTextValue('@most-results:x,y', { ...ctx, chosen: { '@most-results': 'o' } })).toHaveProperty(
			'error'
		);
	});
});

describe('textCandidates', () => {
	it('기본 후보는 a·o·e, 직접 적으면 그 순서대로', () => {
		expect(textCandidates('@most-results')).toEqual([...DEFAULT_RESULT_CANDIDATES]);
		expect(DEFAULT_RESULT_CANDIDATES).toEqual(['a', 'o', 'e']);
		expect(textCandidates('@most-results:e, i ,u')).toEqual(['e', 'i', 'u']);
	});

	it('@most-results가 아니면 null', () => {
		expect(textCandidates('Bali')).toBeNull();
		expect(textCandidates('@no-result')).toBeNull();
	});
});

describe('pickMostResults', () => {
	it('결과가 가장 많은 후보', () => {
		expect(
			pickMostResults([
				{ value: 'a', count: 3 },
				{ value: 'o', count: 12 },
				{ value: 'e', count: 7 }
			])
		).toEqual({ value: 'o', count: 12 });
	});

	it('같으면 앞 후보 (같은 입력이면 같은 결과)', () => {
		expect(
			pickMostResults([
				{ value: 'a', count: 8 },
				{ value: 'o', count: 8 }
			])
		).toEqual({ value: 'a', count: 8 });
	});

	it('결과 화면에 못 갔거나 0개인 후보는 빼고, 모두 그렇면 null', () => {
		expect(
			pickMostResults([
				{ value: 'a', count: null },
				{ value: 'o', count: 2 }
			])
		).toEqual({ value: 'o', count: 2 });
		expect(
			pickMostResults([
				{ value: 'a', count: 0 },
				{ value: 'o', count: null }
			])
		).toBeNull();
		expect(pickMostResults([])).toBeNull();
	});
});

describe('textValueError', () => {
	it('형식 오류를 알려 준다', () => {
		expect(textValueError('Bali')).toBeNull();
		expect(textValueError('@no-result')).toBeNull();
		expect(textValueError('')).toBe('빈 글자');
		expect(textValueError('@over-limit')).toContain('상한');
		expect(textValueError('@over-limit:abc')).toContain('상한');
		expect(textValueError('@no-result:0')).toContain('길이');
		expect(textValueError('@data:')).toContain('이름');
		expect(textValueError('@random')).toContain('모르는');
		expect(textValueError('@most-results')).toBeNull();
		expect(textValueError('@most-results:a,o')).toBeNull();
		expect(textValueError('@most-results:')).toContain('빈 글자');
		expect(textValueError('@most-results:a,,o')).toContain('빈 글자');
		expect(textValueError('@most-results:a,a')).toContain('겹침');
		expect(textValueError('@most-results:a,b,c,d,e,f,g,h,i,j,k')).toContain('10개까지');
	});
});
