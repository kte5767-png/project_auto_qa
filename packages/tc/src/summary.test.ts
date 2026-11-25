import { describe, expect, it } from 'vitest';
import { normalize } from './normalize';
import { suggestProfile } from './suggest';
import { summarize } from './summary';
import { NUMBERED_HEADER, ROW_PER_STEP_HEADER, gridSheet, defined } from './testing';
import type { Grid } from './grid';

const grid: Grid = {
	sheets: [
		gridSheet('Home', [
			ROW_PER_STEP_HEADER,
			['scenario_v1.0_3.1', 'Home', '이동', '1', '', '(1) GNB 영역', '포커스', '', ''],
			['', '', '', '2', 'Audio Guidance <ON> 상태', '진입 시', '<"Home">', '', '']
		]),
		gridSheet('Main', [
			NUMBERED_HEADER,
			['', '실행', '1', '', '1', '1. 실행', '1. 표시', '', ''],
			['', '', '', '', '2', '1. Seq 1 수행', '1. 유지', '', ''],
			['', '', '', '', '3', '1. Seq 7 수행', '1. 유지', '', '']
		]),
		gridSheet('Log', [['context_name', 'message_id']])
	]
};

describe('summarize', () => {
	const profile = suggestProfile(grid);
	const s = summarize(profile, normalize(grid, profile));

	it('시트별 TC·단계·라벨·참조 수를 센다', () => {
		expect(s.sheets.map((x) => [x.sheet, x.included, x.cases, x.steps])).toEqual([
			['Home', true, 1, 2],
			['Main', true, 1, 3],
			['Log', false, 0, 0]
		]);
		const home = defined(s.sheets[0]);
		expect(home.labels).toMatchObject({ auto: 1, deferred: 1 });
		expect(home).toMatchObject({ resultCells: 2, specRefs: 1, targetRefs: 1 });
		expect(defined(s.sheets[1]).references).toEqual({ total: 2, resolved: 1, ambiguous: 0 });
		expect(defined(s.sheets[1]).diagnostics).toBe(1);
	});

	it('합계와 자동화 가능 비율', () => {
		expect(s.total).toMatchObject({ cases: 2, steps: 5, resultCells: 5, diagnostics: 1 });
		expect(s.total.labels).toMatchObject({ auto: 4, deferred: 1 });
		expect(s.automatableRatio).toBeCloseTo(0.8);
	});
});
