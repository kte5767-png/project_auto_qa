import type { ChatMetrics, LlmClient } from '../types';
import type { LlmCase, Task } from './cases';
import { messagesFor, PROMPT_VERSION, schemaFor } from './prompts';
import type { Decision } from './score';
import { decisionKey, decisionOf, scoreCase } from './score';

/**
 * 같은 케이스를 여러 로컬 모델에 돌려 비교한다 (P0-8 모델 선정, D-026).
 * 메모리가 작은 PC(내장 GPU, 16GB 공유)를 고려해 모델을 하나씩 올리고, 끝나면 내린다.
 */

export interface CompareOptions {
	/** 같은 케이스를 몇 번 반복할지 (반복 일치 = 재현성 확인) */
	runs: number;
	/** 생각(추론) 모드: off = 끔(빠름, 기본), on = 켬, default = 모델 기본값. 생각을 지원하는 모델에만 보낸다 */
	think: 'off' | 'on' | 'default';
	temperature: number;
	seed: number;
	numCtx: number;
	numPredict: number;
	/** 모델마다 끝나면 메모리에서 내린다 */
	unloadAfter: boolean;
}

export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
	runs: 2,
	think: 'off',
	temperature: 0,
	seed: 42,
	numCtx: 4096,
	numPredict: 512,
	unloadAfter: true
};

export interface LoadedCase {
	case: LlmCase;
	/** base64 이미지 */
	images: string[];
}

export interface CallRecord {
	model: string;
	caseId: string;
	task: Task;
	run: number;
	withImages: boolean;
	/** JSON이 스키마에 맞음 */
	valid: boolean;
	errors: string[];
	decision: Decision | null;
	correct: boolean;
	partial: number;
	confidentWrong: boolean;
	falsePass: boolean;
	content: string;
	metrics: ChatMetrics | null;
	/** 연결·시간 초과 등 호출 자체 실패 */
	failure: string | null;
}

export interface ModelRun {
	model: string;
	status: 'ok' | 'missing' | 'error';
	reason: string | null;
	capabilities: string[];
	license: string | null;
	loadMs: number | null;
	memory: { sizeBytes: number; vramBytes: number } | null;
	calls: CallRecord[];
	skipped: { caseId: string; reason: string }[];
}

export interface CompareResult {
	ollamaVersion: string;
	promptVersion: string;
	options: CompareOptions;
	cases: { id: string; task: Task; withImages: boolean }[];
	runs: ModelRun[];
}

export type Progress = (event: {
	model: string;
	done: number;
	total: number;
	record?: CallRecord;
	note?: string;
}) => void;

const sameModel = (a: string, b: string): boolean => a === b || a === `${b}:latest` || b === `${a}:latest`;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function seconds(ms: number | null): string {
	return ms === null ? '?초' : `${(ms / 1000).toFixed(1)}초`;
}

function gib(bytes: number): string {
	return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

export async function compareModels(
	client: LlmClient,
	models: readonly string[],
	cases: readonly LoadedCase[],
	options: CompareOptions = DEFAULT_COMPARE_OPTIONS,
	onProgress: Progress = () => undefined
): Promise<CompareResult> {
	const ollamaVersion = await client.version();
	const installed = (await client.models()).map((m) => m.name);
	const runs: ModelRun[] = [];

	for (const model of models) {
		const run: ModelRun = {
			model,
			status: 'ok',
			reason: null,
			capabilities: [],
			license: null,
			loadMs: null,
			memory: null,
			calls: [],
			skipped: []
		};
		runs.push(run);
		if (!installed.some((name) => sameModel(name, model))) {
			run.status = 'missing';
			run.reason = `설치되지 않음 — ollama pull ${model}`;
			onProgress({ model, done: 0, total: 0, note: run.reason });
			continue;
		}
		try {
			const details = await client.show(model);
			run.capabilities = details.capabilities;
			run.license = details.license;
			const thinking = run.capabilities.includes('thinking');
			const think = !thinking || options.think === 'default' ? undefined : options.think === 'on';
			const vision = run.capabilities.includes('vision');

			// 로드 시간: 내렸다가 짧은 요청으로 올린다
			onProgress({ model, done: 0, total: 0, note: '모델 불러오는 중 — CPU에서는 수십 초 걸릴 수 있음' });
			await client.unload(model).catch(() => undefined);
			const warm = await client.chat({
				model,
				messages: [{ role: 'user', content: 'OK라고만 답해.' }],
				options: { temperature: 0, numPredict: 4, numCtx: options.numCtx },
				...(think === undefined ? {} : { think })
			});
			run.loadMs = warm.metrics.loadMs;
			const loaded = (await client.running()).find((m) => sameModel(m.name, model));
			run.memory = loaded === undefined ? null : { sizeBytes: loaded.sizeBytes, vramBytes: loaded.vramBytes };

			const usable = cases.filter((lc) => {
				if (lc.images.length > 0 && !vision) {
					run.skipped.push({ caseId: lc.case.id, reason: '이미지 입력을 지원하지 않는 모델' });
					return false;
				}
				return true;
			});
			const total = usable.length * options.runs;
			onProgress({
				model,
				done: 0,
				total,
				note: `불러옴 ${seconds(run.loadMs)}${run.memory === null ? '' : `, 메모리 ${gib(run.memory.sizeBytes)} (GPU ${gib(run.memory.vramBytes)})`} — 첫 결과까지 1분 넘게 걸릴 수 있음`
			});
			let done = 0;
			for (const lc of usable) {
				for (let r = 1; r <= options.runs; r++) {
					const c = lc.case;
					const base = { model, caseId: c.id, task: c.task, run: r, withImages: lc.images.length > 0 };
					let record: CallRecord;
					try {
						const result = await client.chat({
							model,
							messages: messagesFor(c, lc.images),
							schema: schemaFor(c),
							options: {
								temperature: options.temperature,
								seed: options.seed,
								numCtx: options.numCtx,
								numPredict: options.numPredict
							},
							...(think === undefined ? {} : { think })
						});
						const valid = result.errors.length === 0;
						const decision = valid ? decisionOf(c.task, result.json) : null;
						const score = scoreCase(c, decision);
						record = {
							...base,
							valid,
							errors: result.errors,
							decision,
							...score,
							content: result.content,
							metrics: result.metrics,
							failure: null
						};
					} catch (e) {
						record = {
							...base,
							valid: false,
							errors: [],
							decision: null,
							correct: false,
							partial: 0,
							confidentWrong: false,
							falsePass: false,
							content: '',
							metrics: null,
							failure: message(e)
						};
					}
					run.calls.push(record);
					done++;
					onProgress({ model, done, total, record });
				}
			}
		} catch (e) {
			run.status = 'error';
			run.reason = message(e);
			onProgress({ model, done: 0, total: 0, note: run.reason });
		} finally {
			if (options.unloadAfter && run.status !== 'missing') await client.unload(model).catch(() => undefined);
		}
	}
	return {
		ollamaVersion,
		promptVersion: PROMPT_VERSION,
		options,
		cases: cases.map((lc) => ({ id: lc.case.id, task: lc.case.task, withImages: lc.images.length > 0 })),
		runs
	};
}

export interface ModelSummary {
	model: string;
	status: ModelRun['status'];
	reason: string | null;
	calls: number;
	validRate: number | null;
	failures: number;
	judge: {
		calls: number;
		accuracy: number | null;
		imageCalls: number;
		imageAccuracy: number | null;
		confidentWrong: number;
		/** 결함을 pass라고 한 수 (D-036 ④) */
		falsePass: number;
		uncertain: number;
		/**
		 * pass 답의 신뢰도: 맞은 pass 최소값 / 틀린 pass 최대값.
		 * 틀린 pass 최대값이 맞은 pass 최소값보다 작아야 신뢰도 기준으로 자동 확정을 고려할 수 있다
		 */
		passConfidence: { correctMin: number | null; wrongMax: number | null; separable: boolean | null };
	};
	/** 목표 고르기 (D-036 ①) */
	target: { calls: number; exactRate: number | null; calloutRate: number | null; meanPartial: number | null };
	plan: { calls: number; exactRate: number | null; meanSimilarity: number | null };
	/** 반복한 케이스 중 모든 반복의 판단이 같은 비율 */
	consistency: number | null;
	medianMs: number | null;
	p95Ms: number | null;
	tokensPerSecond: number | null;
	loadMs: number | null;
	memory: ModelRun['memory'];
	skipped: number;
}

const rate = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 1000) / 1000);

function quantile(values: readonly number[], q: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
	return sorted[i] ?? null;
}

export function summarize(run: ModelRun): ModelSummary {
	const calls = run.calls;
	const judge = calls.filter((c) => c.task === 'judge');
	const image = judge.filter((c) => c.withImages);
	const plan = calls.filter((c) => c.task === 'plan');
	const target = calls.filter((c) => c.task === 'target');
	const passConf = (correct: boolean): number[] =>
		judge
			.filter((c) => c.decision?.verdict === 'pass' && c.correct === correct)
			.map((c) => c.decision?.confidence)
			.filter((v): v is number => typeof v === 'number');
	const correctPass = passConf(true);
	const wrongPass = passConf(false);
	const correctMin = correctPass.length === 0 ? null : Math.min(...correctPass);
	const wrongMax = wrongPass.length === 0 ? null : Math.max(...wrongPass);
	const byCase = new Map<string, CallRecord[]>();
	for (const c of calls) byCase.set(c.caseId, [...(byCase.get(c.caseId) ?? []), c]);
	// 반복 일치: 2회 이상 돌린 케이스 중 모든 반복이 유효하고 판단이 같은 비율 (모두 무효인 케이스는 뺀다)
	const repeated = [...byCase.values()].filter((list) => list.length >= 2 && list.some((c) => c.valid));
	const consistent = repeated.filter(
		(list) => list.every((c) => c.valid) && new Set(list.map((c) => decisionKey(c.decision))).size === 1
	);
	const ok = calls.filter((c) => c.metrics !== null);
	const tps = ok.map((c) => c.metrics?.tokensPerSecond).filter((v): v is number => typeof v === 'number');
	return {
		model: run.model,
		status: run.status,
		reason: run.reason,
		calls: calls.length,
		validRate: rate(calls.filter((c) => c.valid).length, calls.length),
		failures: calls.filter((c) => c.failure !== null).length,
		judge: {
			calls: judge.length,
			accuracy: rate(judge.filter((c) => c.correct).length, judge.length),
			imageCalls: image.length,
			imageAccuracy: rate(image.filter((c) => c.correct).length, image.length),
			confidentWrong: judge.filter((c) => c.confidentWrong).length,
			falsePass: judge.filter((c) => c.falsePass).length,
			uncertain: judge.filter((c) => c.decision?.verdict === 'uncertain').length,
			passConfidence: {
				correctMin,
				wrongMax,
				separable: correctMin === null || wrongMax === null ? null : wrongMax < correctMin
			}
		},
		target: {
			calls: target.length,
			exactRate: rate(target.filter((c) => c.correct).length, target.length),
			calloutRate: rate(target.filter((c) => c.partial >= 0.5).length, target.length),
			meanPartial:
				target.length === 0
					? null
					: Math.round((target.reduce((s, c) => s + c.partial, 0) / target.length) * 1000) / 1000
		},
		plan: {
			calls: plan.length,
			exactRate: rate(plan.filter((c) => c.correct).length, plan.length),
			meanSimilarity:
				plan.length === 0
					? null
					: Math.round((plan.reduce((s, c) => s + c.partial, 0) / plan.length) * 1000) / 1000
		},
		consistency: rate(consistent.length, repeated.length),
		medianMs: quantile(
			ok.map((c) => c.metrics?.wallMs ?? 0),
			0.5
		),
		p95Ms: quantile(
			ok.map((c) => c.metrics?.wallMs ?? 0),
			0.95
		),
		tokensPerSecond: quantile(tps, 0.5),
		loadMs: run.loadMs,
		memory: run.memory,
		skipped: run.skipped.length
	};
}

/**
 * 순위 (결정적): 판정 정확도(JSON 오류는 오답) → 틀린 pass 적은 순 → 확신 오답 적은 순 → 목표 정확도
 * → 계획 정확도(이전 방식) → 반복 일치 → 응답 시간.
 * 틀린 pass(결함을 놓침)는 사람이 다시 보지 않는 오류라 정확도가 같으면 이것으로 먼저 가른다 (D-036 ④).
 */
export function rankModels(summaries: readonly ModelSummary[]): ModelSummary[] {
	const v = (x: number | null): number => x ?? -1;
	return [...summaries]
		.filter((s) => s.status === 'ok' && s.calls > 0)
		.sort(
			(a, b) =>
				v(b.judge.accuracy) - v(a.judge.accuracy) ||
				a.judge.falsePass / Math.max(1, a.judge.calls) - b.judge.falsePass / Math.max(1, b.judge.calls) ||
				a.judge.confidentWrong / Math.max(1, a.judge.calls) -
					b.judge.confidentWrong / Math.max(1, b.judge.calls) ||
				v(b.target.exactRate) - v(a.target.exactRate) ||
				v(b.plan.exactRate) - v(a.plan.exactRate) ||
				v(b.consistency) - v(a.consistency) ||
				(a.medianMs ?? Infinity) - (b.medianMs ?? Infinity) ||
				a.model.localeCompare(b.model)
		);
}
