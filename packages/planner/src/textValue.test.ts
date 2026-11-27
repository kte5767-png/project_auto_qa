import { describe, expect, it } from 'vitest';
import { noResultText, overLimitText, resolveTextValue, textValueError } from './textValue';

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
	});
});
