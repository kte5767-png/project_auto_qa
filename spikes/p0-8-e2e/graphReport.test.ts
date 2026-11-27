import { buildScreenGraph } from '@auto-qa/planner';
import type { GraphCallout, GraphScreen } from '@auto-qa/planner';
import { describe, expect, it } from 'vitest';
import { gradeGraph, graphReportText, profileMoves, summarizeGraph } from './graphReport';
import { buildRegistry } from './profile';
import type { AppProfile } from './profile';

/** 합성 화면설계서 (실제 문형을 본뜬 지어낸 문장) */
const sel = (no: string, items: string[]): GraphCallout => ({
	no,
	names: [`콜아웃 ${no}`],
	sections: [{ title: '2)선택 시', items }]
});

const SCREENS: GraphScreen[] = [
	{
		screenId: '9.1',
		title: '찾기 - 키보드 열림',
		entryConditions: [],
		callouts: [sel('2', ['(#9.2. 찾기 - 키보드 닫힘 페이지로 이동)'])]
	},
	{
		screenId: '9.2',
		title: '찾기 - 키보드 닫힘',
		entryConditions: [],
		callouts: [
			sel('1', [
				'최근 기록 영역 제공 (#9.3. 최근 기록 있을 경우 페이지 참고)',
				'검색어 입력 후 확인 시 결과가 없을 경우 결과 없음 페이지로 이동'
			]),
			sel('2', ['선택한 단어가 입력된 찾기 결과 페이지로 이동'])
		]
	},
	{
		screenId: '9.3',
		title: '최근 기록 있을 경우',
		entryConditions: ['최근 기록이 있을 경우 찾기 페이지 진입 시 화면'],
		callouts: []
	},
	{ screenId: '9.5', title: '찾기 결과', entryConditions: [], callouts: [sel('1', ['찾기 페이지로 이동'])] },
	{ screenId: '9.6', title: '찾기 결과 없음', entryConditions: [], callouts: [] },
	{ screenId: '9.7', title: '상세', entryConditions: [], callouts: [] }
];

const screen = (
	from: string | undefined,
	entry: AppProfile['screens'][string]['entry'],
	callouts = {}
): AppProfile['screens'][string] => ({
	detect: '.x',
	...(from === undefined ? {} : { from }),
	entry,
	callouts
});

const PROFILE: AppProfile = {
	format: 'auto-qa/app-profile',
	version: 1,
	name: 't',
	url: 'http://x',
	elements: { 'GNB 검색': { selector: '.gnb-search' } },
	screens: {
		'9.1': screen(undefined, [{ press: 'LEFT', until: 'GNB 검색', max: 3 }, { press: 'OK' }], {
			'2': { selector: '.kbd' }
		}),
		'9.2': screen('9.1', [{ press: 'DOWN', until: '9.1#2', max: 3 }, { press: 'OK' }], {
			'1': { selector: '.input' },
			'2': { selector: '.chip' }
		}),
		'9.3': screen('9.2', [{ type: 'b', submit: true }, { press: 'BACK' }]),
		'9.5': screen('9.2', [{ press: 'UP', until: '9.2#1', max: 3 }, { press: 'OK' }]),
		'9.6': screen('9.2', [
			{ press: 'UP', until: '9.2#1', max: 3 },
			{ type: '@no-result', submit: true }
		]),
		'9.7': screen('9.5', [{ press: 'OK' }])
	}
};

describe('gradeGraph', () => {
	const graph = buildScreenGraph(SCREENS);
	const moves = profileMoves(PROFILE, buildRegistry(PROFILE));
	const rows = gradeGraph(graph, moves);
	const row = (id: string) => rows.find((r) => r.screen === id);

	it('프로필 진입 경로에서 앞 화면·마지막 OK·확인 전에 맞춘 콜아웃을 읽는다', () => {
		expect(moves.find((m) => m.screen === '9.6')).toMatchObject({
			from: '9.2',
			via: { screen: '9.2', no: '1' },
			action: 'submit',
			typed: '@no-result',
			back: false
		});
		expect(moves.find((m) => m.screen === '9.1')).toMatchObject({
			from: null,
			via: null,
			element: 'GNB 검색',
			action: 'select'
		});
		expect(moves.find((m) => m.screen === '9.3')).toMatchObject({ action: 'submit', back: true });
	});

	it('같은 앞 화면·같은 콜아웃이면 일치, 다른 콜아웃이면 다른 콜아웃', () => {
		expect(row('9.2')?.grade).toBe('match');
		expect(row('9.6')).toMatchObject({ grade: 'match', actionDiffers: false });
		expect(row('9.5')?.grade).toBe('other-callout');
	});

	it('이동은 없고 참고로 가리키면 상태 변형, 앞 화면이 없으면 첫 화면에서, 둘 다 아니면 없음', () => {
		expect(row('9.3')?.grade).toBe('reference');
		expect(row('9.1')?.grade).toBe('root');
		expect(row('9.7')).toMatchObject({ grade: 'missing' });
		expect(row('9.7')?.unresolved.map((u) => u.callout)).toEqual(['1']);
	});

	it('요약과 리포트 (화면설계서 문장을 뺀 요약)', () => {
		expect(summarizeGraph(graph, rows)).toMatchObject({ screens: 6, graded: 5, found: 3, match: 2, missing: 1 });
		const masked = graphReportText(graph, rows, false).join('\n');
		expect(masked).toContain('찾음 3/5 (60%)');
		expect(masked).not.toContain('결과 없음 페이지로');
		expect(masked).not.toContain('"찾기"');
		expect(graphReportText(graph, rows).join('\n')).toContain('결과 없음 페이지로');
	});
});
