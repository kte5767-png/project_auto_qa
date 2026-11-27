import { describe, expect, it } from 'vitest';
import defectsJson from '../defects.json';
import { ALL_DEFECT_IDS, DEFECTS, validateDefectsFile } from './defects';

describe('defects.json 정답 목록', () => {
	it('구조가 올바르다', () => {
		expect(validateDefectsFile(defectsJson)).toEqual([]);
	});

	it('결함이 10개 이상이다 (P0-1 완료 기준)', () => {
		expect(DEFECTS.length).toBeGreaterThanOrEqual(10);
	});

	it('GUI·포커스·흐름 결함이 모두 있다', () => {
		const categories = new Set(DEFECTS.map((d) => d.category));
		expect(categories).toContain('gui');
		expect(categories).toContain('focus');
		expect(categories).toContain('flow');
	});

	it('id가 D01부터 빠짐없이 이어진다', () => {
		expect(ALL_DEFECT_IDS).toEqual(DEFECTS.map((_, i) => `D${String(i + 1).padStart(2, '0')}`));
	});
});

describe('validateDefectsFile', () => {
	const valid = {
		id: 'D01',
		category: 'gui',
		screen: 'home',
		target: 't',
		summary: 's',
		expected: 'e',
		actual: 'a',
		reproKeys: ['DOWN']
	};

	it('정상 파일은 오류 없음', () => {
		expect(validateDefectsFile({ version: 1, defects: [valid] })).toEqual([]);
	});

	it('중복 id를 잡는다', () => {
		const errors = validateDefectsFile({ version: 1, defects: [valid, valid] });
		expect(errors.some((e) => e.includes('중복'))).toBe(true);
	});

	it('잘못된 키와 카테고리를 잡는다', () => {
		const errors = validateDefectsFile({
			version: 1,
			defects: [{ ...valid, category: 'visual', reproKeys: ['JUMP'] }]
		});
		expect(errors).toHaveLength(2);
	});

	it('focus 결함에 baselineFocus가 없으면 오류', () => {
		const errors = validateDefectsFile({ version: 1, defects: [{ ...valid, category: 'focus' }] });
		expect(errors.some((e) => e.includes('baselineFocus'))).toBe(true);
	});

	it('waitMs는 0 이상의 숫자만', () => {
		expect(validateDefectsFile({ version: 1, defects: [{ ...valid, waitMs: 3000 }] })).toEqual([]);
		const errors = validateDefectsFile({ version: 1, defects: [{ ...valid, waitMs: -1 }] });
		expect(errors.some((e) => e.includes('waitMs'))).toBe(true);
	});

	it('input은 비어 있지 않은 글자만', () => {
		expect(validateDefectsFile({ version: 1, defects: [{ ...valid, input: 'bali' }] })).toEqual([]);
		const errors = validateDefectsFile({ version: 1, defects: [{ ...valid, input: ' ' }] });
		expect(errors.some((e) => e.includes('input'))).toBe(true);
	});

	it('객체가 아니면 오류', () => {
		expect(validateDefectsFile(null)).not.toEqual([]);
		expect(validateDefectsFile({ version: 2, defects: 'x' })).toHaveLength(2);
	});
});
