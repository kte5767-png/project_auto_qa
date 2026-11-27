import type { SpecKey } from '@auto-qa/spec';
import { DEFAULT_KEYMAP_OPTIONS, describeEffect, nameScore, nameTokens, splitLikeOther } from './keymap';
import type { KeyAction, KeyMapOptions } from './keymap';

/**
 * 키 하나를 누른 뒤 포커스가 있어야 할 곳을 화면설계서 이동 지도에서 정한다 (D-036 ①·③).
 * 결정적 규칙이며, 지도에 없거나 해석하지 못한 동작은 기대값을 만들지 않는다(확인 불가).
 */

export type FocusTarget =
	/** 같은 화면의 다른 콜아웃 */
	| { kind: 'callout'; no: string }
	/** 콜아웃이 아닌 요소 (이름만 있음) */
	| { kind: 'element'; name: string }
	/** 화면 밖 (GNB 확장, 이전 화면 등) */
	| { kind: 'leave'; to: string }
	/** 제자리 (동작 없음, 같은 목록 안 이동) */
	| { kind: 'same' };

/**
 * 목록 안 위치.
 * memory = 이동한 이력이 있으면 마지막으로 있던 항목, 없으면 첫 항목.
 * same = 같은 항목 그대로. below·above = 같은 목록(그리드)의 아래·위 줄 항목 (몇 번째인지는 줄 폭을 알아야 해서 정하지 않음).
 * null = 화면설계서가 정하지 않음
 */
export type FocusItem = 'first' | 'last' | 'next' | 'prev' | 'below' | 'above' | 'memory' | 'same' | null;

export interface ExpectedFocus {
	ok: true;
	target: FocusTarget;
	item: FocusItem;
	/** 문장에 적힌 항목 이름 (따옴표) */
	itemName: string | null;
	/** 이름으로 정하지 못해 키 방향으로 고른 대상 (사람 확인 필요) */
	estimated: boolean;
	/** 더 이상 갈 항목이 없으면 동작 없음 */
	endNoop: boolean;
	/** 근거 문장 (예: `② [▼] "…" → move:3:first`) */
	basis: string;
}

export interface NoExpectation {
	ok: false;
	reason: string;
	basis: string;
}

export const SPEC_KEY_LABEL: Record<SpecKey, string> = {
	up: '▲',
	down: '▼',
	left: '◀',
	right: '▶',
	ok: 'OK',
	back: 'Back'
};

const OPPOSITE: Partial<Record<SpecKey, SpecKey>> = { left: 'right', right: 'left', up: 'down', down: 'up' };

/** 목록 안 현재 위치 (0부터) */
export interface ListPosition {
	index: number;
	count: number;
}

/**
 * @param position 출발 요소가 목록이면 현재 위치. 화면설계서는 목록 콜아웃의 키를 "[►]: 다음 항목 / [◀]: GNB 확장"처럼
 *   끝에서의 동작만 적는 경우가 많아, 반대 방향 키가 "다음·이전 항목"이고 목록 끝이 아니면 같은 목록 안 이동으로 본다.
 */
export function expectAfterKey(
	actions: readonly KeyAction[],
	from: string,
	key: SpecKey,
	position: ListPosition | null = null
): ExpectedFocus | NoExpectation {
	const label = `${from}번 [${SPEC_KEY_LABEL[key]}]`;
	const action = actions.find((a) => a.from === from && a.key === key);
	const opposite = OPPOSITE[key];
	const twin = opposite === undefined ? undefined : actions.find((a) => a.from === from && a.key === opposite);
	if (position !== null && twin !== undefined && twin.effect.kind === 'step' && action?.effect.kind !== 'step') {
		const delta = -twin.effect.delta;
		const to = position.index + delta;
		if (to >= 0 && to < position.count) {
			const word = delta > 0 ? '다음' : '이전';
			return {
				ok: true,
				target: { kind: 'same' },
				item: delta > 0 ? 'next' : 'prev',
				itemName: null,
				estimated: false,
				endNoop: false,
				basis: `${label} 같은 목록 ${word} 항목 (반대 키 [${SPEC_KEY_LABEL[twin.key]}]가 "${twin.text}", 목록 끝이 아님)`
			};
		}
	}
	if (action === undefined) {
		return { ok: false, reason: `화면설계서에 ${label} 동작이 없음`, basis: label };
	}
	const basis = `${label} "${action.text}" → ${describeEffect(action.effect)}`;
	const base = { ok: true as const, itemName: null, estimated: false, endNoop: action.endNoop, basis };
	const e = action.effect;
	switch (e.kind) {
		case 'none':
			return { ...base, target: { kind: 'same' }, item: 'same' };
		case 'leave':
			return { ...base, target: { kind: 'leave', to: e.to }, item: null };
		case 'step':
			return { ...base, target: { kind: 'same' }, item: e.delta > 0 ? 'next' : 'prev', itemName: e.item };
		case 'row':
			return { ...base, target: { kind: 'same' }, item: e.delta > 0 ? 'below' : 'above' };
		case 'move':
			return {
				...base,
				target: { kind: 'callout', no: e.to },
				item: e.memory ? 'memory' : e.position,
				itemName: e.item
			};
		case 'element':
			return { ...base, target: { kind: 'element', name: e.name }, item: e.memory ? 'memory' : null };
		case 'unknown':
			if (action.estimate !== null) {
				return {
					...base,
					target: { kind: 'callout', no: action.estimate.to },
					item: null,
					estimated: true,
					basis: `${basis} (키 방향 추정 ${action.estimate.to}번: ${action.estimate.reason})`
				};
			}
			return { ok: false, reason: `화면설계서 ${label} 문장을 해석하지 못함: "${action.text}"`, basis };
	}
}

/** p의 낱말이 q에 모두 들어 있는가 (같은 낱말이 여러 번이면 그 수만큼) */
function covered(p: readonly string[], q: readonly string[]): boolean {
	const rest = [...q];
	return p.every((t) => {
		const i = rest.indexOf(t);
		if (i < 0) return false;
		rest.splice(i, 1);
		return true;
	});
}

/**
 * 한쪽 이름의 낱말이 다른 쪽에 모두 들어 있을 때만 낱말 일치 점수, 아니면 0.
 * "추천 검색어" ↔ "최근 검색어"처럼 양쪽에 서로 다른 낱말이 있으면 공통 낱말("검색어")이 있어도 다른 대상이다.
 * "GNB" ↔ "GNB 검색", "추천 검색어" ↔ "4.2 ② 추천 검색어"는 한쪽이 다른 쪽에 들어 있어 점수를 준다.
 */
export function containedNameScore(a: string, b: string, options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS): number {
	const x0 = nameTokens(a, options);
	const y0 = nameTokens(b, options);
	// 띄어쓰기 차이("추천검색어" ↔ "추천 검색어")는 같은 이름으로 본다
	const x = splitLikeOther(x0, y0);
	const y = splitLikeOther(y0, x0);
	if (!covered(x, y) && !covered(y, x)) return 0;
	return nameScore(a, b, options);
}

/**
 * 이름으로 후보 고르기 (콜아웃이 아닌 요소·화면 밖 이름 ↔ 사람이 지정한 요소).
 * 이름 낱말이 한쪽에 모두 들어 있는 것만 후보로 보고(containedNameScore), 가장 높은 점수가 기준 이상이고
 * 2위와 차이가 충분할 때만 고른다. 일부 낱말만 같은 다른 요소를 골라 기대 위치를 잘못 정하면 오탐(Fail)이 나므로
 * 맞는 것이 없으면 고르지 않는다(확인 불가).
 */
export function matchByName<T>(
	name: string,
	candidates: readonly T[],
	namesOf: (c: T) => readonly string[],
	options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS
): { match: T; score: number } | null {
	const scored = candidates
		.map((c) => ({ c, score: Math.max(0, ...namesOf(c).map((n) => containedNameScore(name, n, options))) }))
		.sort((a, b) => b.score - a.score);
	const [first, second] = scored;
	if (first === undefined || first.score < options.minNameScore) return null;
	if (second !== undefined && first.score - second.score < options.ambiguityMargin) return null;
	return { match: first.c, score: first.score };
}

/** 목록 안 기대 순번 (0부터). 정할 수 없으면 null */
export function expectedItemIndex(
	item: FocusItem,
	context: { previous: number; count: number; remembered: number | null; endNoop: boolean }
): number | null {
	/** 목록 끝: 화면설계서가 "더 이상 … 없을 경우 동작 없음"이라 하면 제자리, 아니면 정하지 않음 */
	const atEnd = (): number | null => (context.endNoop ? context.previous : null);
	switch (item) {
		case 'first':
			return 0;
		case 'last':
			return context.count > 0 ? context.count - 1 : null;
		case 'same':
			return context.previous >= 0 ? context.previous : null;
		case 'next':
			if (context.previous < 0) return null;
			return context.previous + 1 < context.count ? context.previous + 1 : atEnd();
		case 'prev':
			if (context.previous < 0) return null;
			return context.previous - 1 >= 0 ? context.previous - 1 : atEnd();
		case 'memory':
			return context.remembered ?? 0;
		case 'below':
		case 'above':
		case null:
			return null;
	}
}
