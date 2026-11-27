import { describe, expect, it } from 'vitest';
import type { LiveState, Run, Step } from './api';
import {
	INITIAL_STREAM,
	LOG_MAX,
	isActive,
	logTone,
	reduceStream,
	sheetNames,
	shownTrail,
	trailChips,
	viewStage
} from './live';
import type { StreamEvent, StreamState } from './live';

const run = (over: Partial<Run> = {}): Run => ({
	id: 'tc-2026-11-27T02-00-00',
	tc: 'TC.xlsx',
	url: 'http://localhost:8091',
	startedAt: '2026-11-27T02:00:00.000Z',
	updatedAt: '2026-11-27T02:00:05.000Z',
	finished: false,
	current: null,
	planned: [],
	steps: [],
	...over
});

const live = (over: Partial<LiveState> = {}): LiveState => ({
	running: true,
	exitCode: null,
	startedAt: '2026-11-27T02:00:00.000Z',
	runId: 'tc-2026-11-27T02-00-00',
	stopped: false,
	...over
});

const step = (key: string, over: Partial<Step> = {}): Step => ({
	key,
	sheet: 'Search',
	row: Number(key.split('!')[1]),
	tcId: null,
	title: null,
	screen: '4.1',
	callout: '1',
	status: 'pass',
	explanation: '',
	basis: '',
	results: [],
	trail: [],
	screenshot: null,
	ms: 1000,
	...over
});

const apply = (events: StreamEvent[], from: StreamState = INITIAL_STREAM): StreamState =>
	events.reduce((s, e) => reduceStream(s, e, 1), from);

describe('reduceStream', () => {
	it('다른 실행으로 바뀌면 이전 실행의 진행·화면을 버린다', () => {
		const before = apply([
			{ type: 'run', data: { id: 'tc-old' } },
			{ type: 'progress', data: run({ id: 'tc-old', finished: true }) },
			{ type: 'frame', data: { id: 'tc-old', v: '1' } }
		]);
		expect(before.run?.id).toBe('tc-old');
		const after = apply([{ type: 'run', data: { id: 'tc-new' } }], before);
		expect(after).toMatchObject({ runId: 'tc-new', run: null, frame: null });
	});

	it('지금 보는 실행이 아닌 진행·화면은 받지 않는다', () => {
		const s = apply([
			{ type: 'run', data: { id: 'tc-new' } },
			{ type: 'progress', data: run({ id: 'tc-old' }) },
			{ type: 'frame', data: { id: 'tc-old', v: '9' } }
		]);
		expect(s.run).toBeNull();
		expect(s.frame).toBeNull();
	});

	it('로그는 이어 붙이고, reset이면 새로 시작하고, 최근 LOG_MAX줄만 둔다', () => {
		const s = apply([
			{ type: 'log', data: { lines: ['a', 'b'], seq: 2 } },
			{ type: 'log', data: { lines: ['c'], seq: 3 } }
		]);
		expect(s.log).toEqual(['a', 'b', 'c']);
		expect(apply([{ type: 'log', data: { reset: true, lines: [], seq: 0 } }], s).log).toEqual([]);
		const many = Array.from({ length: LOG_MAX + 5 }, (_, i) => String(i));
		const capped = apply([{ type: 'log', data: { lines: many, seq: many.length } }]);
		expect(capped.log).toHaveLength(LOG_MAX);
		expect(capped.log[0]).toBe('5');
	});

	it('연결 상태', () => {
		expect(apply([{ type: 'open' }]).connected).toBe(true);
		expect(apply([{ type: 'open' }, { type: 'error' }]).connected).toBe(false);
	});
});

describe('viewStage', () => {
	const id = 'tc-2026-11-27T02-00-00';

	it('이 화면에서 시작했고 진행 파일이 아직 없으면 준비 중 (이전 실행을 보여 주지 않음)', () => {
		expect(viewStage(null, live(), id)).toBe('preparing');
		expect(viewStage(null, null, id)).toBeNull();
	});

	it('진행 파일의 단계를 따른다', () => {
		expect(viewStage(run({ stage: 'preparing' }), live(), id)).toBe('preparing');
		expect(viewStage(run({ stage: 'running' }), live(), id)).toBe('running');
		expect(viewStage(run({ stage: 'writing' }), live(), id)).toBe('writing');
		expect(viewStage(run({ stage: 'done', finished: true }), live({ running: false, exitCode: 0 }), id)).toBe(
			'done'
		);
	});

	it('이전 형식(stage 없음)은 finished로', () => {
		expect(viewStage(run({ finished: true }), null, id)).toBe('done');
		expect(viewStage(run({ finished: false }), null, id)).toBe('running');
	});

	it('중지 버튼으로 멈춤 / 오류로 중간에 끝남', () => {
		const stopped = live({ running: false, exitCode: 1, stopped: true });
		expect(viewStage(run({ stopped: true, stage: 'done', finished: true }), stopped, id)).toBe('stopped');
		expect(viewStage(run({ stopped: true, stage: 'done', finished: true }), null, id)).toBe('ended-early');
		// 프로세스는 끝났는데 진행 파일이 아직 진행 중 (서버가 고치기 전)
		expect(viewStage(run({ stage: 'running' }), live({ running: false, exitCode: 1 }), id)).toBe('ended-early');
	});

	it('실행 중 표시', () => {
		expect(isActive('preparing')).toBe(true);
		expect(isActive('writing')).toBe(true);
		expect(isActive('done')).toBe(false);
		expect(isActive(null)).toBe(false);
	});
});

describe('trailChips / shownTrail', () => {
	it('키는 키 모양, 키가 아닌 기록은 짧은 동작 이름', () => {
		const chips = trailChips(
			[
				{ key: null, focus: '앱 열기 → 처음 화면 기억 (요소 12개)', stable: true },
				{ key: 'DOWN', focus: '검색어[0]', stable: true },
				{ key: null, focus: '검색어 입력', stable: true, action: '글자 "제주"' }
			],
			10
		);
		expect(chips).toEqual([
			{ label: '앱 열기', kind: 'action', detail: '앱 열기 → 처음 화면 기억 (요소 12개)' },
			{ label: '▼', kind: 'key', detail: '검색어[0]' },
			{ label: '글자 "제주"', kind: 'action', detail: '검색어 입력' }
		]);
		expect(
			trailChips(
				[
					{ key: 'UP', focus: '', stable: true },
					{ key: 'OK', focus: '', stable: true }
				],
				1
			)
		).toEqual([{ label: 'OK', kind: 'key', detail: '' }]);
	});

	it('지금 단계의 기록, 단계 사이에는 직전 단계의 기록', () => {
		const t = [{ key: 'LEFT' as const, focus: 'GNB', stable: true }];
		expect(shownTrail(run({ current: 'Search!10', currentTrail: t }))).toEqual({
			key: 'Search!10',
			trail: t,
			live: true
		});
		expect(shownTrail(run({ current: null, steps: [step('Search!9', { trail: t })] }))).toEqual({
			key: 'Search!9',
			trail: t,
			live: false
		});
	});
});

describe('logTone', () => {
	it('단계 시작 줄과 판정 결과 줄을 구분한다', () => {
		expect(logTone('  Search!9 4.1 ① 검색어')).toBe('step');
		expect(logTone('    = Pass — 일치 (3.2초)')).toBe('pass');
		expect(logTone('    = Fail — 다름')).toBe('fail');
		expect(logTone('    = 확인 필요 — AI 판정 대상')).toBe('review');
		expect(logTone('    = 미실행 — 진입 실패')).toBe('muted');
		expect(logTone('      [Fail] 포커스가 다름')).toBe('review');
		expect(logTone('    진입 ▼ → 검색어[0]')).toBeNull();
	});
});

describe('sheetNames', () => {
	it('단계 키의 시트 이름 (앱·시트에 맞춘 글자를 쓰지 않음)', () => {
		expect(sheetNames(['Search!9', 'Search!10'])).toBe('Search 시트');
		expect(sheetNames(['Home!3', 'Search!9'])).toBe('Home, Search 시트');
		expect(sheetNames([])).toBe('');
	});
});
