import { describe, expect, it } from 'vitest';
import { defaultFocusTarget, topmostList } from './defaultFocus';
import type { NavCallout, NavScreen } from './keymap';

/** 합성 화면: ① 입력란(맨 위, 목록 아님), ② 키워드 줄, ③ 카드 줄, ④ 도시 줄, ⑥ 맨 위로 버튼 */
function screen(defaultFocus: string | null = null, rects = true): NavScreen {
	const c = (no: string, name: string, y: number): NavCallout => ({
		no,
		names: [name],
		texts: [],
		rect: rects ? { x: 300, y, width: 1200, height: 80 } : null,
		keys: {}
	});
	return {
		screenId: '9.2',
		title: '합성 검색',
		defaultFocus,
		callouts: [
			c('1', 'Search field', 80),
			c('4', 'Weekly Cities', 760),
			c('3', 'Top Picks', 400),
			c('2', 'Keywords', 220),
			c('6', 'Back to Top', 900)
		]
	};
}
const LISTS = new Set(['2', '3', '4']);
const CLAUSE = '화면 최상단 Default 포커스 항목에 포커스 이동';

describe('topmostList', () => {
	it('목업 위치가 가장 위인 목록 콜아웃을 고른다 (목록이 아닌 입력란은 건너뜀)', () => {
		expect(topmostList(screen(), LISTS)?.no).toBe('2');
	});

	it('위치가 없으면 콜아웃 번호 순', () => {
		expect(topmostList(screen(null, false), new Set(['4', '3']))?.no).toBe('3');
	});

	it('목록이 없으면 null', () => {
		expect(topmostList(screen(), new Set())).toBeNull();
	});
});

describe('defaultFocusTarget', () => {
	it('Default Focus가 없고 문장이 "최상단 … 항목"이면 맨 위 목록의 첫 항목', () => {
		expect(defaultFocusTarget(screen(), CLAUSE, null, LISTS)).toEqual({
			no: '2',
			firstItem: true,
			basis: '화면설계서에 Default Focus가 없어 맨 위 목록(Keywords)의 첫 항목'
		});
	});

	it('Default Focus가 콜아웃 이름을 가리키면 그 콜아웃', () => {
		expect(defaultFocusTarget(screen('Search field'), CLAUSE, 'Search field', LISTS)).toMatchObject({
			no: '1',
			firstItem: false,
			basis: '화면설계서 Default Focus "Search field"'
		});
		expect(defaultFocusTarget(screen(), CLAUSE, 'Top Picks 첫 번째 항목', LISTS)).toMatchObject({
			no: '3',
			firstItem: true
		});
	});

	it('Default Focus가 위치로만 말하면("좌측 상단 첫 번째 항목") 맨 위 목록의 첫 항목', () => {
		expect(defaultFocusTarget(screen(), CLAUSE, '좌측 상단 첫 번째 항목', LISTS)).toMatchObject({
			no: '2',
			firstItem: true,
			basis: '화면설계서 Default Focus "좌측 상단 첫 번째 항목" → 맨 위 목록(Keywords)의 첫 항목'
		});
	});

	it('위치 말도 이름도 없으면 정하지 않는다 (진입 시 포커스로 판정)', () => {
		expect(defaultFocusTarget(screen(), 'Default 포커스로 이동', null, LISTS)).toBeNull();
		expect(defaultFocusTarget(screen(), CLAUSE, null, new Set())).toBeNull();
	});
});
