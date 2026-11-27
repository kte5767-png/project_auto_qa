import type { TcCase, TcStep } from '@auto-qa/tc';
import { describe, expect, it } from 'vitest';
import { planMutations } from './mutate';

/** 합성 TC (회사 자료 아님): 9.2 화면 콜아웃 ①·②, 9.3 화면 콜아웃 ① */
function step(row: number, callout: string, label: string, expected: string): TcStep {
	return {
		row,
		rowSpan: 1,
		stepNo: null,
		caseNo: null,
		precondition: null,
		action: `(${callout}) ${label}`,
		actions: [`(${callout}) ${label}`],
		expected,
		expectedItems: [expected],
		note: null,
		resultCell: null,
		existingResult: null,
		references: [],
		targetRef: { callout, label },
		automation: 'auto',
		automationRule: 'test',
		automationReason: 'test'
	};
}

function tcCase(screen: string, steps: TcStep[]): TcCase {
	return {
		key: `Search!${steps[0]?.row ?? 0}`,
		sheet: 'Search',
		id: `scenario_v1.0_${screen}`,
		title: null,
		category: null,
		firstRow: steps[0]?.row ?? 0,
		lastRow: steps.at(-1)?.row ?? 0,
		specRef: { raw: screen, version: null, screenId: screen },
		steps
	};
}

const CASES = [
	tcCase('9.2', [
		step(2, '1', 'Search box', '1)포커스 시\n[▲] 동작 없음\n[▼] Top Picks 첫 번째 항목 포커스'),
		step(3, '2', 'Top Picks', '[▲] Search box 포커스\n[▼] 동작 없음'),
		step(4, '3', 'Weekly Cities', '[▲] Top Picks 포커스')
	]),
	tcCase('9.3', [step(9, '1', 'Recent', '[▼] 동작 없음')])
];

const pass = (clause: string): { clause: string; kind: string; verdict: string } => ({
	clause,
	kind: 'key',
	verdict: 'pass'
});

describe('planMutations', () => {
	const baseline = [
		{
			key: 'Search!2',
			status: 'fail',
			results: [
				{ clause: '[▼] Top Picks 첫 번째 항목 포커스', kind: 'key', verdict: 'fail' },
				pass('[▲] 동작 없음')
			]
		},
		{ key: 'Search!3', status: 'pass', results: [pass('[▲] Search box 포커스'), pass('[▼] 동작 없음')] },
		{
			key: 'Search!4',
			status: 'needs-review',
			results: [{ clause: '[▲] Top Picks 포커스', kind: 'key', verdict: null }]
		},
		{ key: 'Search!9', status: 'pass', results: [pass('[▼] 동작 없음')] }
	];
	const plan = planMutations(CASES, baseline, () => 'G', null);

	it('원래 실행에서 Pass였던 키 조건만, 단계마다 하나씩 바꾼다', () => {
		expect(plan.mutations.map((m) => [m.key, m.op, m.before, m.after])).toEqual([
			['Search!2', 'none-to-move', '[▲] 동작 없음', '[▲] Top Picks 포커스'],
			['Search!3', 'move-to-none', '[▲] Search box 포커스', '[▲] 동작 없음']
		]);
		expect(plan.mutations[0]?.cell).toEqual({ sheet: 'Search', row: 2, column: 'G', address: 'G2' });
		expect(plan.mutations[1]?.text).toBe('[▲] 동작 없음\n[▼] 동작 없음');
	});

	it('Pass인 키 조건이 없거나, 같은 화면에 다른 콜아웃 이름이 없으면 건너뛴다 (측정에서 뺌)', () => {
		expect(plan.skipped).toEqual([
			{ key: 'Search!4', reason: '원래 실행에서 Pass인 조건이 없음 (key)' },
			{ key: 'Search!9', reason: 'Pass인 조건을 바꿀 수 없음 (다른 콜아웃 이름·보인 개수·문구 없음)' }
		]);
	});

	it('시트를 고르면 그 시트만', () => {
		expect(planMutations(CASES, baseline, () => 'G', 'Home').mutations).toEqual([]);
	});
});

describe('planMutations — 개수·문구', () => {
	const expected = [
		'1)표시 내용',
		'- 최대 5개까지 제공',
		'- 타이틀 “Top Picks” 제공',
		'2)포커스 시',
		'[▲] 동작 없음'
	].join('\n');
	const cases = [tcCase('9.4', [step(12, '1', 'Top Picks', expected), step(13, '2', 'Weekly', '[▲] 동작 없음')])];
	const baseline = [
		{
			key: 'Search!12',
			status: 'pass',
			results: [
				{ clause: '최대 5개까지 제공', kind: 'count', verdict: 'pass', value: 5, observed: 4 },
				{ clause: '타이틀 “Top Picks” 제공', kind: 'exact-text', verdict: 'pass', value: 'Top Picks' },
				pass('[▲] 동작 없음')
			]
		}
	];

	it('종류마다 하나씩 바꾸고, 한 칸에 모두 겹쳐 쓴다', () => {
		const plan = planMutations(cases, baseline, () => 'G', null, ['key', 'count', 'exact-text']);
		expect(plan.mutations.map((m) => [m.kind, m.op, m.after])).toEqual([
			['key', 'none-to-move', '[▲] Weekly 포커스'],
			['count', 'count-below', '최대 3개까지 제공'],
			['exact-text', 'text-changed', '타이틀 “Top Picks 틀림” 제공']
		]);
		const text = plan.mutations[0]?.text ?? '';
		expect(plan.mutations.every((m) => m.text === text)).toBe(true);
		expect(text).toContain('최대 3개까지 제공');
		expect(text).toContain('“Top Picks 틀림”');
		expect(text).toContain('[▲] Weekly 포커스');
	});

	it('고른 종류만 바꾼다 (보인 개수가 없으면 개수는 못 바꿈)', () => {
		const plan = planMutations(cases, baseline, () => 'G', null, ['count']);
		expect(plan.mutations.map((m) => m.after)).toEqual(['최대 3개까지 제공']);
		const noSeen = [{ ...baseline[0], results: [{ clause: '최대 5개까지 제공', kind: 'count', verdict: 'pass' }] }];
		const none = planMutations(cases, noSeen as typeof baseline, () => 'G', null, ['count']);
		expect(none.mutations).toEqual([]);
		expect(none.skipped[0]?.key).toBe('Search!12');
	});
});
