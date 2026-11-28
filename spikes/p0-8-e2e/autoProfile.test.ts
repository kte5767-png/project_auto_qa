import type { Rect } from '@auto-qa/core';
import type { DomNode, DomSnapshot } from '@auto-qa/focus';
import { buildScreenGraph } from '@auto-qa/planner';
import type { AppScreenLink, GraphCallout, GraphScreen, ScreenEdge } from '@auto-qa/planner';
import { describe, expect, it } from 'vitest';
import {
	chooseDetects,
	edgeEntry,
	inputCallout,
	planAutoEntries,
	sameView,
	screenNamesFrom,
	seedOf,
	seedQuery,
	settleDetect
} from './autoProfile';
import type { AppProfile } from './profile';

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

const sel = (no: string, items: string[]): GraphCallout => ({
	no,
	names: [`콜아웃 ${no}`],
	sections: [{ title: '2)선택 시', items }]
});

/** 합성 화면설계서: 9.2 찾기(첫 화면) → 9.5 찾기 완료 / 9.6 결과 없음 */
const SCREENS: GraphScreen[] = [
	{
		screenId: '9.2',
		title: '찾기 - VKB 닫힘',
		entryConditions: [],
		callouts: [sel('1', ['VKB 호출']), sel('2', ['단어 선택 시 해당 단어가 입력된 찾기 결과 페이지로 이동'])]
	},
	{ screenId: '9.1', title: '찾기 - 최초 진입 시(키보드 활성화)', entryConditions: [], callouts: [] },
	{ screenId: '9.5', title: '찾기 완료', entryConditions: [], callouts: [] },
	{ screenId: '9.6', title: '찾기 완료 - 찾기 결과 없음', entryConditions: [], callouts: [] }
];

const PROFILE: AppProfile = {
	format: 'auto-qa/app-profile',
	version: 1,
	name: 't',
	url: 'http://x',
	aliases: { 찾기: ['검색'] },
	elements: { 'GNB 찾기': { selector: '.gnb-search' }, 뒤로: { selector: '.back', callout: '9.2#3' } },
	screens: {
		'9.2': { detect: '.search', entry: [{ press: 'LEFT', until: 'GNB 찾기' }, { press: 'OK' }], callouts: {} },
		'9.5': { detect: '.result', from: '9.2', entry: [{ type: 'b', submit: true }], callouts: {} },
		'9.8': { detect: '.popup', from: '9.5', entry: [{ press: 'OK' }], callouts: {} }
	}
};

describe('씨앗', () => {
	it('콜아웃에 손으로 이은 공통 요소·이름 대응·화면 정의는 뺀다', () => {
		const seed = seedOf(PROFILE);
		expect(Object.keys(seed.elements ?? {})).toEqual(['GNB 찾기']);
		expect(seed.aliases).toBeUndefined();
		expect(seed.screens).toEqual({});
	});

	it('검색어는 testData, 없으면 씨앗 진입에서 확인까지 보낸 글자', () => {
		expect(seedQuery(PROFILE)).toBe('b');
		expect(seedQuery({ ...PROFILE, testData: { query: 'x' } })).toBe('x');
	});
});

describe('planAutoEntries', () => {
	const plan = planAutoEntries(buildScreenGraph(SCREENS), PROFILE);

	it('첫 화면은 씨앗, 나머지는 이동 지도를 넓이 우선으로 따라가고, 못 가는 프로필 화면은 프로필 진입', () => {
		expect(plan.map((p) => [p.screen, p.from, p.source])).toEqual([
			['9.2', null, 'seed'],
			['9.1', '9.2', 'auto'],
			['9.5', '9.2', 'auto'],
			['9.6', '9.2', 'auto'],
			['9.8', '9.5', 'seed']
		]);
	});

	it('글자 입력을 말하는 이동은 앞 화면 입력란에 글자를 넣고 확인, 결과 없음 조건이면 @no-result', () => {
		const to = (id: string): ScreenEdge => plan.find((p) => p.screen === id)?.edge as ScreenEdge;
		const at = { inputCallout: '1', hasQuery: true };
		expect(edgeEntry(to('9.5'), at)).toEqual([{ focus: '9.2#1' }, { type: '@data:query', submit: true }]);
		expect(edgeEntry(to('9.6'), at)).toEqual([{ focus: '9.2#1' }, { type: '@no-result', submit: true }]);
		expect(edgeEntry(to('9.1'), at)).toEqual([{ focus: '9.2#1' }, { press: 'OK' }]);
		// 입력란을 못 찾으면 콜아웃에서 OK, 결과 없음은 만들 수 없음
		expect(edgeEntry(to('9.5'), { inputCallout: null, hasQuery: true })).toEqual([
			{ focus: '9.2#2' },
			{ press: 'OK' }
		]);
		expect(edgeEntry(to('9.6'), { inputCallout: null, hasQuery: true })).toContain('입력란');
	});
});

/** 0 body, 1 검색창(포커스 항목) > 2 input, 3 칩 줄 */
const SEARCH = snap([
	{ parent: -1, tag: 'body' },
	{ parent: 0, classes: ['Search_field'], focusable: true },
	{ parent: 1, tag: 'input' },
	{ parent: 0, classes: ['Chips_row'] }
]);
const RESULT = snap([
	{ parent: -1, tag: 'body' },
	{ parent: 0, classes: ['Search_field'], focusable: true },
	{ parent: 0, classes: ['Grid_grid'] }
]);
const linkOf = (screenId: string, selectors: [string, string, number[]][]): AppScreenLink => ({
	screenId,
	callouts: selectors.map(([no, selector, nodes]) => ({
		no,
		name: null,
		best: {
			node: nodes[0] ?? -1,
			nodes,
			score: 1,
			text: 0,
			overlap: 1,
			near: 1,
			focus: 1,
			texts: [],
			rect: r(0, 0, 1, 1)
		},
		sameBox: [],
		selector: { node: nodes[0] ?? -1, count: 1, selector, unique: true, stable: true },
		ambiguous: false,
		alternatives: [],
		reason: ''
	}))
});

describe('화면 이름', () => {
	it('이동 문장이 부른 이름을 도착 화면 이름에 더한다 (요소 부르기·가족 조건 이동은 빼고)', () => {
		const names = screenNamesFrom(buildScreenGraph(SCREENS));
		expect(names.get('9.5')).toEqual(['찾기 완료', '찾기 결과']);
		expect(names.get('9.6')).toEqual(['찾기 완료 - 찾기 결과 없음']);
		expect(names.get('9.1')).toEqual(['찾기 - 최초 진입 시(키보드 활성화)']);
	});
});

describe('화면 표시·입력란', () => {
	const links = new Map([
		[
			'9.2',
			linkOf('9.2', [
				['1', '.Search_field', [1]],
				['2', '.Chips_row', [3]]
			])
		],
		[
			'9.5',
			linkOf('9.5', [
				['1', '.Search_field', [1]],
				['2', '.Grid_grid', [2]]
			])
		]
	]);

	it('화면마다 다른 화면에 없는 콜아웃 선택자를 표시로 고른다', () => {
		const d = chooseDetects(
			new Map([
				['9.2', SEARCH],
				['9.5', RESULT]
			]),
			links
		);
		expect(d.get('9.2')?.selector).toBe('.Chips_row');
		expect(d.get('9.5')?.selector).toBe('.Grid_grid');
	});

	it('입력 요소를 담은 콜아웃이 입력란', () => {
		expect(inputCallout(links.get('9.2') as AppScreenLink, SEARCH)).toBe('1');
		expect(inputCallout(links.get('9.5') as AppScreenLink, RESULT)).toBeNull();
	});

	it('보이는 요소가 모두 같으면 화면이 그대로 (포커스만 옮긴 것은 같은 화면)', () => {
		const moved = { ...SEARCH, nodes: SEARCH.nodes.map((n) => ({ ...n, focused: n.i === 1 })) };
		expect(sameView(SEARCH, moved)).toBe(true);
		expect(sameView(SEARCH, RESULT)).toBe(false);
	});

	it('앞 화면과 구별되지 않는 표시는 앞 화면 표시를 함께 쓰고, 첫 화면은 씨앗, 못 고르면 주어진 프로필', () => {
		const shared = { selector: '.cities', sharedWith: ['9.2', '9.3'], reason: '' };
		const at = { current: ':not(*)', from: '9.2', fromDetect: '.panel', given: '.given' };
		expect(settleDetect(shared, at).detect).toBe('.panel');
		expect(settleDetect({ ...shared, sharedWith: ['9.3'] }, at).detect).toBe('.cities');
		expect(settleDetect(null, at).detect).toBe('.given');
		expect(settleDetect(null, { ...at, given: null }).detect).toBe(':not(*)');
		expect(settleDetect(shared, { ...at, current: '.seed', from: null }).detect).toBe('.seed');
	});
});
