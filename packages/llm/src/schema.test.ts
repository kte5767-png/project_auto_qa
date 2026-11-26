import { describe, expect, it } from 'vitest';
import type { JsonSchema } from './schema';
import { validateJson } from './schema';

const schema: JsonSchema = {
	type: 'object',
	properties: {
		verdict: { type: 'string', enum: ['pass', 'fail'] },
		confidence: { type: 'number', minimum: 0, maximum: 1 },
		keys: { type: 'array', items: { type: 'string', enum: ['UP', 'DOWN'] }, maxItems: 2 },
		reason: { type: 'string', maxLength: 5 }
	},
	required: ['verdict', 'confidence'],
	additionalProperties: false
};

describe('validateJson', () => {
	it('맞으면 빈 목록', () => {
		expect(validateJson(schema, { verdict: 'pass', confidence: 1, keys: ['UP'], reason: '좋음' })).toEqual([]);
		expect(validateJson({ type: 'number' }, 3)).toEqual([]);
	});

	it('틀린 곳을 경로와 함께 모두 알린다', () => {
		expect(
			validateJson(schema, {
				verdict: 'maybe',
				confidence: 1.5,
				keys: ['UP', 'LEFT', 'DOWN'],
				reason: '여섯 글자임',
				extra: 1
			})
		).toEqual([
			'$.verdict: pass | fail 중 하나여야 함 ("maybe")',
			'$.confidence: 1 이하',
			'$.keys: 2개 이하',
			'$.keys[1]: UP | DOWN 중 하나여야 함 ("LEFT")',
			'$.reason: 5자 이하',
			'$.extra: 정의되지 않은 항목'
		]);
		expect(validateJson(schema, { verdict: 'pass' })).toEqual(['$.confidence: 없음']);
		expect(validateJson(schema, [])).toEqual(['$: object여야 함 (array)']);
		expect(validateJson({ type: 'integer' }, 1.5)).toEqual(['$: integer여야 함 (number)']);
	});
});
