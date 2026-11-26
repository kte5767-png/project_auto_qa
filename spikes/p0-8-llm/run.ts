/**
 * P0-8 로컬 LLM 비교: 같은 케이스(TC 판정·리모컨 계획)를 Ollama 모델들에 돌려
 * 정확도·확신 오답·반복 일치·속도·메모리를 비교한다 (D-026). 모델은 하나씩 올리고 끝나면 내린다.
 *
 *   pnpm spike:llm                                  # 기본 모델 + 샘플 케이스
 *   pnpm spike:llm --models qwen3-vl:4b-instruct,gemma4:e2b --runs 1
 *   pnpm spike:llm --cases 내케이스.local.json --cases cases/sample.json
 *   pnpm spike:llm --list                           # 설치된 모델·기능·메모리 보기
 *   pnpm spike:llm --fake                           # Ollama 없이 흐름만 확인 (가짜 모델)
 *
 * 결과: out/<시각>/report.md, results.json (out/ 은 커밋하지 않는다 — 회사 TC 내용이 들어갈 수 있음)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CompareOptions, LlmCase, LoadedCase } from '@auto-qa/llm';
import {
	compareModels,
	DEFAULT_COMPARE_OPTIONS,
	OllamaClient,
	parseCaseFile,
	rankModels,
	renderReport,
	summarize
} from '@auto-qa/llm';
import type { FakeChatRequest, FakeOllama } from '@auto-qa/llm/testing';
import { startFakeOllama } from '@auto-qa/llm/testing';

const DEFAULT_MODELS = ['qwen3-vl:2b-instruct', 'qwen3-vl:4b-instruct', 'gemma4:e2b', 'gemma4:e4b'];
const HERE = import.meta.dirname;

const { values } = parseArgs({
	options: {
		host: { type: 'string' },
		'allow-host': { type: 'string', multiple: true, default: [] },
		models: { type: 'string', default: DEFAULT_MODELS.join(',') },
		cases: { type: 'string', multiple: true },
		runs: { type: 'string', default: String(DEFAULT_COMPARE_OPTIONS.runs) },
		think: { type: 'string', default: DEFAULT_COMPARE_OPTIONS.think },
		tasks: { type: 'string', default: 'judge,plan' },
		limit: { type: 'string' },
		'num-ctx': { type: 'string', default: String(DEFAULT_COMPARE_OPTIONS.numCtx) },
		'num-predict': { type: 'string', default: String(DEFAULT_COMPARE_OPTIONS.numPredict) },
		seed: { type: 'string', default: String(DEFAULT_COMPARE_OPTIONS.seed) },
		temperature: { type: 'string', default: String(DEFAULT_COMPARE_OPTIONS.temperature) },
		timeout: { type: 'string', default: '600' },
		keep: { type: 'boolean', default: false },
		list: { type: 'boolean', default: false },
		fake: { type: 'boolean', default: false },
		out: { type: 'string', default: join(HERE, 'out') }
	}
});

/** pnpm 스크립트는 패키지 폴더에서 돌므로, 상대 경로는 명령을 친 폴더(INIT_CWD) 기준으로 푼다 */
const fromCwd = (path: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), path);

/** OLLAMA_HOST는 "0.0.0.0:11434"처럼 주소만 있을 수 있다 */
function hostFrom(value: string | undefined): string {
	const raw = (value ?? process.env['OLLAMA_HOST'] ?? '127.0.0.1:11434').trim();
	const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
	return withScheme.replace('://0.0.0.0', '://127.0.0.1');
}

const int = (name: string, v: string | undefined, min = 0): number => {
	const n = Number(v);
	if (!Number.isFinite(n) || n < min) throw new Error(`--${name} 값이 올바르지 않음: ${v}`);
	return n;
};

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)}GB`;
const sec = (ms: number | null | undefined): string => (ms == null ? '-' : `${(ms / 1000).toFixed(1)}s`);
const pct = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 100)}%`);

/** 가짜 모델 (--fake): 판정은 항상 pass, 계획은 ▼ 한 번. 이미지 미지원 모델, JSON을 못 내는 모델 포함 */
function fakeReply(broken: boolean) {
	return (r: FakeChatRequest): string => {
		if (broken) return '잘 모르겠습니다.';
		if (r.format === undefined) return 'OK';
		return r.messages[0]?.content.includes('리모컨')
			? JSON.stringify({ keys: ['DOWN'], check: '포커스 확인', confidence: 0.5, reason: '가짜 응답' })
			: JSON.stringify({ verdict: 'pass', confidence: 0.5, reason: '가짜 응답' });
	};
}

async function loadCases(
	files: readonly string[],
	tasks: readonly string[],
	limit: number | null
): Promise<{ loaded: LoadedCase[]; cases: LlmCase[] }> {
	const loaded: LoadedCase[] = [];
	for (const file of files) {
		const parsed = parseCaseFile(JSON.parse(await readFile(file, 'utf8')));
		for (const c of parsed.cases) {
			if (!tasks.includes(c.task)) continue;
			const images =
				c.task === 'judge'
					? await Promise.all(
							(c.images ?? []).map(async (p) =>
								(await readFile(resolve(dirname(file), p))).toString('base64')
							)
						)
					: [];
			loaded.push({ case: c, images });
		}
	}
	const picked = limit === null ? loaded : loaded.slice(0, limit);
	return { loaded: picked, cases: picked.map((l) => l.case) };
}

let fake: FakeOllama | undefined;
try {
	if (values.fake) {
		fake = await startFakeOllama([
			{ name: 'fake-vision', capabilities: ['completion', 'vision'], reply: fakeReply(false), evalMs: 800 },
			{ name: 'fake-text', capabilities: ['completion'], reply: fakeReply(false), evalMs: 300 },
			{ name: 'fake-broken', capabilities: ['completion', 'vision', 'thinking'], reply: fakeReply(true) }
		]);
	}
	const client = new OllamaClient({
		host: fake?.url ?? hostFrom(values.host),
		allowHosts: values['allow-host'],
		timeoutMs: int('timeout', values.timeout, 1) * 1000
	});

	if (values.list) {
		console.log(`Ollama ${await client.version()} (${client.endpoint.host})`);
		const running = await client.running();
		for (const m of await client.models()) {
			const d = await client.show(m.name);
			const r = running.find((x) => x.name === m.name);
			console.log(
				`  ${m.name.padEnd(28)} ${gb(m.sizeBytes).padStart(7)}  ${m.parameterSize ?? '?'} ${m.quantization ?? ''}  [${d.capabilities.join(', ')}]  ${d.license ?? ''}${r === undefined ? '' : `  실행 중 ${gb(r.sizeBytes)} (GPU ${gb(r.vramBytes)})`}`
			);
		}
		process.exit(0);
	}

	const models = values.fake
		? ['fake-vision', 'fake-text', 'fake-broken']
		: values.models
				.split(',')
				.map((m) => m.trim())
				.filter(Boolean);
	const caseFiles = (values.cases ?? [join(HERE, 'cases', 'sample.json')]).map(fromCwd);
	const tasks = values.tasks.split(',').map((t) => t.trim());
	const { loaded, cases } = await loadCases(
		caseFiles,
		tasks,
		values.limit === undefined ? null : int('limit', values.limit, 1)
	);
	const think = values.think;
	if (think !== 'off' && think !== 'on' && think !== 'default') throw new Error('--think 는 off | on | default');
	const options: CompareOptions = {
		runs: int('runs', values.runs, 1),
		think,
		temperature: Number(values.temperature),
		seed: int('seed', values.seed),
		numCtx: int('num-ctx', values['num-ctx'], 512),
		numPredict: int('num-predict', values['num-predict'], 16),
		unloadAfter: !values.keep
	};

	const startedAt = new Date();
	console.log(
		`모델 ${models.length}개 × 케이스 ${cases.length}개 × ${options.runs}회 (생각 모드 ${options.think}) — ${client.endpoint.host}`
	);
	const t0 = new Map<string, number>();
	const result = await compareModels(client, models, loaded, options, (e) => {
		if (e.note !== undefined) return console.log(`[${e.model}] ${e.note}`);
		const r = e.record;
		if (r === undefined) return;
		if (!t0.has(e.model)) t0.set(e.model, Date.now() - (r.metrics?.wallMs ?? 0));
		const elapsed = Date.now() - (t0.get(e.model) ?? Date.now());
		const eta = e.done > 0 ? Math.round(((elapsed / e.done) * (e.total - e.done)) / 1000) : 0;
		const what =
			r.failure !== null
				? `실패: ${r.failure.slice(0, 80)}`
				: !r.valid
					? `JSON 오류: ${r.errors[0] ?? ''}`
					: `${r.correct ? '✓' : '✗'} ${r.decision?.task === 'judge' ? r.decision.verdict : (r.decision?.keys ?? []).join(' ')}`;
		console.log(
			`[${e.model}] ${e.done}/${e.total} ${r.caseId}#${r.run} ${what} ${sec(r.metrics?.wallMs)} (남은 시간 약 ${eta}s)`
		);
	});
	const finishedAt = new Date();

	const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const out = join(resolve(values.out), stamp);
	await mkdir(out, { recursive: true });
	const meta = {
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		caseFiles: caseFiles.map((f) => relative(process.env['INIT_CWD'] ?? process.cwd(), f))
	};
	await writeFile(join(out, 'results.json'), `${JSON.stringify({ meta, ...result }, null, '\t')}\n`);
	await writeFile(join(out, 'report.md'), renderReport(result, cases, meta));

	console.log('\n순위 (판정 정확 → 확신 오답 → 계획 정확 → 반복 일치 → 속도)');
	rankModels(result.runs.map(summarize)).forEach((s, i) => {
		console.log(
			`  ${i + 1}. ${s.model.padEnd(24)} 판정 ${pct(s.judge.accuracy)} (이미지 ${pct(s.judge.imageAccuracy)}, 확신 오답 ${s.judge.confidentWrong})  계획 ${pct(s.plan.exactRate)}  반복 일치 ${pct(s.consistency)}  JSON ${pct(s.validRate)}  응답 ${sec(s.medianMs)}  로드 ${sec(s.loadMs)}  메모리 ${s.memory === null ? '-' : gb(s.memory.sizeBytes)}`
		);
	});
	for (const r of result.runs.filter((x) => x.status !== 'ok'))
		console.log(`  - ${r.model}: ${r.reason ?? r.status}`);
	console.log(`\n→ ${join(out, 'report.md')}`);
} finally {
	await fake?.close();
}
