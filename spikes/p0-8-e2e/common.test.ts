import type { Observation, ObservedTarget } from '@auto-qa/focus';
import { describe, expect, it } from 'vitest';
import { absenceSubject, itemByText } from './common';

/** 합성 관찰 (회사 자료 아님): 카테고리 목록과 결과 목록 */
function list(name: string, items: string[], focusItem = -1): ObservedTarget {
	return {
		name,
		matched: 1,
		visible: 1,
		texts: [items.join(' ')],
		itemCount: items.length,
		itemTexts: items,
		hasFocus: focusItem >= 0,
		focusItem,
		textOverflow: { overflowing: 0, ellipsis: 0 },
		rect: [0, 0, 100, 100],
		itemRects: []
	};
}

const obs: Observation = {
	focus: null,
	targets: [list('카테고리', ['All 12', 'Place 3', 'Driving 1'], 0), list('결과', ['Driving Tour', 'Bali'])],
	viewport: [1920, 1080],
	errors: []
};
const scope = [
	['카테고리', { selector: '.c' }],
	['결과', { selector: '.r' }]
] as const;

describe('itemByText', () => {
	it('보이는 목록 항목 글자 하나에만 낱말이 모두 들어 있으면 그 항목', () => {
		expect(
			itemByText(
				'Place',
				obs,
				scope.map(([n, d]) => [n, { ...d }])
			)?.slice(1)
		).toEqual([1, 'Place 3']);
		expect(
			itemByText(
				'bali',
				obs,
				scope.map(([n, d]) => [n, { ...d }])
			)?.[0][0]
		).toBe('결과');
	});

	it('여러 항목에 맞거나 없으면 정하지 않는다', () => {
		expect(
			itemByText(
				'Driving',
				obs,
				scope.map(([n, d]) => [n, { ...d }])
			)
		).toBeNull();
		expect(
			itemByText(
				'Seoul',
				obs,
				scope.map(([n, d]) => [n, { ...d }])
			)
		).toBeNull();
	});
});

describe('absenceSubject', () => {
	it('없어야 하는 말과 괄호 보충을 빼고 요소 이름만 남긴다', () => {
		expect(absenceSubject('좌상단에 들어가는 CP 아이콘 미노출 (예외처리)')).toBe('좌상단에 들어가는 CP 아이콘');
		expect(absenceSubject('‘All’ 버튼 미제공')).toBe('‘All’ 버튼');
		expect(absenceSubject('최근 검색어 영역 제공하지 않음')).toBe('최근 검색어 영역');
		expect(absenceSubject('미노출')).toBe('');
	});
});
