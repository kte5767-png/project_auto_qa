import { describe, expect, it } from 'vitest';
import { containedNameScore, expectAfterKey, expectedItemIndex, matchByName } from './expect';
import { buildKeyMap } from './keymap';
import type { KeyAction, NavCallout, NavScreen } from './keymap';

const MEMORY = ' (이동한 이력이 있을 경우: 마지막 포커스한 콘텐츠에 이동)';

/** 합성 검색 화면: ① 검색창, ② 추천 단어, ③ 인기 목록, ④ 필터 메뉴 */
function screen(): NavScreen {
	const c = (no: string, name: string, rect: NavCallout['rect'], keys: NavCallout['keys']): NavCallout => ({
		no,
		names: [name],
		texts: [],
		rect,
		keys
	});
	return {
		screenId: '9.1',
		title: '합성 검색',
		callouts: [
			c(
				'1',
				'Search box 영역',
				{ x: 300, y: 100, width: 1000, height: 80 },
				{
					up: '동작 없음',
					down: '추천 단어 좌측 첫 번째 항목으로 이동',
					left: 'GNB 확장',
					right: '우측 필터 메뉴에 포커스'
				}
			),
			c(
				'2',
				'추천 단어',
				{ x: 300, y: 250, width: 1300, height: 60 },
				{
					up: '“Search box 버튼 포커스',
					down: `Top Picks 영역 좌측 첫 번째 콘텐츠에 포커스${MEMORY}`,
					left: 'GNB 확장',
					right: '다음 항목으로 이동 (더 이상 이동할 항목이 없을 경우 동작 없음)',
					ok: 'Help 버튼에 포커스'
				}
			),
			c('3', 'Top Picks', { x: 300, y: 400, width: 1300, height: 200 }, { up: '알 수 없는 곳' }),
			c('4', '필터 메뉴', { x: 1400, y: 100, width: 80, height: 80 }, { left: '“Search box 버튼 포커스' })
		]
	};
}

describe('expectAfterKey', () => {
	const actions = buildKeyMap(screen());

	it('다른 콜아웃의 첫 항목으로', () => {
		const e = expectAfterKey(actions, '1', 'down');
		expect(e).toMatchObject({ ok: true, target: { kind: 'callout', no: '2' }, item: 'first', estimated: false });
		expect(e.basis).toContain('1번 [▼]');
	});

	it('이동한 이력 조건은 memory로', () => {
		expect(expectAfterKey(actions, '2', 'down')).toMatchObject({
			ok: true,
			target: { kind: 'callout', no: '3' },
			item: 'memory'
		});
	});

	it('같은 목록 다음 항목, 끝에서 멈춤 여부를 함께 준다', () => {
		expect(expectAfterKey(actions, '2', 'right')).toMatchObject({
			ok: true,
			target: { kind: 'same' },
			item: 'next',
			endNoop: true
		});
	});

	it('동작 없음은 제자리, GNB는 화면 밖', () => {
		expect(expectAfterKey(actions, '1', 'up')).toMatchObject({ ok: true, target: { kind: 'same' }, item: 'same' });
		expect(expectAfterKey(actions, '1', 'left')).toMatchObject({ ok: true, target: { kind: 'leave', to: 'GNB' } });
	});

	it('목록 안에서는 반대 방향 키가 이전 항목, 첫 항목에서만 적힌 동작', () => {
		expect(expectAfterKey(actions, '2', 'left', { index: 2, count: 5 })).toMatchObject({
			ok: true,
			target: { kind: 'same' },
			item: 'prev'
		});
		expect(expectAfterKey(actions, '2', 'left', { index: 0, count: 5 })).toMatchObject({
			ok: true,
			target: { kind: 'leave', to: 'GNB' }
		});
		expect(expectAfterKey(actions, '2', 'left')).toMatchObject({ ok: true, target: { kind: 'leave' } });
	});

	it('콜아웃이 아닌 요소는 이름으로 남긴다', () => {
		const e = expectAfterKey(actions, '2', 'ok');
		expect(e).toMatchObject({ ok: true, target: { kind: 'element' } });
	});

	it('지도에 없는 키·해석 못 한 문장은 기대값을 만들지 않는다', () => {
		const none = expectAfterKey(actions, '4', 'down');
		expect(none.ok).toBe(false);
		if (!none.ok) expect(none.reason).toContain('동작이 없음');
		const base: KeyAction = {
			from: '3',
			key: 'up',
			text: '?',
			effect: { kind: 'unknown' },
			endNoop: false,
			estimate: null,
			reason: ''
		};
		expect(expectAfterKey([base], '3', 'up').ok).toBe(false);
		const estimated = expectAfterKey([{ ...base, estimate: { to: '2', reason: '위쪽 가장 가까움' } }], '3', 'up');
		expect(estimated).toMatchObject({ ok: true, target: { kind: 'callout', no: '2' }, estimated: true });
	});
});

describe('expectedItemIndex', () => {
	const ctx = { previous: 1, count: 3, remembered: null, endNoop: false };

	it('첫·마지막·제자리', () => {
		expect(expectedItemIndex('first', ctx)).toBe(0);
		expect(expectedItemIndex('last', ctx)).toBe(2);
		expect(expectedItemIndex('same', ctx)).toBe(1);
		expect(expectedItemIndex(null, ctx)).toBeNull();
	});

	it('다음·이전, 끝에서는 "더 이상 없으면 동작 없음"일 때만 제자리', () => {
		expect(expectedItemIndex('next', ctx)).toBe(2);
		expect(expectedItemIndex('prev', ctx)).toBe(0);
		expect(expectedItemIndex('next', { ...ctx, previous: 2 })).toBeNull();
		expect(expectedItemIndex('next', { ...ctx, previous: 2, endNoop: true })).toBe(2);
		expect(expectedItemIndex('prev', { ...ctx, previous: 0, endNoop: true })).toBe(0);
	});

	it('이력은 기억한 위치, 없으면 첫 항목', () => {
		expect(expectedItemIndex('memory', { ...ctx, remembered: 2 })).toBe(2);
		expect(expectedItemIndex('memory', ctx)).toBe(0);
	});
});

describe('matchByName', () => {
	const elements = [
		{ id: 'search', names: ['검색창', 'Search box'] },
		{ id: 'gnb', names: ['GNB', '메뉴'] }
	];

	it('이름 낱말이 맞는 것을 고른다', () => {
		expect(matchByName('Search box 버튼', elements, (e) => e.names)?.match.id).toBe('search');
		expect(matchByName('GNB', elements, (e) => e.names)?.match.id).toBe('gnb');
	});

	it('맞는 것이 없으면 고르지 않는다', () => {
		expect(matchByName('Help 버튼', elements, (e) => e.names)).toBeNull();
	});

	it('공통 낱말만 같은 다른 요소는 고르지 않는다 (Search!31: 추천 검색어 ↔ 최근 검색어)', () => {
		const onlyRecent = [
			{ id: 'recent', names: ['4.3 ① 최근 검색어', '최근 검색어'] },
			{ id: 'gnb', names: ['GNB', '메뉴'] }
		];
		expect(matchByName('추천 검색어', onlyRecent, (e) => e.names)).toBeNull();
		const withKeywords = [...onlyRecent, { id: 'keywords', names: ['4.2 ② 추천 검색어', '추천 검색어'] }];
		expect(matchByName('추천 검색어', withKeywords, (e) => e.names)?.match.id).toBe('keywords');
	});
});

describe('containedNameScore', () => {
	it('한쪽 낱말이 다른 쪽에 모두 들어 있을 때만 점수', () => {
		expect(containedNameScore('추천 검색어', '최근 검색어')).toBe(0);
		expect(containedNameScore('GNB', 'GNB 검색')).toBeGreaterThan(0);
		expect(containedNameScore('추천 검색어', '4.2 ② 추천 검색어')).toBeGreaterThan(0.5);
		expect(containedNameScore('Search box 버튼', 'Search box')).toBe(1);
	});
});
