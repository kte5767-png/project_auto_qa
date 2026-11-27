import type { SpecKey } from '@auto-qa/spec';
import { DEFAULT_KEYMAP_OPTIONS, parseKeyAction } from './keymap';
import type { KeyAction, KeyMapOptions, NavCallout, NavScreen } from './keymap';

/**
 * 키 동작 판정 기준은 TC (D-044, D-046). 화면설계서와 TC가 다른 판이면(예: 화면설계서 v2.0.4 "[▼] 동작 없음",
 * TC v2.0.3 "[▼] Back to Top 버튼 포커스") 화면설계서 문장으로 기대값을 정하면 TC대로 움직이는 앱이 Fail이 된다.
 * 그래서 확인하는 콜아웃의 키 동작은 TC 문장으로 다시 해석해 이동 지도에서 바꿔 끼우고,
 * 화면설계서는 콜아웃 이름·위치·목업 글자(대상 찾기)와 다른 콜아웃의 동작(길 찾기)에만 쓴다.
 */

const KEY_MARK = /^\s*\[\s*(?:▲|▼|◀|▶|◄|►|OK|Back)\s*\]\s*[:：]?\s*/i;

/**
 * TC 조건 "[▼] A / 이동한 이력이 있을 경우: B" → 키 동작 문장 "A (이동한 이력이 있을 경우: B)".
 * 화면설계서 설명에서 키 줄 아래 조건 줄을 괄호로 붙이는 것(parseDescription)과 같은 꼴로 맞춘다.
 * 그래야 조건 속 낱말("마지막 포커스한 콘텐츠")이 기대 위치("마지막 항목")로 잘못 읽히지 않는다.
 */
export function keyClauseText(text: string): string {
	const body = text.replace(/[︎️]/g, '').replace(KEY_MARK, '');
	const [main = '', ...rest] = body.split(/\s+\/\s+/);
	return [
		main.trim(),
		...rest
			.map((r) => r.trim())
			.filter((r) => r !== '')
			.map((r) => `(${r})`)
	]
		.filter((p) => p !== '')
		.join(' ');
}

/**
 * 콜아웃 이름 보강: 화면설계서 이름에 TC 단계 이름("(6) Back to Top")·앱 프로필 이름을 더한다.
 * 화면설계서에 없는 콜아웃(설명이 빠진 판, 화면설계서가 없는 화면)은 이름만으로 더한다(위치 없음 → 키 방향 추정 안 함).
 * screen이 null이면 이름만으로 화면을 만든다.
 */
export function withCalloutNames(
	screen: NavScreen | null,
	screenId: string,
	names: Readonly<Record<string, readonly string[]>>
): NavScreen {
	const base: NavScreen = screen ?? { screenId, title: null, callouts: [] };
	const clean = (list: readonly string[]): string[] => list.map((n) => n.trim()).filter((n) => n !== '');
	const callouts: NavCallout[] = base.callouts.map((c) => ({
		...c,
		names: [...new Set([...c.names, ...clean(names[c.no] ?? [])])]
	}));
	for (const [no, list] of Object.entries(names)) {
		if (callouts.some((c) => c.no === no)) continue;
		const extra = [...new Set(clean(list))];
		if (extra.length === 0) continue;
		callouts.push({ no, names: extra, texts: [], rect: null, keys: {} });
	}
	callouts.sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }));
	return { ...base, callouts };
}

export interface TcKeyOverride {
	/** 바꿔 끼운 뒤의 이동 지도 */
	actions: KeyAction[];
	/** TC 문장으로 해석한 동작 (키별) */
	tc: Partial<Record<SpecKey, KeyAction>>;
	/** 같은 키의 화면설계서 동작 (없으면 없음) */
	spec: Partial<Record<SpecKey, KeyAction>>;
}

/**
 * 출발 콜아웃(from)의 키 동작을 TC 문장으로 바꿔 끼운다. 반대 방향 키("[◀] 이전 항목")도 함께 바꿔야
 * 목록 안 이동 추정(expectAfterKey)이 TC와 맞으므로 그 단계의 키 동작을 모두 준다.
 * TC 문장이 비었거나 출발 콜아웃이 화면에 없으면 그 키는 화면설계서 동작을 그대로 둔다.
 */
export function overrideKeyTexts(
	actions: readonly KeyAction[],
	screen: NavScreen,
	from: string,
	texts: Partial<Record<SpecKey, string>>,
	options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS
): TcKeyOverride {
	const origin = screen.callouts.find((c) => c.no === from);
	const tc: Partial<Record<SpecKey, KeyAction>> = {};
	const spec: Partial<Record<SpecKey, KeyAction>> = {};
	if (origin === undefined) return { actions: [...actions], tc, spec };
	for (const [key, raw] of Object.entries(texts) as [SpecKey, string][]) {
		const text = keyClauseText(raw);
		if (text === '') continue;
		tc[key] = parseKeyAction(origin, key, text, screen.callouts, options);
		const old = actions.find((a) => a.from === from && a.key === key);
		if (old !== undefined) spec[key] = old;
	}
	const replaced = new Set(Object.keys(tc));
	return {
		actions: [
			...actions.filter((a) => !(a.from === from && replaced.has(a.key))),
			...(Object.values(tc) as KeyAction[])
		],
		tc,
		spec
	};
}
