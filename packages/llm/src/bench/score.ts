import type { LlmCase, PlanKey, Task, Verdict } from './cases';

export interface Decision {
	task: Task;
	verdict: Verdict | null;
	keys: PlanKey[] | null;
	confidence: number | null;
	reason: string | null;
	check: string | null;
}

/** 스키마 검사를 통과한 출력에서 판단 부분만 꺼낸다 */
export function decisionOf(task: Task, json: unknown): Decision | null {
	if (typeof json !== 'object' || json === null) return null;
	const o = json as Record<string, unknown>;
	const confidence = typeof o['confidence'] === 'number' ? o['confidence'] : null;
	const reason = typeof o['reason'] === 'string' ? o['reason'] : null;
	if (task === 'judge') {
		const verdict = o['verdict'];
		if (verdict !== 'pass' && verdict !== 'fail' && verdict !== 'uncertain') return null;
		return { task, verdict, keys: null, confidence, reason, check: null };
	}
	if (!Array.isArray(o['keys'])) return null;
	return {
		task,
		verdict: null,
		keys: o['keys'] as PlanKey[],
		confidence,
		reason,
		check: typeof o['check'] === 'string' ? o['check'] : null
	};
}

/** 반복 일치 비교용: 판단 부분만 (설명 문장은 빼고) */
export const decisionKey = (d: Decision | null): string =>
	d === null ? '(없음)' : d.task === 'judge' ? (d.verdict ?? '?') : (d.keys ?? []).join(' ');

/** 키 순서 유사도: 1 - 편집 거리 / 긴 쪽 길이 */
export function keySimilarity(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 && b.length === 0) return 1;
	const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
	);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const row = d[i] as number[];
			const prev = d[i - 1] as number[];
			row[j] = Math.min(
				(prev[j] as number) + 1,
				(row[j - 1] as number) + 1,
				(prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		}
	}
	const dist = (d[a.length] as number[])[b.length] as number;
	return Math.round((1 - dist / Math.max(a.length, b.length)) * 1000) / 1000;
}

export interface CaseScore {
	correct: boolean;
	/** 계획: 키 순서 유사도, 판정: 맞으면 1 */
	partial: number;
	/** 판정: 틀린 pass/fail을 단정함 (확인할 수 없는 것을 pass라고 한 경우 포함) — 가장 위험한 오류. uncertain은 해당 없음 */
	confidentWrong: boolean;
}

export function scoreCase(c: LlmCase, d: Decision | null): CaseScore {
	if (d === null) return { correct: false, partial: 0, confidentWrong: false };
	if (c.task === 'judge') {
		const correct = d.verdict === c.answer.verdict;
		const confidentWrong = !correct && (d.verdict === 'pass' || d.verdict === 'fail');
		return { correct, partial: correct ? 1 : 0, confidentWrong };
	}
	const keys = d.keys ?? [];
	const correct = keys.length === c.answer.keys.length && keys.every((k, i) => k === c.answer.keys[i]);
	return { correct, partial: keySimilarity(keys, c.answer.keys), confidentWrong: false };
}
