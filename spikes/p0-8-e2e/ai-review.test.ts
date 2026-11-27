import { messagesFor } from '@auto-qa/llm';
import { describe, expect, it } from 'vitest';
import { judgeCase, pickItems, renderReview, summarize } from './ai-review';
import type { ReviewResult, RunStepLite } from './ai-review';

/** 합성 실행 결과 (회사 자료 아님) */
const STEPS: RunStepLite[] = [
	{
		key: 'Search!2',
		title: '검색 옵션',
		screen: '9.4',
		status: 'needs-review',
		screenshot: 'Search-2.png',
		shots: { 'ok-before': 'Search-2-ok-before.png', 'ok-after': 'Search-2-ok-after.png' },
		results: [
			{ clause: '저장 On/Off 가능', kind: 'toggle', verdict: 'pass', explanation: '바뀜' },
			{
				clause: '선택 시 팝업 노출',
				kind: 'behavior',
				verdict: 'needs-review',
				explanation: '조작 → 결과 자동 확인은 아직 없음',
				shots: ['ok-before', 'ok-after']
			},
			{ clause: '타이틀 제공', kind: 'presence', verdict: 'pass', explanation: '글자 있음' },
			{ clause: '[▲] 동작 없음', kind: 'key', verdict: 'pass', explanation: '그대로' },
			{ clause: '목록 제공', kind: 'presence', verdict: 'needs-review', explanation: '4번에 가지 못함' }
		]
	},
	{ key: 'Search!3', title: null, screen: '9.4', status: 'not-run', screenshot: null, results: [] }
];

describe('pickItems', () => {
	it('코드가 정하지 못한 조건만 고르고, OK 결과는 OK 전후 화면 2장을 준다', () => {
		const items = pickItems(STEPS, false);
		expect(items.map((i) => [i.key, i.kind, i.mode, i.images])).toEqual([
			['Search!2', 'behavior', 'review', ['Search-2-ok-before.png', 'Search-2-ok-after.png']]
		]);
		expect(items[0]?.note).toContain('코드가 정하지 못한 이유');
	});

	it('--shadow면 코드가 판정한 조건도 고르되, 코드 설명은 주지 않고 키 이동은 뺀다', () => {
		const shadow = pickItems(STEPS, true).filter((i) => i.mode === 'shadow');
		expect(shadow.map((i) => [i.kind, i.images])).toEqual([['presence', ['Search-2.png']]]);
		expect(shadow[0]?.note).not.toContain('글자 있음');
	});

	it('모델에는 조건을 기대 결과로, 화면 설명을 이미지 설명으로 준다', () => {
		const item = pickItems(STEPS, false)[0];
		if (item === undefined) throw new Error('없음');
		const user = messagesFor(judgeCase(item), ['QUJD', 'REVG'])[1]?.content ?? '';
		expect(user).toContain('기대 결과: 선택 시 팝업 노출');
		expect(user).toContain('첨부 이미지 2장: 목표에서 OK를 누르기 전');
	});
});

describe('summarize', () => {
	const base = pickItems(STEPS, true);
	const r = (i: number, ai: ReviewResult['ai'], mutated = false): ReviewResult => {
		const item = base[i];
		if (item === undefined) throw new Error('없음');
		return { ...item, ai, confidence: 0.9, reason: '근거', ms: 1000, error: null, mutated };
	};

	it('코드 Fail인데 AI Pass(틀린 Pass)와 틀린 TC 검출을 따로 센다', () => {
		const failed = { ...r(1, 'pass', true), code: 'fail' };
		const sum = summarize([r(0, 'pass'), failed]);
		expect(sum.review).toMatchObject({ total: 1, pass: 1 });
		expect(sum.shadow).toMatchObject({ total: 1, agree: 0, falsePass: 1 });
		expect(sum.mutated).toEqual({ total: 1, caught: 0, missed: 1, uncertain: 0 });
		expect(renderReview('fake', [r(0, 'pass'), failed])).toContain('코드 Fail인데 AI Pass 1');
	});
});
