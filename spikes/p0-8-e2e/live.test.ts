import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trail } from './common';
import { Coalescer, LIVE_FRAME_FILE, LiveReporter, PROGRESS_FILE, isRunId, writeAtomic } from './live';

describe('Coalescer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('처음 알림은 바로, 간격 안의 알림은 모아서 간격이 끝날 때 한 번', async () => {
		const calls: number[] = [];
		const c = new Coalescer(
			async () => {
				calls.push(Date.now());
			},
			200,
			() => Date.now()
		);
		const t0 = Date.now();
		c.notify();
		await vi.advanceTimersByTimeAsync(0);
		expect(calls).toEqual([t0]);
		c.notify();
		c.notify();
		c.notify();
		await vi.advanceTimersByTimeAsync(199);
		expect(calls).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toEqual([t0, t0 + 200]);
		// 알림이 없으면 다시 실행하지 않는다
		await vi.advanceTimersByTimeAsync(1000);
		expect(calls).toHaveLength(2);
	});

	it('실행 중에 온 알림은 끝난 뒤 한 번 더 실행한다', async () => {
		let release: () => void = () => undefined;
		let runs = 0;
		const c = new Coalescer(
			() => {
				runs++;
				return new Promise<void>((r) => {
					release = r;
				});
			},
			0,
			() => Date.now()
		);
		c.notify();
		await vi.advanceTimersByTimeAsync(0);
		expect(runs).toBe(1);
		c.notify();
		await vi.advanceTimersByTimeAsync(50);
		expect(runs).toBe(1);
		release();
		await vi.advanceTimersByTimeAsync(0);
		expect(runs).toBe(2);
		release();
		await vi.advanceTimersByTimeAsync(0);
		expect(runs).toBe(2);
	});

	it('flush는 기다리지 않고 남은 알림을 바로 실행한다', async () => {
		let runs = 0;
		const c = new Coalescer(
			async () => {
				runs++;
			},
			10_000,
			() => Date.now()
		);
		c.notify();
		await vi.advanceTimersByTimeAsync(0);
		c.notify();
		await c.flush();
		expect(runs).toBe(2);
		await c.flush();
		expect(runs).toBe(2);
	});

	it('실행 오류는 삼키고 다음 알림은 그대로 받는다', async () => {
		let runs = 0;
		const c = new Coalescer(
			() => {
				runs++;
				return Promise.reject(new Error('디스크'));
			},
			0,
			() => Date.now()
		);
		c.notify();
		await vi.advanceTimersByTimeAsync(0);
		c.notify();
		await vi.advanceTimersByTimeAsync(0);
		expect(runs).toBe(2);
	});
});

describe('isRunId', () => {
	it('tc-로 시작하는 폴더 이름만', () => {
		expect(isRunId('tc-2026-11-27T01-45-26')).toBe(true);
		expect(isRunId('tc-../x')).toBe(false);
		expect(isRunId('../tc-1')).toBe(false);
		expect(isRunId('run-1')).toBe(false);
	});
});

describe('LiveReporter', () => {
	let dir = '';
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'auto-qa-live-'));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const read = async (): Promise<Record<string, unknown>> =>
		JSON.parse(await readFile(join(dir, PROGRESS_FILE), 'utf8')) as Record<string, unknown>;

	it('단계 안에서 늘어나는 기록과 하는 일을 진행 파일에 쓴다', async () => {
		const steps: { key: string }[] = [];
		const live = new LiveReporter(dir, () => ({ tc: 'TC.xlsx', steps }), { writeMs: 0, frameMs: 0 });
		live.stage('preparing', '브라우저 여는 중');
		await live.flush();
		expect(await read()).toMatchObject({
			tc: 'TC.xlsx',
			stage: 'preparing',
			phase: '브라우저 여는 중',
			finished: false,
			current: null
		});

		const trail: Trail[] = [];
		live.begin('Search!9', trail);
		live.phase('앱 여는 중');
		trail.push({ key: 'DOWN', focus: '검색어[0]', stable: true });
		live.touch();
		await live.flush();
		const mid = await read();
		expect(mid).toMatchObject({ stage: 'running', current: 'Search!9', phase: '앱 여는 중' });
		expect(mid['currentTrail']).toEqual([{ key: 'DOWN', focus: '검색어[0]', stable: true }]);
		expect(typeof mid['currentStartedAt']).toBe('string');

		steps.push({ key: 'Search!9' });
		live.end();
		await live.flush();
		expect(await read()).toMatchObject({
			current: null,
			phase: null,
			currentTrail: [],
			steps: [{ key: 'Search!9' }]
		});

		await live.finish(true);
		expect(await read()).toMatchObject({ stage: 'done', finished: true, stopped: false });
		// 임시 파일은 남지 않는다
		expect((await readdir(dir)).sort()).toEqual([PROGRESS_FILE]);
	});

	it('모든 단계를 마치지 못하고 끝나면 stopped (오류·중지)', async () => {
		const live = new LiveReporter(dir, () => ({}), { writeMs: 0, frameMs: 0 });
		live.begin('Search!9', []);
		live.phase('앱 여는 중');
		await live.finish(false);
		expect(await read()).toMatchObject({
			stage: 'done',
			finished: true,
			stopped: true,
			current: null,
			phase: null
		});
	});

	it('실시간 화면은 가장 최근 프레임만 쓰고, 끄면 쓰지 않는다', async () => {
		const on = new LiveReporter(dir, () => ({}), { writeMs: 0, frameMs: 1000 });
		on.onFrame(new Uint8Array([1]));
		on.onFrame(new Uint8Array([2]));
		on.onFrame(new Uint8Array([3]));
		await on.flush();
		expect([...(await readFile(join(dir, LIVE_FRAME_FILE)))]).toEqual([3]);

		const offDir = await mkdtemp(join(tmpdir(), 'auto-qa-live-off-'));
		const off = new LiveReporter(offDir, () => ({}), { writeMs: 0, frameMs: 0 });
		expect(off.framesOn).toBe(false);
		off.onFrame(new Uint8Array([1]));
		await off.flush();
		expect(await readdir(offDir)).toEqual([]);
		await rm(offDir, { recursive: true, force: true });
	});
});

describe('writeAtomic', () => {
	it('덮어쓰고 임시 파일을 남기지 않는다', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'auto-qa-atomic-'));
		const path = join(dir, 'a.json');
		await writeAtomic(path, '1');
		await writeAtomic(path, '2');
		expect(await readFile(path, 'utf8')).toBe('2');
		expect(await readdir(dir)).toEqual(['a.json']);
		await rm(dir, { recursive: true, force: true });
	});
});
