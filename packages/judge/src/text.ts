import type { Verdict } from './verdict';

/**
 * 코드 판정 중 글자·개수 비교와 그 설명 문장 (D-025: 코드 판정 설명은 정해진 문장 틀).
 * 문구 기준은 UX 화면설계서다 (D-036 ②). 정해진 문구는 글자 그대로, 바뀔 수 있는 글자는 있는지만 본다.
 */

export interface TextOptions {
	/** 대소문자 무시 (기본: 구분) */
	ignoreCase: boolean;
	/** 끝의 마침표 차이 무시 (기본: 구분) */
	ignoreTrailingPeriod: boolean;
}

export const DEFAULT_TEXT_OPTIONS: TextOptions = { ignoreCase: false, ignoreTrailingPeriod: false };

export interface CodeCheckResult {
	verdict: Verdict;
	explanation: string;
}

/** 공백·따옴표 모양·제어 문자만 맞춘다 (내용은 바꾸지 않음) */
export function normalizeText(text: string, options: TextOptions = DEFAULT_TEXT_OPTIONS): string {
	let t = text
		.normalize('NFC')
		.replace(/\p{C}/gu, '')
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
	if (options.ignoreTrailingPeriod) t = t.replace(/[.。]+$/, '');
	if (options.ignoreCase) t = t.toLowerCase();
	return t;
}

function similarity(a: string, b: string): number {
	if (a === b) return 1;
	const m = a.length;
	const n = b.length;
	if (m === 0 || n === 0) return 0;
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		const cur = [i];
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			cur.push(Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
		}
		prev = cur;
	}
	return 1 - (prev[n] ?? 0) / Math.max(m, n);
}

/** 정해진 문구: 화면 글자 중 하나가 글자 그대로 같아야 한다 */
export function checkExactText(
	expected: string,
	actual: readonly string[],
	where: string,
	options: TextOptions = DEFAULT_TEXT_OPTIONS
): CodeCheckResult {
	const want = normalizeText(expected, options);
	const got = actual.map((a) => normalizeText(a, options)).filter((a) => a !== '');
	if (got.includes(want)) return { verdict: 'pass', explanation: `${where} 문구 일치: "${expected}"` };
	if (got.length === 0) return { verdict: 'fail', explanation: `${where}에 문구가 없음 (기대: "${expected}")` };
	const closest = [...got].sort((a, b) => similarity(want, b) - similarity(want, a))[0] ?? '';
	return { verdict: 'fail', explanation: `${where} 문구가 다름: 기대 "${expected}" / 실제 "${closest}"` };
}

/** 바뀔 수 있는 글자: 그 자리에 비어 있지 않은 글자가 있으면 통과 */
export function checkPresence(actual: readonly string[], where: string): CodeCheckResult {
	const got = actual.map((a) => normalizeText(a)).filter((a) => a !== '');
	if (got.length > 0) return { verdict: 'pass', explanation: `${where}에 글자 있음 (현재: "${got[0] ?? ''}")` };
	return { verdict: 'fail', explanation: `${where}에 글자가 없음` };
}

/** 개수 상한 */
export function checkMaxCount(max: number, actual: number, where: string): CodeCheckResult {
	if (actual <= max) return { verdict: 'pass', explanation: `${where} ${actual}개 (최대 ${max}개)` };
	return { verdict: 'fail', explanation: `${where} ${actual}개 — 최대 ${max}개를 넘음` };
}
