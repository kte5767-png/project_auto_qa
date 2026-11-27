import { describe, expect, it } from 'vitest';
import { buildScreenGraph } from './screenGraph';
import type { GraphCallout, GraphScreen } from './screenGraph';

/** 합성 화면설계서 (실제 문형을 본뜬 지어낸 문장) */
const sel = (no: string, name: string, items: string[]): GraphCallout => ({
	no,
	names: [name],
	sections: [
		{ title: '1)표시 내용', items: ['아이콘 버튼'] },
		{ title: '2)선택 시', items }
	]
});

const SCREENS: GraphScreen[] = [
	{
		screenId: '9.1',
		title: '찾기 - 키보드 열림',
		entryConditions: ['찾기 페이지 최초 진입 시 화면'],
		callouts: [sel('2', '키보드', ['(#9.2. 찾기 화면 - 키보드 닫힘 페이지로 이동)'])]
	},
	{
		screenId: '9.2',
		title: '찾기 - 키보드 닫힘',
		entryConditions: [],
		callouts: [
			sel('1', '입력창', [
				'키보드 호출',
				'최근 기록 영역 제공 (#9.3. 최근 기록 있을 경우 페이지 참고)',
				'검색어 입력 후 확인 시 결과가 없을 경우 결과 없음 페이지로 이동'
			]),
			sel('2', '추천 단어', [
				'[▲]: 입력창 포커스',
				'이동한 이력이 있을 경우: 마지막 포커스한 항목으로 이동',
				'선택한 단어가 입력된 찾기 결과 페이지로 이동'
			]),
			{
				no: '3',
				names: ['카드 목록'],
				sections: [{ title: '2)포커스 된 상태에서 4way key 입력 시', items: ['[▼]: 아래 목록으로 이동'] }]
			}
		]
	},
	{
		screenId: '9.3',
		title: '최근 기록 있을 경우',
		entryConditions: ['최근 기록이 있을 경우 찾기 페이지 진입 시 화면'],
		callouts: []
	},
	{
		screenId: '9.5',
		title: '찾기 결과',
		entryConditions: [],
		callouts: [sel('1', 'Back 버튼', ['찾기 페이지로 이동'])]
	},
	{ screenId: '9.6', title: '찾기 결과 없음', entryConditions: [], callouts: [] }
];

describe('buildScreenGraph', () => {
	const g = buildScreenGraph(SCREENS);
	const edge = (from: string, callout: string) => g.edges.filter((e) => e.from === from && e.callout === callout);

	it('화면 번호로 적힌 이동 (참고가 아닌 괄호)', () => {
		expect(edge('9.1', '2')).toMatchObject([{ to: '9.2', how: 'number', action: 'select' }]);
	});

	it('화면 이름으로 적힌 이동: 이름 낱말이 모두 든 화면 중 하나로 정해질 때만', () => {
		expect(edge('9.2', '2')).toMatchObject([{ to: '9.5', how: 'name', action: 'select', condition: null }]);
	});

	it('글자 입력 후 확인과 "~ 경우" 조건을 함께 읽는다', () => {
		expect(edge('9.2', '1')).toMatchObject([
			{ to: '9.6', action: 'submit', condition: '검색어 입력 후 확인 시 결과가 없을 경우' }
		]);
	});

	it('참고 괄호·키 줄·키 줄 아래 조건 줄·키 입력 묶음은 이동으로 보지 않는다', () => {
		expect(g.edges.some((e) => e.to === '9.3')).toBe(false);
		expect(edge('9.2', '3')).toEqual([]);
		expect(g.edges.filter((e) => e.from === '9.2' && e.callout === '2')).toHaveLength(1);
	});

	it('번호로 가리킨 참고 괄호는 참고 목록에 대상 화면의 진입 조건과 함께 남긴다', () => {
		expect(g.references).toMatchObject([
			{ from: '9.2', callout: '1', to: '9.3', condition: '최근 기록이 있을 경우 찾기 페이지 진입 시 화면' }
		]);
	});

	it('정하지 못한 이동은 이유와 함께 남긴다 (추측하지 않음)', () => {
		const reasons = g.unresolved.map((u) => `${u.from}#${u.callout} ${u.reason}`);
		expect(reasons).toContain('9.2#1 이동할 화면 이름을 찾지 못함');
		// "찾기 페이지" → 9.1·9.2 모두 "찾기"를 담고 있어 정할 수 없음
		expect(reasons.find((r) => r.startsWith('9.5#1'))).toContain('하나로 정할 수 없음');
	});
});
