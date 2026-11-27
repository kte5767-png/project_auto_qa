import type { Check, Clause } from './clauses';

/**
 * 조건별 결과 → 단계 판정과 판정 설명 (D-025, D-036 ④, D-037).
 * - 조건 하나라도 Fail → Fail
 * - Fail이 없고 확인 필요가 있으면 → 확인 필요
 * - 화면으로 확인한 조건이 모두 통과 → Pass. 확인 불가 조건은 Pass를 막지 않고 설명에 적는다
 * - 화면으로 확인할 조건이 없으면 → 확인 필요
 */

export type Verdict = 'pass' | 'fail' | 'needs-review';

/** 엑셀 `자동 판정` 열에 쓰는 글자 (D-025) */
export const VERDICT_LABEL: Record<Verdict, string> = { pass: 'Pass', fail: 'Fail', 'needs-review': '확인 필요' };

export interface CheckResult {
	clause: Clause;
	check: Check;
	/** 확인 불가 조건은 null */
	verdict: Verdict | null;
	/** 코드 판정은 정해진 문장, AI 판정은 AI 설명 */
	explanation: string;
	oracle: 'code' | 'ai' | 'none';
	confidence: number | null;
	/** 코드가 잰 값 (예: 보인 항목 개수). 틀린 TC를 만들 때 쓴다 */
	observed?: number;
}

export interface StepVerdict {
	verdict: Verdict;
	/** 엑셀 `판정 설명` */
	explanation: string;
	/** 엑셀 `판정 근거` 요약 (코드 n · AI n · 확인 불가 n) */
	basis: string;
	counts: { code: number; ai: number; none: number; fail: number; review: number };
}

export interface AiGateOptions {
	/** AI의 pass를 Pass로 확정하는 신뢰도 기준 (측정으로 정한다) */
	passThreshold: number;
}

export const DEFAULT_AI_GATE: AiGateOptions = { passThreshold: 1.01 };

/**
 * AI 판정 처리 (D-036 ④): fail → Fail, uncertain → 확인 필요,
 * pass → 신뢰도가 기준 이상이거나 같은 입력을 사람이 Pass로 확인했을 때만 Pass.
 * 기본 기준(1.01)은 "AI 혼자 Pass를 확정하지 않음" — 측정으로 기준을 정하기 전의 안전한 값이다.
 */
export function gateAiVerdict(
	ai: { verdict: 'pass' | 'fail' | 'uncertain'; confidence: number; reason: string },
	humanConfirmedPass: boolean,
	options: AiGateOptions = DEFAULT_AI_GATE
): { verdict: Verdict; explanation: string } {
	if (ai.verdict === 'fail') return { verdict: 'fail', explanation: ai.reason };
	if (ai.verdict === 'uncertain') return { verdict: 'needs-review', explanation: `AI 판단 불가: ${ai.reason}` };
	if (humanConfirmedPass) return { verdict: 'pass', explanation: `${ai.reason} (같은 입력을 사람이 Pass로 확인함)` };
	if (ai.confidence >= options.passThreshold) return { verdict: 'pass', explanation: ai.reason };
	return {
		verdict: 'needs-review',
		explanation: `AI 의견: 통과로 보임 — ${ai.reason} (신뢰도 ${ai.confidence.toFixed(2)}, 기준 미달)`
	};
}

const short = (text: string, max = 40): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function aggregateStep(results: readonly CheckResult[]): StepVerdict {
	const checked = results.filter((r) => r.verdict !== null);
	const fails = checked.filter((r) => r.verdict === 'fail');
	const reviews = checked.filter((r) => r.verdict === 'needs-review');
	const skipped = results.filter((r) => r.verdict === null);
	const counts = {
		code: results.filter((r) => r.oracle === 'code').length,
		ai: results.filter((r) => r.oracle === 'ai').length,
		none: skipped.length,
		fail: fails.length,
		review: reviews.length
	};
	const basis = `코드 ${counts.code} · AI ${counts.ai} · 확인 불가 ${counts.none}`;
	const unchecked =
		skipped.length === 0
			? ''
			: `확인하지 않은 조건: ${[...new Set(skipped.map((r) => short(r.clause.text)))].join(', ')}`;
	const join = (parts: string[]): string => parts.filter((p) => p !== '').join('\n');

	if (fails.length > 0) {
		return { verdict: 'fail', explanation: join([...fails.map((r) => r.explanation), unchecked]), basis, counts };
	}
	if (reviews.length > 0) {
		return {
			verdict: 'needs-review',
			explanation: join([...reviews.map((r) => r.explanation), unchecked]),
			basis,
			counts
		};
	}
	if (checked.length === 0) {
		return {
			verdict: 'needs-review',
			explanation: join(['화면으로 확인할 수 있는 조건이 없음', unchecked]),
			basis,
			counts
		};
	}
	return {
		verdict: 'pass',
		explanation: join([`화면으로 확인한 조건 ${checked.length}개 모두 통과`, unchecked]),
		basis,
		counts
	};
}
