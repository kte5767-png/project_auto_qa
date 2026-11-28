import { describe, expect, it } from 'vitest';
import { buildScreenGraph, splitTitle } from './screenGraph';
import type { GraphCallout, GraphScreen } from './screenGraph';

/**
 * 합성 화면설계서 (실제 문형을 본뜬 지어낸 문장). 제목은 "바탕 - 상태" 꼴:
 * 9.1·9.2 = "찾기" 페이지의 키보드 열림·닫힘, 9.5·9.6 = "찾기 완료" 페이지와 그 결과 없음 상태
 */
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
		title: '찾기 - 최초 진입 시(키보드 활성화)',
		entryConditions: ['찾기 페이지 최초 진입 시 화면'],
		callouts: [
			sel('1', '입력창', ['포커스 이동 후 확인 키 입력할 경우 VKB 호출']),
			sel('2', '키보드', ['(#9.2. 찾기 화면 - VKB 닫힘 페이지로 이동)'])
		]
	},
	{
		screenId: '9.2',
		title: '찾기 - VKB 닫힘',
		entryConditions: [],
		callouts: [
			sel('1', '입력창', [
				'VKB 호출',
				'최근 기록 영역 제공 (#9.3. 최근 기록 있을 경우 페이지 참고)',
				'검색어 입력 후 확인 시 결과가 없을 경우 결과 없음 페이지로 이동'
			]),
			sel('2', '추천 단어', [
				'[▲]: 입력창 포커스',
				'이동한 이력이 있을 경우: 마지막 포커스한 항목으로 이동',
				'단어 선택 시 해당 단어가 입력된 찾기 결과 페이지로 이동'
			]),
			{
				no: '3',
				names: ['카드 목록'],
				sections: [{ title: '2)포커스 된 상태에서 4way key 입력 시', items: ['[▼]: 아래 목록으로 이동'] }]
			},
			sel('4', '콘텐츠', ['콘텐츠 타입일 경우 콘텐츠 상세 페이지로 진입'])
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
		title: '찾기 완료',
		entryConditions: [],
		callouts: [sel('1', 'Back 버튼', ['찾기 페이지로 이동'])]
	},
	{
		screenId: '9.6',
		title: '찾기 완료 - 찾기 결과 없음(찾기 결과가 없을 경우)',
		entryConditions: [],
		callouts: [sel('3', '추천', ['선택한 단어가 입력된 찾기 결과 페이지로 이동'])]
	}
];

describe('splitTitle', () => {
	it('제목을 바탕과 상태로 나눈다', () => {
		expect(splitTitle('찾기 완료 - 찾기 결과 없음(찾기 결과가 없을 경우)')).toEqual({
			base: '찾기 완료',
			state: '찾기 결과 없음(찾기 결과가 없을 경우)'
		});
		expect(splitTitle('찾기 완료')).toEqual({ base: '찾기 완료', state: null });
	});
});

describe('buildScreenGraph', () => {
	const g = buildScreenGraph(SCREENS);
	const edge = (from: string, callout: string) => g.edges.filter((e) => e.from === from && e.callout === callout);

	it('화면 번호로 적힌 이동 (참고가 아닌 괄호)', () => {
		expect(edge('9.1', '2')).toMatchObject([{ to: '9.2', how: 'number', action: 'select' }]);
	});

	it('"VKB 호출"처럼 요소를 부르면 그 요소가 제목에 든 화면 (줄임말, 닫힘 상태 제외)', () => {
		expect(edge('9.2', '1').filter((e) => e.how === 'element')).toMatchObject([{ to: '9.1', action: 'select' }]);
		// 9.1에서 부르면 9.1 안의 요소 → 이동 아님
		expect(edge('9.1', '1')).toEqual([]);
		expect(g.unresolved.find((u) => u.from === '9.1' && u.callout === '1')?.reason).toContain('이 화면 안에 있음');
	});

	it('꾸밈말을 떼고, 이름이 가족 화면 제목에 걸리면 가족 안에서 조건으로 고르고 결과 없음 상태는 조건부로 함께 낸다', () => {
		expect(edge('9.2', '2')).toMatchObject([
			{ to: '9.5', how: 'name', condition: null, typed: true, derived: false },
			{ to: '9.6', derived: true, condition: '찾기 결과 없음(찾기 결과가 없을 경우)' }
		]);
		// 결과 없음 화면에서 같은 문장 → 결과 있는 화면으로만
		expect(edge('9.6', '3')).toMatchObject([{ to: '9.5', derived: false }]);
	});

	it('글자 입력 후 확인과 "~ 경우" 조건을 함께 읽는다', () => {
		expect(edge('9.2', '1').filter((e) => e.how !== 'element')).toMatchObject([
			{ to: '9.6', action: 'submit', condition: '검색어 입력 후 확인 시 결과가 없을 경우' }
		]);
	});

	it('참고 괄호·키 줄·키 줄 아래 조건 줄·키 입력 묶음은 이동으로 보지 않는다', () => {
		expect(g.edges.some((e) => e.to === '9.3')).toBe(false);
		expect(edge('9.2', '3')).toEqual([]);
	});

	it('번호로 가리킨 참고 괄호는 참고 목록에 대상 화면의 진입 조건과 함께 남긴다', () => {
		expect(g.references).toMatchObject([
			{ from: '9.2', callout: '1', to: '9.3', condition: '최근 기록이 있을 경우 찾기 페이지 진입 시 화면' }
		]);
	});

	it('정하지 못한 이동은 이유와 함께 남긴다 (추측하지 않음)', () => {
		const reasons = g.unresolved.map((u) => `${u.from}#${u.callout} ${u.reason}`);
		// 이 화면설계서에 없는 화면
		expect(reasons.find((r) => r.startsWith('9.2#4'))).toContain('이름이 맞는 화면이 없음');
		// "찾기 페이지" → 9.1·9.2 모두 바탕이 "찾기"이고 둘 다 결과 없음 상태가 아니라 정할 수 없음
		expect(reasons.find((r) => r.startsWith('9.5#1'))).toContain('하나로 정할 수 없음');
	});
});
