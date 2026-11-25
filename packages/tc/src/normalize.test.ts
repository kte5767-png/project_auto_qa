import { describe, expect, it } from 'vitest';
import { normalize, parseSpecRef, parseTargetRef, splitNumbered } from './normalize';
import { suggestProfile } from './suggest';
import { NUMBERED_HEADER, ROW_PER_STEP_HEADER, gridSheet, defined } from './testing';
import type { Grid } from './grid';

// 5~6행은 조작·기대 결과·P/F가 함께 병합된 한 단계
const home = gridSheet(
	'Home',
	[
		ROW_PER_STEP_HEADER,
		['scenario_v1.0_3.1', 'Home', 'GNB 이동', '1', '앱 실행 상태', '(1) GNB 영역', '첫 메뉴 포커스', '', 'Major'],
		['', '', '', '2', '', '[▶] 입력', '1. 두 번째 메뉴로 이동\n2. 밑줄 표시', 'P', ''],
		['scenario_v1.0_3.2', 'Home', '배너', '1', '', '( 2-1 ) Banner 영역', '배너 확대', '', ''],
		['', '', '', '2', '', '[OK] 입력', '상세 화면 진입', '', ''],
		['', '', '', '', '', '', '', '', ''],
		[
			'scenario_v1.0_policy_2.',
			'Policy',
			'오류',
			'1',
			'Audio Guidance <ON> 상태',
			'화면 진입 시',
			'<"Network error">',
			'',
			''
		],
		['', '', '', '', '', '', '', '', 'Minor']
	],
	{
		merges: [
			{ top: 5, left: 6, bottom: 6, right: 6 },
			{ top: 5, left: 7, bottom: 6, right: 7 },
			{ top: 5, left: 8, bottom: 6, right: 8 }
		]
	}
);

const main = gridSheet('Main', [
	NUMBERED_HEADER,
	['', '앱 실행', '1', '1. 홈에서 실행', '1', '1. 앱 실행\n2. 홈 화면 확인', '1. 홈 화면 표시', '', ''],
	['', '', '', '', '2', '1. Seq 1 수행\n2. [▼] 입력', '1. 다음 행 포커스', '', 'F'],
	['', '목록', '2', '', '1', '1. 목록 진입', '1. 목록 표시', '', ''],
	['', '', '', '', '1', '1. Seq 1 수행\n2. 다시 진입', '1. 같은 결과', '', ''],
	['', '', '', '', '2', '1. seq.1 수행', '1. 목록 유지', '', ''],
	['', '', '', '', '3', '1. Seq 9 수행', '1. 확인', '', '']
]);

const grid: Grid = { sheets: [home, main] };

describe('splitNumbered', () => {
	it('번호 목록을 항목으로 나누고, 번호 없는 줄은 앞 항목에 붙인다', () => {
		expect(splitNumbered('1. A\n이어지는 줄\n2) B')).toEqual(['A\n이어지는 줄', 'B']);
		expect(splitNumbered('번호 없음')).toEqual(['번호 없음']);
		expect(splitNumbered(null)).toEqual([]);
	});
});

describe('parseSpecRef', () => {
	const pattern = '^scenario_v([\\d.]+)_(.+)$';
	it('TC ID에서 화면설계서 버전과 화면 번호를 꺼낸다', () => {
		expect(parseSpecRef('scenario_v1.2.3_4.1', pattern)).toEqual({ raw: '4.1', version: '1.2.3', screenId: '4.1' });
		expect(parseSpecRef('scenario_v1.2.3_policy_2.', pattern)).toEqual({
			raw: 'policy_2',
			version: '1.2.3',
			screenId: null
		});
	});

	it('형식이 다르거나 규칙이 없으면 null', () => {
		expect(parseSpecRef('TC-001', pattern)).toBeNull();
		expect(parseSpecRef('scenario_v1_1', null)).toBeNull();
	});
});

describe('parseTargetRef', () => {
	const pattern = '^\\(\\s*(\\d+(?:-\\d+)*|[A-Z])\\s*\\)\\s*(.+)$';
	it('조작 첫 줄의 "(번호) 이름 영역"을 콜아웃 참조로 읽는다', () => {
		expect(parseTargetRef('( 2-1 ) Search field 영역\n[OK] 입력', pattern)).toEqual({
			callout: '2-1',
			label: 'Search field'
		});
		expect(parseTargetRef('(A) Button', pattern)).toEqual({ callout: 'A', label: 'Button' });
	});

	it('참조가 없으면 null', () => {
		expect(parseTargetRef('[OK] 입력', pattern)).toBeNull();
		expect(parseTargetRef('(1) 이름', null)).toBeNull();
	});
});

describe('normalize: 행마다 한 단계', () => {
	const profile = suggestProfile(grid);
	const { cases, diagnostics } = normalize(grid, profile);
	const homeCases = cases.filter((c) => c.sheet === 'Home');

	it('ID·제목이 있는 행에서 TC를 시작하고 아래 행은 이어받는다', () => {
		expect(homeCases.map((c) => [c.key, c.firstRow, c.lastRow, c.steps.length])).toEqual([
			['Home!2', 2, 3, 2],
			['Home!4', 4, 6, 2],
			['Home!7', 7, 7, 1]
		]);
		expect(homeCases[0]).toMatchObject({ id: 'scenario_v1.0_3.1', title: 'GNB 이동', category: 'Home' });
	});

	it('병합된 행은 한 단계로 보고, 결과 칸은 병합의 왼쪽 위 칸', () => {
		const merged = defined(defined(homeCases[1]).steps[1]);
		expect(merged).toMatchObject({ row: 5, rowSpan: 2, action: '[OK] 입력' });
		expect(merged.resultCell).toEqual({ sheet: 'Home', row: 5, column: 'H', address: 'H5' });
	});

	it('단계마다 결과 칸·기존 결과·화면설계서·콜아웃 참조를 붙인다', () => {
		const [first, second] = defined(homeCases[0]).steps;
		expect(first?.resultCell?.address).toBe('H2');
		expect(second?.existingResult).toBe('P');
		expect(second?.expectedItems).toEqual(['두 번째 메뉴로 이동', '밑줄 표시']);
		expect(defined(homeCases[0]).specRef).toEqual({ raw: '3.1', version: '1.0', screenId: '3.1' });
		expect(defined(homeCases[2]).specRef?.screenId).toBeNull();
		expect(first?.targetRef).toEqual({ callout: '1', label: 'GNB' });
		expect(defined(defined(homeCases[1]).steps[0]).targetRef).toEqual({ callout: '2-1', label: 'Banner' });
	});

	it('자동화 라벨을 붙인다 (음성 안내 ON 조건 → 보류)', () => {
		expect(defined(defined(homeCases[0]).steps[0]).automation).toBe('auto');
		expect(defined(homeCases[2]).steps[0]).toMatchObject({
			automation: 'deferred',
			automationRule: 'audio-guidance'
		});
	});

	it('조작·기대 결과 없이 다른 칸에만 값이 있는 행을 알린다', () => {
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ sheet: 'Home', row: 8, kind: 'unmapped-content' })
		);
	});
});

describe('normalize: 번호 목록과 앞 단계 참조', () => {
	const { cases, diagnostics } = normalize(grid, suggestProfile(grid));
	const mainCases = cases.filter((c) => c.sheet === 'Main');

	it('제목으로 묶고 한 칸 안의 번호 목록을 나눈다', () => {
		expect(mainCases.map((c) => [c.title, c.steps.length])).toEqual([
			['앱 실행', 2],
			['목록', 4]
		]);
		expect(defined(defined(mainCases[0]).steps[0]).actions).toEqual(['앱 실행', '홈 화면 확인']);
		expect(defined(defined(mainCases[0]).steps[1]).resultCell?.address).toBe('I3');
		expect(defined(defined(mainCases[0]).steps[1]).existingResult).toBe('F');
	});

	it('"Seq N 수행"을 같은 TC 안 가장 가까운 단계 N으로 연결한다', () => {
		expect(defined(defined(mainCases[0]).steps[1]).references).toEqual([{ stepNo: '1', row: 2, ambiguous: false }]);
		expect(defined(defined(mainCases[1]).steps[2]).references).toEqual([{ stepNo: '1', row: 5, ambiguous: true }]);
		expect(diagnostics).toContainEqual(expect.objectContaining({ row: 6, kind: 'ambiguous-reference' }));
	});

	it('찾지 못한 참조는 진단으로 남긴다', () => {
		expect(defined(defined(mainCases[1]).steps[3]).references).toEqual([
			{ stepNo: '9', row: null, ambiguous: false }
		]);
		expect(diagnostics).toContainEqual(expect.objectContaining({ row: 7, kind: 'unresolved-reference' }));
	});
});

describe('normalize: 프로필', () => {
	it('포함하지 않은 시트는 읽지 않고, 없는 시트는 알린다', () => {
		const profile = suggestProfile(grid);
		defined(profile.sheets[1]).include = false;
		profile.sheets.push({ ...defined(profile.sheets[0]), sheet: 'Missing' });
		const { cases, diagnostics } = normalize(grid, profile);
		expect(new Set(cases.map((c) => c.sheet))).toEqual(new Set(['Home']));
		expect(diagnostics).toContainEqual(expect.objectContaining({ sheet: 'Missing', row: 0 }));
	});

	it('첫 TC 앞에 묶기 기준 없이 시작하는 행을 알린다', () => {
		const sheet = gridSheet('Loose', [ROW_PER_STEP_HEADER, ['', '', '', '1', '', '조작', '결과', '', '']]);
		const profile = suggestProfile({ sheets: [home] });
		const loose = { ...defined(profile.sheets[0]), sheet: 'Loose' };
		const { cases, diagnostics } = normalize({ sheets: [sheet] }, { version: 1, sheets: [loose] });
		expect(cases).toHaveLength(1);
		expect(diagnostics).toContainEqual(expect.objectContaining({ kind: 'no-group-start', row: 2 }));
	});

	it('같은 입력이면 같은 결과', () => {
		const profile = suggestProfile(grid);
		expect(normalize(grid, profile)).toEqual(normalize(grid, profile));
	});
});
