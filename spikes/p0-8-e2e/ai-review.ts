/**
 * 실행 결과에 로컬 비전 모델(Ollama, D-026) 의견 붙이기 (D-045).
 * 사용자 결정(2026-11-27): AI 혼자 본 결과는 Pass로 확정하지 않고 "확인 필요"로 두며, 화면과 AI 의견을 붙인다.
 * Pass 허용으로 넘어가기 전에, 코드가 판정한 조건(틀린 TC 포함)에도 AI를 따로 물어(--shadow) AI가 코드 Fail을
 * Pass라고 하는지(틀린 Pass)를 잰다. 이 도구는 result.json·TC 파일을 바꾸지 않는다.
 *
 *   pnpm spike:tc-ai out/tc-<시각> [--model gemma4:e4b] [--shadow] [--mutations <틀린 TC>.mutations.json] [--limit N]
 *   pnpm spike:tc-ai out/tc-<시각> --fake          # Ollama 없이 흐름만 확인 (가짜 모델: 늘 uncertain)
 *
 * 결과: <실행 폴더>/ai-review.json, ai-review.md
 * 테스트 실행 중에는 메모리가 모자라므로(PC 공유 메모리), 실행이 끝난 뒤 따로 돌린다.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { JUDGE_SCHEMA, OllamaClient, PROMPT_VERSION, messagesFor } from '@auto-qa/llm';
import type { JudgeCase, LlmClient } from '@auto-qa/llm';
import { startFakeOllama } from '@auto-qa/llm/testing';

export type AiVerdict = 'pass' | 'fail' | 'uncertain';

export interface RunStepLite {
	key: string;
	title: string | null;
	screen: string;
	status: string;
	screenshot: string | null;
	shots?: Record<string, string>;
	results: {
		clause: string;
		kind: string;
		verdict: string | null;
		explanation: string;
		shots?: string[];
	}[];
}

export interface ReviewItem {
	key: string;
	clause: string;
	kind: string;
	/** review: 코드가 정하지 못한 조건 / shadow: 코드가 판정한 조건 (AI와 비교만) */
	mode: 'review' | 'shadow';
	code: string | null;
	codeExplanation: string;
	/** 실행 폴더 안 화면 파일 (보여 주는 순서) */
	images: string[];
	/** 첨부 이미지 설명 */
	imageNote: string;
	/** 모델에 주는 설명 */
	note: string;
}

export interface ReviewOptions {
	/** 코드가 확인 필요로 둔 조건 중 AI에 물을 종류 */
	reviewKinds: string[];
	/** --shadow: 코드가 판정한 조건 중 화면 한두 장으로 볼 수 있는 종류 (키 이동은 키마다 화면이 없어 뺀다) */
	shadowKinds: string[];
	/** 화면이 그 상태가 아니라서(찾아가지 못함 등) AI에 물어도 소용없는 설명 */
	skipExplanations: string[];
}

export const DEFAULT_REVIEW_OPTIONS: ReviewOptions = {
	reviewKinds: ['behavior', 'absence', 'descriptive', 'presence', 'focus', 'transition', 'toggle', 'layout'],
	shadowKinds: ['presence', 'exact-text', 'count', 'focus', 'transition', 'layout', 'ellipsis', 'absence'],
	skipExplanations: ['진입 실패', '가지 못함', '길 없음', '찾아가지 못', '보이지 않음']
};

/** 결과에서 AI에 물을 조건을 고른다 (순서 고정 — 재현성) */
export function pickItems(
	steps: readonly RunStepLite[],
	shadow: boolean,
	options: ReviewOptions = DEFAULT_REVIEW_OPTIONS
): ReviewItem[] {
	const out: ReviewItem[] = [];
	for (const s of steps) {
		if (s.status === 'not-run' || s.screenshot === null) continue;
		for (const r of s.results) {
			const review = r.verdict === 'needs-review' && options.reviewKinds.includes(r.kind);
			const shadowed =
				shadow && (r.verdict === 'pass' || r.verdict === 'fail') && options.shadowKinds.includes(r.kind);
			if (!review && !shadowed) continue;
			if (review && options.skipExplanations.some((w) => r.explanation.includes(w))) continue;
			const named = (r.shots ?? []).map((n) => s.shots?.[n]).filter((f): f is string => f !== undefined);
			const images = named.length > 0 ? named : [s.screenshot];
			const lines = [`TC 단계: ${s.title ?? s.key} (${s.screen} 화면)`];
			// 코드 판정과 비교할 때는 코드 설명을 주지 않는다 (따라 말하지 않게)
			if (review) lines.push(`코드가 정하지 못한 이유: ${r.explanation}`);
			out.push({
				key: s.key,
				clause: r.clause,
				kind: r.kind,
				mode: review ? 'review' : 'shadow',
				code: r.verdict,
				codeExplanation: r.explanation,
				images,
				imageNote:
					images.length === 2
						? '목표에서 OK를 누르기 전 TV 전체 화면, 누른 뒤 TV 전체 화면 (이 순서)'
						: '이 단계 화면에 들어왔을 때의 TV 전체 화면',
				note: lines.join('\n')
			});
		}
	}
	return out;
}

export function judgeCase(item: ReviewItem): JudgeCase {
	return {
		id: `${item.key}|${item.clause}`,
		task: 'judge',
		expected: item.clause,
		observation: { note: item.note, images: item.imageNote },
		answer: { verdict: 'uncertain' }
	};
}

export interface ReviewResult extends ReviewItem {
	ai: AiVerdict | null;
	confidence: number | null;
	reason: string;
	ms: number;
	error: string | null;
	/** 틀린 TC로 바꾼 조건인가 (--mutations) */
	mutated: boolean;
}

export interface ReviewSummary {
	review: { total: number; pass: number; fail: number; uncertain: number; error: number };
	/** 코드 판정과 비교 */
	shadow: {
		total: number;
		agree: number;
		/** 코드 Fail인데 AI Pass — Pass 허용 전 가장 중요한 수 */
		falsePass: number;
		/** 코드 Pass인데 AI Fail */
		falseFail: number;
		uncertain: number;
		error: number;
	};
	/** 틀린 TC로 바꾼 조건(정답 Fail)에서 AI가 Fail이라고 한 수 */
	mutated: { total: number; caught: number; missed: number; uncertain: number };
	avgMs: number | null;
}

export function summarize(results: readonly ReviewResult[]): ReviewSummary {
	const review = results.filter((r) => r.mode === 'review');
	const shadow = results.filter((r) => r.mode === 'shadow');
	const mutated = results.filter((r) => r.mutated);
	const ok = results.filter((r) => r.error === null);
	return {
		review: {
			total: review.length,
			pass: review.filter((r) => r.ai === 'pass').length,
			fail: review.filter((r) => r.ai === 'fail').length,
			uncertain: review.filter((r) => r.ai === 'uncertain').length,
			error: review.filter((r) => r.error !== null).length
		},
		shadow: {
			total: shadow.length,
			agree: shadow.filter((r) => r.ai === r.code).length,
			falsePass: shadow.filter((r) => r.code === 'fail' && r.ai === 'pass').length,
			falseFail: shadow.filter((r) => r.code === 'pass' && r.ai === 'fail').length,
			uncertain: shadow.filter((r) => r.ai === 'uncertain').length,
			error: shadow.filter((r) => r.error !== null).length
		},
		mutated: {
			total: mutated.length,
			caught: mutated.filter((r) => r.ai === 'fail').length,
			missed: mutated.filter((r) => r.ai === 'pass').length,
			uncertain: mutated.filter((r) => r.ai === 'uncertain' || r.ai === null).length
		},
		avgMs: ok.length === 0 ? null : Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length)
	};
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const LABEL: Record<string, string> = { pass: 'Pass', fail: 'Fail', uncertain: '모름', 'needs-review': '확인 필요' };

export function renderReview(model: string, results: readonly ReviewResult[]): string {
	const sum = summarize(results);
	const lines = [
		`# AI 검토 (${model}, ${PROMPT_VERSION})`,
		'',
		'AI 혼자 본 결과는 Pass로 확정하지 않습니다(확인 필요 그대로, 2026-11-27 결정). 아래 의견과 화면은 사람이 빨리 확인하기 위한 것입니다.',
		'',
		`- 코드가 정하지 못한 조건 ${sum.review.total}개: AI Pass ${sum.review.pass} · Fail ${sum.review.fail} · 모름 ${sum.review.uncertain} · 오류 ${sum.review.error}`
	];
	if (sum.shadow.total > 0) {
		lines.push(
			`- 코드가 판정한 조건 ${sum.shadow.total}개와 비교: 같음 ${sum.shadow.agree} · **코드 Fail인데 AI Pass ${sum.shadow.falsePass}** · 코드 Pass인데 AI Fail ${sum.shadow.falseFail} · 모름 ${sum.shadow.uncertain} · 오류 ${sum.shadow.error}`
		);
	}
	if (sum.mutated.total > 0) {
		lines.push(
			`- 틀린 TC로 바꾼 조건 ${sum.mutated.total}개: AI가 Fail로 잡음 ${sum.mutated.caught} · **Pass라고 함 ${sum.mutated.missed}** · 모름 ${sum.mutated.uncertain}`
		);
	}
	if (sum.avgMs !== null) lines.push(`- 한 번 묻는 데 평균 ${(sum.avgMs / 1000).toFixed(1)}초`);
	lines.push('', '| 단계 | 구분 | 조건 | 코드 | AI | 신뢰도 | AI 근거 | 화면 |', '|---|---|---|---|---|---|---|---|');
	for (const r of results) {
		const ai = r.error !== null ? `오류` : (LABEL[r.ai ?? ''] ?? '-');
		const tag = r.mode === 'review' ? '검토' : r.mutated ? '비교(틀린 TC)' : '비교';
		lines.push(
			`| ${r.key} | ${tag} | ${cell(r.clause)} | ${LABEL[r.code ?? ''] ?? '확인 불가'} | ${ai} | ${r.confidence === null ? '-' : r.confidence.toFixed(2)} | ${cell(r.error ?? r.reason)} | ${r.images.map((f) => `[${f}](${f})`).join(' ')} |`
		);
	}
	return `${lines.join('\n')}\n`;
}

async function review(
	client: LlmClient,
	model: string,
	dir: string,
	item: ReviewItem,
	mutated: boolean
): Promise<ReviewResult> {
	const started = Date.now();
	try {
		const images = await Promise.all(
			item.images.map(async (f) => (await readFile(join(dir, f))).toString('base64'))
		);
		const c = judgeCase(item);
		const result = await client.chat({
			model,
			messages: messagesFor(c, images),
			schema: JUDGE_SCHEMA,
			options: { temperature: 0, seed: 42, numCtx: 8192, numPredict: 512 },
			think: false,
			keepAlive: '10m'
		});
		const json = (result.json ?? {}) as { verdict?: AiVerdict; confidence?: number; reason?: string };
		if (result.errors.length > 0 || json.verdict === undefined) {
			return {
				...item,
				ai: null,
				confidence: null,
				reason: '',
				ms: Date.now() - started,
				error: result.errors.join('; ') || '응답 형식 오류',
				mutated
			};
		}
		return {
			...item,
			ai: json.verdict,
			confidence: typeof json.confidence === 'number' ? json.confidence : null,
			reason: json.reason ?? '',
			ms: Date.now() - started,
			error: null,
			mutated
		};
	} catch (e) {
		return {
			...item,
			ai: null,
			confidence: null,
			reason: '',
			ms: Date.now() - started,
			error: e instanceof Error ? e.message : String(e),
			mutated
		};
	}
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			model: { type: 'string', default: 'gemma4:e4b' },
			host: { type: 'string', default: process.env['OLLAMA_HOST'] ?? '127.0.0.1:11434' },
			shadow: { type: 'boolean', default: false },
			mutations: { type: 'string' },
			limit: { type: 'string' },
			fake: { type: 'boolean', default: false }
		}
	});
	const cwd = process.env['INIT_CWD'] ?? process.cwd();
	const input = positionals[0];
	if (input === undefined)
		throw new Error(
			'사용법: tc-ai <실행 폴더 out/tc-…> [--model gemma4:e4b] [--shadow] [--mutations <…>.mutations.json]'
		);
	const dir = resolve(cwd, input);
	const saved = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')) as { steps?: RunStepLite[] };
	const mutations =
		values.mutations === undefined
			? []
			: ((
					JSON.parse(await readFile(resolve(cwd, values.mutations), 'utf8')) as {
						mutations?: { key: string; after: string }[];
					}
				).mutations ?? []);
	const isMutated = (i: ReviewItem): boolean => mutations.some((m) => m.key === i.key && m.after === i.clause);
	let items = pickItems(saved.steps ?? [], values.shadow || mutations.length > 0);
	if (values.limit !== undefined) items = items.slice(0, Number(values.limit));

	const fake = values.fake
		? await startFakeOllama([
				{
					name: values.model,
					capabilities: ['completion', 'vision'],
					reply: () => JSON.stringify({ verdict: 'uncertain', confidence: 0, reason: '가짜 모델' })
				}
			])
		: null;
	const host = fake?.url ?? (/^https?:\/\//.test(values.host) ? values.host : `http://${values.host}`);
	const client = new OllamaClient({ host });
	console.log(
		`AI 검토: ${items.length}개 조건 (${values.model}${fake === null ? '' : ', 가짜'}) — 한 번에 수십 초 걸릴 수 있음`
	);
	const results: ReviewResult[] = [];
	try {
		for (const [i, item] of items.entries()) {
			const r = await review(client, values.model, dir, item, isMutated(item));
			results.push(r);
			console.log(
				`  [${i + 1}/${items.length}] ${r.key} ${r.mode} ${r.kind}: 코드 ${r.code ?? '-'} / AI ${r.error === null ? r.ai : `오류 ${r.error}`} (${(r.ms / 1000).toFixed(1)}초)`
			);
		}
	} finally {
		await fake?.close();
	}
	await writeFile(
		join(dir, 'ai-review.json'),
		`${JSON.stringify({ model: values.model, prompt: PROMPT_VERSION, results }, null, '\t')}\n`
	);
	await writeFile(join(dir, 'ai-review.md'), renderReview(values.model, results));
	const sum = summarize(results);
	console.log(
		`검토 ${sum.review.total} (Pass ${sum.review.pass} · Fail ${sum.review.fail} · 모름 ${sum.review.uncertain}) · 비교 ${sum.shadow.total} (같음 ${sum.shadow.agree} · 코드 Fail인데 AI Pass ${sum.shadow.falsePass}) · 틀린 TC ${sum.mutated.caught}/${sum.mutated.total}`
	);
	console.log(`→ ${join(dir, 'ai-review.md')}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	main().catch((e: unknown) => {
		console.error(e instanceof Error ? e.message : e);
		process.exit(1);
	});
}
