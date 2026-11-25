/**
 * 포커스 판별 측정 흐름 (P0-2 시뮬레이터, P0-6 실기기 공용).
 * 1) 방향키 몇 번으로 포커스 방식 자동 탐지 → 2) 시작 상태에서 키 N번 입력하며 어댑터별 판단 기록
 * → 3) 정답(샘플 앱)이 있으면 채점, 없으면 1순위 어댑터와의 일치율 + 스크린샷으로 사람이 확인.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Driver, RemoteKey, StableResult } from '@auto-qa/core';
import {
	StyleDiffTracker,
	collectFocusState,
	detectFocusAdapters,
	isAncestor,
	readActiveElement,
	readEnactSpotlight,
	readSelector
} from '@auto-qa/focus';
import type { FocusAdapterId, FocusCandidate, FocusReading, FocusState } from '@auto-qa/focus';
import { matchesTruth } from '@auto-qa/sample-tv-app/truth';
import type { SampleTruth } from '@auto-qa/sample-tv-app/truth';

export const ADAPTERS: FocusAdapterId[] = ['enact-spotlight', 'active-element', 'selector', 'style-diff'];
export const DEFAULT_DETECT_KEYS: RemoteKey[] = ['DOWN', 'RIGHT', 'RIGHT', 'LEFT', 'UP'];
/** 완료 기준(방향키 20회)용 기본 키 순서 */
export const DEFAULT_MEASURE_KEYS = 'RIGHT*4 DOWN*3 LEFT*2 DOWN*2 RIGHT*3 UP*3 LEFT*3';

/** 키 입력 결과 (실기기: 앱 도착 여부·지연) */
export interface PressInfo {
	delivered: boolean | null;
	latencyMs: number;
}

export interface StepRecord {
	index: number;
	key: RemoteKey | 'START';
	stable: boolean;
	waitedMs: number;
	stableMode: StableResult['mode'];
	press: PressInfo | null;
	readings: FocusReading[];
	truth: SampleTruth | null;
	screenshot: string;
}

export interface FocusRunResult {
	name: string;
	description: string;
	meta: Record<string, string>;
	candidates: FocusCandidate[];
	selector: string | null;
	expected: { adapter: FocusAdapterId; selector?: string } | null;
	steps: StepRecord[];
	accuracy: Partial<Record<FocusAdapterId, { hits: number; total: number }>>;
	agreement: Partial<Record<FocusAdapterId, number>>;
}

export interface FocusRunOptions {
	name: string;
	description: string;
	meta?: Record<string, string>;
	keys: RemoteKey[];
	detectKeys?: RemoteKey[];
	outDir: string;
	/** 시작 상태로 되돌린다 (페이지 다시 열기 / 앱 재실행) */
	reset: () => Promise<void>;
	/** 키 입력. 기본은 driver.pressKey (결과 정보 없음) */
	press?: (key: RemoteKey) => Promise<PressInfo | null>;
	/** 샘플 앱 정답 읽기 (실제 앱은 없음) */
	readTruth?: (() => Promise<SampleTruth>) | null;
	expected?: { adapter: FocusAdapterId; selector?: string } | null;
	onStep?: (step: StepRecord) => void;
}

function related(a: string | null, b: string | null): boolean {
	if (a === null || b === null) return a === b;
	return a === b || isAncestor(a, b) || isAncestor(b, a);
}

export async function runFocusMeasurement(driver: Driver, options: FocusRunOptions): Promise<FocusRunResult> {
	const press =
		options.press ??
		(async (key: RemoteKey) => {
			await driver.pressKey(key);
			return null;
		});

	// 1) 포커스 방식 자동 탐지
	await options.reset();
	await driver.waitForStable();
	const detectStates: FocusState[] = [await collectFocusState(driver)];
	for (const key of options.detectKeys ?? DEFAULT_DETECT_KEYS) {
		await press(key);
		await driver.waitForStable();
		detectStates.push(await collectFocusState(driver));
	}
	const candidates = detectFocusAdapters(detectStates);
	const selector = candidates.find((c) => c.adapter === 'selector')?.selector ?? null;

	// 2) 시작 상태에서 키 입력하며 어댑터별 판단 기록
	await options.reset();
	const shotDir = join(options.outDir, options.name);
	await mkdir(shotDir, { recursive: true });
	const tracker = new StyleDiffTracker();
	const steps: StepRecord[] = [];
	const record = async (index: number, key: RemoteKey | 'START', info: PressInfo | null): Promise<void> => {
		const settled = await driver.waitForStable();
		const state = await collectFocusState(driver, { selector });
		const readings = [
			readEnactSpotlight(state),
			readActiveElement(state),
			...(selector === null ? [] : [readSelector(state)]),
			tracker.update(state)
		];
		const truth = options.readTruth === undefined || options.readTruth === null ? null : await options.readTruth();
		const file = `step-${String(index).padStart(2, '0')}.jpg`;
		await writeFile(join(shotDir, file), await driver.screenshot({ type: 'jpeg', quality: 60 }));
		const step: StepRecord = {
			index,
			key,
			stable: settled.stable,
			waitedMs: settled.waitedMs,
			stableMode: settled.mode,
			press: info,
			readings,
			truth,
			screenshot: `${options.name}/${file}`
		};
		steps.push(step);
		options.onStep?.(step);
	};
	await record(0, 'START', null);
	for (const [i, key] of options.keys.entries()) {
		const info = await press(key);
		await record(i + 1, key, info);
	}

	// 3) 채점 (키 입력 이후 단계만. style-diff는 시작 상태를 판단할 수 없으므로)
	const scored = steps.slice(1);
	const accuracy: FocusRunResult['accuracy'] = {};
	const agreement: FocusRunResult['agreement'] = {};
	const top = candidates[0]?.adapter;
	for (const adapter of ADAPTERS) {
		const readingsOf = scored.map((s) => s.readings.find((r) => r.adapter === adapter));
		if (readingsOf.some((r) => r === undefined)) continue;
		if (scored.every((s) => s.truth !== null)) {
			const hits = scored.filter(
				(s, i) => s.truth !== null && matchesTruth(readingsOf[i]?.path ?? null, s.truth)
			).length;
			accuracy[adapter] = { hits, total: scored.length };
		}
		if (top !== undefined && adapter !== top) {
			const agree = scored.filter((s) =>
				related(
					s.readings.find((r) => r.adapter === adapter)?.path ?? null,
					s.readings.find((r) => r.adapter === top)?.path ?? null
				)
			).length;
			agreement[adapter] = scored.length === 0 ? 0 : agree / scored.length;
		}
	}
	return {
		name: options.name,
		description: options.description,
		meta: options.meta ?? {},
		candidates,
		selector,
		expected: options.expected ?? null,
		steps,
		accuracy,
		agreement
	};
}

/** 콘솔 요약 줄 */
export function summarize(result: FocusRunResult): string[] {
	const lines: string[] = [];
	const top = result.candidates[0];
	lines.push(
		`탐지 1순위: ${top === undefined ? '없음' : `${top.adapter}${top.selector === undefined ? '' : ` ${top.selector}`} (${Math.round(top.confidence * 100)}%)`}`
	);
	if (result.expected !== null) {
		const ok =
			top?.adapter === result.expected.adapter &&
			(result.expected.selector === undefined || top.selector === result.expected.selector);
		lines.push(
			`탐지 정답(${result.expected.adapter}${result.expected.selector === undefined ? '' : ` ${result.expected.selector}`}): ${ok ? '맞음' : '틀림'}`
		);
	}
	for (const [adapter, acc] of Object.entries(result.accuracy)) {
		lines.push(
			`${adapter.padEnd(16)} 정확도 ${acc.hits}/${acc.total} (${Math.round((acc.hits / acc.total) * 100)}%)`
		);
	}
	for (const [adapter, agr] of Object.entries(result.agreement)) {
		lines.push(`${adapter.padEnd(16)} 1순위와 일치 ${Math.round(agr * 100)}%`);
	}
	const unstable = result.steps.filter((s) => !s.stable).length;
	if (unstable > 0) lines.push(`안정화 시간 초과 ${unstable}회`);
	const presses = result.steps.map((s) => s.press).filter((p): p is PressInfo => p !== null);
	if (presses.length > 0) {
		const missed = presses.filter((p) => p.delivered === false).length;
		const latencies = presses
			.filter((p) => p.delivered === true)
			.map((p) => p.latencyMs)
			.sort((a, b) => a - b);
		const median = latencies[Math.floor(latencies.length / 2)];
		lines.push(
			`키 도착 ${presses.length - missed}/${presses.length}${median === undefined ? '' : `, 지연 중앙값 ${median}ms`}`
		);
	}
	return lines;
}
