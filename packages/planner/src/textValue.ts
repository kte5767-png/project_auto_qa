/**
 * 글자 입력 값 정하기 (D-043 ①). 진입 경로·TC 조작에서 입력란에 넣을 글자를 정한다.
 *
 * - 글자 그대로: `"Bali"`
 * - `"@no-result"`, `"@no-result:16"`: 검색 결과가 나오지 않을 글자. 자음만 섞은 글자를 seed로 만들어
 *   같은 seed면 늘 같은 글자다(재현성, D-005). 길이 기본 12
 * - `"@over-limit:255"`: 글자 수 상한 + 1자. 몇 번째 글자인지 보이도록 숫자를 반복한다
 * - `"@data:이름"`: 프로필 테스트 데이터 — 화면설계서·TC로 정할 수 없고 앱 데이터를 알아야 하는 값
 *   (예: 항공권 결과가 나오는 검색어). 없으면 실행하지 않고 이유를 남긴다
 * - `"@most-results"`, `"@most-results:a,o,e"`: 후보 글자 중 결과가 가장 많이 나오는 것. 실행기가 후보마다 입력해
 *   결과 항목 수를 세고 `pickMostResults`로 고른다(같으면 앞 후보). 결과가 적으면 "전체" 필터·스크롤·맨 위로 버튼처럼
 *   결과가 많을 때만 보이는 것을 확인할 수 없어 오탐이 나므로 쓴다. 고르기 전에는 값이 없다
 */
export type TextValueKind = 'literal' | 'no-result' | 'over-limit' | 'data' | 'most-results';

export type TextValue = { value: string; kind: TextValueKind } | { error: string };

export interface TextValueContext {
	/** 무작위 글자의 seed (예: 화면 번호). 같은 seed면 같은 글자 */
	seed: string;
	/** 프로필 테스트 데이터 */
	data: Readonly<Record<string, string>>;
	/** 실행기가 이미 고른 값 (`@most-results` 글자 → 고른 후보) */
	chosen?: Readonly<Record<string, string>>;
}

export const DEFAULT_NO_RESULT_LENGTH = 12;
/** `@most-results` 기본 후보: 영문 한 글자 중 단어에 자주 들어가는 모음 (결과가 많이 나올 만한 검색어) */
export const DEFAULT_RESULT_CANDIDATES: readonly string[] = ['a', 'o', 'e'];
/** 후보가 많으면 실행이 길어지므로 상한을 둔다 (후보마다 한 번씩 입력·검색) */
export const MAX_RESULT_CANDIDATES = 10;
const MAX_GENERATED = 10_000;
const CONSONANTS = 'bcdfghjklmnpqrstvwxz';

const TOKEN = /^@([a-z-]+)(?::(.*))?$/;

function positiveInt(raw: string | undefined): number | null {
	if (raw === undefined || !/^\d+$/.test(raw)) return null;
	const n = Number(raw);
	return n > 0 && n <= MAX_GENERATED ? n : null;
}

/** FNV-1a 32비트 */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

/** 같은 seed면 같은 글자 (자음만 — 단어·지명과 겹치지 않게) */
export function noResultText(seed: string, length = DEFAULT_NO_RESULT_LENGTH): string {
	let state = hash(seed) || 1;
	let out = '';
	for (let i = 0; i < length; i++) {
		// xorshift32
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		out += CONSONANTS[state % CONSONANTS.length];
	}
	return out;
}

/** 상한 + 1자. "1234567890"을 반복해 몇 번째 글자에서 잘렸는지 보인다 */
export function overLimitText(limit: number): string {
	const length = limit + 1;
	return '1234567890'.repeat(Math.ceil(length / 10)).slice(0, length);
}

/** `@most-results`의 후보 목록. 다른 값이면 null (형식이 틀려도 null — textValueError로 확인) */
export function textCandidates(spec: string): string[] | null {
	const m = TOKEN.exec(spec);
	if (m?.[1] !== 'most-results') return null;
	const arg = m[2];
	if (arg === undefined) return [...DEFAULT_RESULT_CANDIDATES];
	return arg.split(',').map((c) => c.trim());
}

export interface ResultTrial {
	value: string;
	/** 결과 항목 수. 결과 화면에 가지 못했으면 null */
	count: number | null;
}

/** 결과가 가장 많은 후보 (같으면 앞 후보 — 재현성). 결과가 하나도 없으면 null */
export function pickMostResults(trials: readonly ResultTrial[]): { value: string; count: number } | null {
	let best: { value: string; count: number } | null = null;
	for (const t of trials) {
		if (t.count === null || t.count <= 0) continue;
		if (best === null || t.count > best.count) best = { value: t.value, count: t.count };
	}
	return best;
}

/** 형식 오류. 정상이면 null (프로필 검사용) */
export function textValueError(spec: string): string | null {
	const m = TOKEN.exec(spec);
	if (m === null) return spec === '' ? '빈 글자' : null;
	const [, name, arg] = m;
	if (name === 'no-result') {
		return arg === undefined || positiveInt(arg) !== null ? null : `@no-result 길이가 잘못됨: ${arg}`;
	}
	if (name === 'over-limit') {
		return positiveInt(arg) !== null ? null : `@over-limit 뒤에 글자 수 상한이 필요함 (예: @over-limit:255)`;
	}
	if (name === 'data') return arg === undefined || arg === '' ? '@data 뒤에 테스트 데이터 이름이 필요함' : null;
	if (name === 'most-results') {
		const candidates = textCandidates(spec) ?? [];
		if (candidates.some((c) => c === '')) return `@most-results 후보에 빈 글자가 있음: ${arg ?? ''}`;
		if (candidates.length > MAX_RESULT_CANDIDATES)
			return `@most-results 후보는 ${MAX_RESULT_CANDIDATES}개까지 (${candidates.length}개)`;
		if (new Set(candidates).size !== candidates.length) return `@most-results 후보가 겹침: ${arg ?? ''}`;
		return null;
	}
	return `모르는 글자 값 @${name ?? ''} (@no-result, @over-limit:N, @data:이름, @most-results)`;
}

export function resolveTextValue(spec: string, context: TextValueContext): TextValue {
	const error = textValueError(spec);
	if (error !== null) return { error };
	const m = TOKEN.exec(spec);
	if (m === null) return { value: spec, kind: 'literal' };
	const [, name, arg] = m;
	if (name === 'no-result') {
		return { value: noResultText(context.seed, positiveInt(arg) ?? DEFAULT_NO_RESULT_LENGTH), kind: 'no-result' };
	}
	if (name === 'over-limit') return { value: overLimitText(positiveInt(arg) ?? 0), kind: 'over-limit' };
	if (name === 'most-results') {
		const chosen = context.chosen?.[spec];
		return chosen === undefined
			? {
					error: `${spec}: 후보 중 결과가 가장 많은 글자를 아직 고르지 않음 (TC 실행기가 후보마다 검색해 고른다)`
				}
			: { value: chosen, kind: 'most-results' };
	}
	const key = arg ?? '';
	const value = context.data[key];
	return value === undefined || value === ''
		? { error: `테스트 데이터 "${key}"가 프로필에 없음 (앱 데이터를 알아야 하는 값)` }
		: { value, kind: 'data' };
}
