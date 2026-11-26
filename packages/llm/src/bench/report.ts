import type { CompareResult } from './compare';
import { rankModels, summarize } from './compare';
import type { LlmCase } from './cases';
import { decisionKey } from './score';

export interface ReportMeta {
	startedAt: string;
	finishedAt: string;
	caseFiles: string[];
}

const pct = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 1000) / 10}%`);
const sec = (ms: number | null): string => (ms === null ? '-' : `${(ms / 1000).toFixed(1)}s`);
const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)}GB`;
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** 사람이 읽는 비교 결과 (Markdown) */
export function renderReport(result: CompareResult, cases: readonly LlmCase[], meta: ReportMeta): string {
	const summaries = result.runs.map(summarize);
	const ranked = rankModels(summaries);
	const judgeCases = result.cases.filter((c) => c.task === 'judge');
	const o = result.options;
	const lines: string[] = [
		'# 로컬 LLM 비교 (P0-8)',
		'',
		`- 일시: ${meta.startedAt} ~ ${meta.finishedAt}`,
		`- Ollama ${result.ollamaVersion} · 프롬프트 ${result.promptVersion}`,
		`- 설정: 반복 ${o.runs}회, 생각 모드 ${o.think}, temperature ${o.temperature}, seed ${o.seed}, num_ctx ${o.numCtx}, num_predict ${o.numPredict}`,
		`- 케이스 ${result.cases.length}개: 판정 ${judgeCases.length}(이미지 ${judgeCases.filter((c) => c.withImages).length}), 계획 ${result.cases.length - judgeCases.length} — ${meta.caseFiles.join(', ')}`,
		'',
		'> 판정 정확·계획 정확은 반복 전체 기준. 확신 오답 = 틀린 pass/fail을 단정한 수(확인할 수 없는 것을 pass라고 한 경우 포함) — 사람이 믿고 넘어가는 오류라 가장 위험하다.',
		'',
		'## 요약 (순위)',
		'',
		'| 순위 | 모델 | JSON 유효 | 판정 정확 | 이미지 판정 | 확신 오답 | 계획 정확 | 키 유사도 | 반복 일치 | 응답 중앙/95% | 토큰/초 | 로드 | 메모리(GPU) |',
		'|---|---|---|---|---|---|---|---|---|---|---|---|---|'
	];
	ranked.forEach((s, i) => {
		const mem = s.memory === null ? '-' : `${gb(s.memory.sizeBytes)} (${gb(s.memory.vramBytes)})`;
		lines.push(
			`| ${i + 1} | ${s.model} | ${pct(s.validRate)} | ${pct(s.judge.accuracy)} | ${pct(s.judge.imageAccuracy)} | ${s.judge.confidentWrong} | ${pct(s.plan.exactRate)} | ${s.plan.meanSimilarity ?? '-'} | ${pct(s.consistency)} | ${sec(s.medianMs)} / ${sec(s.p95Ms)} | ${s.tokensPerSecond ?? '-'} | ${sec(s.loadMs)} | ${mem} |`
		);
	});
	const excluded = summaries.filter((s) => s.status !== 'ok' || s.calls === 0 || s.failures > 0 || s.skipped > 0);
	if (excluded.length > 0) {
		lines.push('', '## 제외·오류', '');
		for (const s of excluded) {
			const parts = [
				s.reason,
				s.failures > 0 ? `호출 실패 ${s.failures}건` : null,
				s.skipped > 0 ? `건너뜀 ${s.skipped}건(이미지 미지원)` : null
			].filter((x): x is string => x !== null);
			lines.push(`- ${s.model}: ${parts.join(', ') || '결과 없음'}`);
		}
	}

	const models = result.runs.filter((r) => r.calls.length > 0);
	if (models.length > 0) {
		lines.push('', '## 케이스별 결과', '', `| 케이스 | 정답 | ${models.map((r) => r.model).join(' | ')} |`);
		lines.push(`|---|---|${models.map(() => '---').join('|')}|`);
		for (const c of cases) {
			const answer = c.task === 'judge' ? c.answer.verdict : c.answer.keys.join(' ');
			const cols = models.map((r) => {
				const calls = r.calls.filter((x) => x.caseId === c.id);
				if (calls.length === 0) return '건너뜀';
				return calls
					.map((x) =>
						x.failure !== null
							? '실패'
							: !x.valid
								? 'JSON 오류'
								: `${x.correct ? '✓' : '✗'} ${decisionKey(x.decision)}`
					)
					.join(' / ');
			});
			const title = c.title === undefined ? c.id : `${c.id} ${c.title}`;
			lines.push(`| ${cell(title)} | ${cell(answer)} | ${cols.map(cell).join(' | ')} |`);
		}

		lines.push('', '## 틀린 답과 근거 (첫 번째 반복)', '');
		for (const r of models) {
			const wrong = r.calls.filter((x) => x.run === 1 && !x.correct);
			if (wrong.length === 0) continue;
			lines.push(`### ${r.model}`);
			for (const x of wrong) {
				const why =
					x.failure ??
					(x.errors.length > 0
						? `출력 오류: ${x.errors.slice(0, 2).join('; ')}`
						: (x.decision?.reason ?? ''));
				lines.push(`- ${x.caseId}: ${decisionKey(x.decision)} — ${why.slice(0, 160)}`);
			}
			lines.push('');
		}
	}
	return `${lines.join('\n')}\n`;
}
