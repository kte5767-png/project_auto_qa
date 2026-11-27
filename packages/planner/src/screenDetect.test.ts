import type { Rect } from '@auto-qa/core';
import type { DomNode, DomSnapshot } from '@auto-qa/focus';
import { describe, expect, it } from 'vitest';
import { chooseDetect, matchSelector, parseSimpleSelector } from './screenDetect';

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function snap(defs: (Partial<DomNode> & { parent: number })[]): DomSnapshot {
	return {
		viewport: { width: 1920, height: 1080 },
		nodes: defs.map((d, i) => ({
			i,
			tag: 'div',
			id: null,
			classes: [],
			spotlightId: null,
			container: false,
			role: null,
			label: null,
			ownText: '',
			value: null,
			rect: r(0, 0, 100, 100),
			focusable: false,
			focused: false,
			probes: [],
			...d
		})),
		truncated: false,
		errors: []
	};
}

/** 검색 화면: 0 body, 1 패널(search), 2 검색창, 3 입력란, 4 칩 줄 > 5·6 칩 */
const SEARCH = snap([
	{ parent: -1, tag: 'body' },
	{ parent: 0, classes: ['Panel_panel'], spotlightId: 'panel-search' },
	{ parent: 1, classes: ['Search_field', 'spottable'], focusable: true },
	{ parent: 2, tag: 'input', id: 'searchInput' },
	{ parent: 1, classes: ['Chips_row'], role: 'list' },
	{ parent: 4, classes: ['Chip_chip', 'spottable'], focusable: true },
	{ parent: 4, classes: ['Chip_chip', 'spottable'], focusable: true }
]);

/** 결과 화면: 같은 패널 클래스, 다른 spotlight id, 칩 대신 카드 */
const RESULT = snap([
	{ parent: -1, tag: 'body' },
	{ parent: 0, classes: ['Panel_panel'], spotlightId: 'panel-result' },
	{ parent: 1, classes: ['Search_field', 'spottable'], focusable: true },
	{ parent: 1, classes: ['Card_card', 'spottable'], focusable: true }
]);

describe('matchSelector', () => {
	it('자동 연결이 내는 단순 선택자(아이디·spotlight id·클래스·role·태그·자손)를 스냅숏에서 찾는다', () => {
		expect(matchSelector(SEARCH, '.Chip_chip')).toEqual([5, 6]);
		expect(matchSelector(SEARCH, '[data-spotlight-id="panel-search"]')).toEqual([1]);
		expect(matchSelector(SEARCH, '#searchInput')).toEqual([3]);
		expect(matchSelector(SEARCH, 'input#searchInput')).toEqual([3]);
		expect(matchSelector(SEARCH, '[role="list"] .Chip_chip')).toEqual([5, 6]);
		expect(matchSelector(SEARCH, '.Panel_panel .Search_field.spottable')).toEqual([2]);
		expect(matchSelector(SEARCH, '.Chips_row .Search_field')).toEqual([]);
	});

	it('모르는 문법이면 null (추측하지 않음)', () => {
		expect(parseSimpleSelector('.a > .b')).toBeNull();
		expect(matchSelector(SEARCH, '[data-x="1"]')).toBeNull();
		expect(matchSelector(SEARCH, '.a:hover')).toBeNull();
	});
});

describe('chooseDetect', () => {
	it('이 화면에만 있는 후보를 고른다 (앞 후보가 다른 화면에도 있으면 다음 후보)', () => {
		const d = chooseDetect(SEARCH, new Map([['4.5', RESULT]]), ['.Search_field', '.Chips_row', '.Chip_chip']);
		expect(d).toMatchObject({ selector: '.Chips_row', sharedWith: [] });
	});

	it('구별되는 후보가 없으면 가장 적게 겹치는 것을 고르고 겹친 화면을 적는다', () => {
		const d = chooseDetect(SEARCH, new Map([['4.5', RESULT]]), ['.nothing', '.Search_field']);
		expect(d).toMatchObject({ selector: '.Search_field', sharedWith: ['4.5'] });
		expect(d?.reason).toContain('4.5');
		expect(chooseDetect(SEARCH, new Map(), ['.nothing'])).toBeNull();
	});
});
