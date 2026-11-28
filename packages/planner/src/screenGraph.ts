import type { MergedSpecScreen } from '@auto-qa/spec';
import { containedNameScore } from './expect';
import { DEFAULT_KEYMAP_OPTIONS } from './keymap';
import type { KeyMapOptions } from './keymap';

/**
 * 화면 이동 지도 (D-043 ④ 진입 경로 자동 계산의 입력). 화면설계서 콜아웃의 "선택 시" 문장에서
 * "어느 화면의 어느 콜아웃을 고르면(OK·글자 입력 후 확인) 어느 화면으로 가는지"를 읽는다. 규칙 기반·결정적이다.
 * 대상 화면은 번호("#4.5")나 이름("검색 결과 페이지로 이동" ↔ 화면 제목)으로 찾고, 못 찾으면 이유를 남긴다 (추측하지 않음).
 * "(… 참고)" 괄호는 다른 화면을 가리키는 참고이지 이동이 아니다.
 *
 * 화면 제목은 "바탕 - 상태" 꼴이 많다 ("검색 완료 - 검색 결과 없음"). 바탕이 같은 화면은 한 페이지의 상태들(가족)이다.
 * - 이름이 제목과 다른 말이면("검색 결과 페이지" ↔ 제목 "검색 완료") 이름 낱말이 바탕 낱말과 겹치는 비율로 가족을 고른다.
 *   한 가족만 겹칠 때만 고르고, 이 방법으로 정한 이동은 how='family'로 표시한다 (근거가 약함).
 * - 가족 안에서는 조건으로 고른다: "결과가 없을 경우"면 상태가 "없음"인 화면, 아니면 "없음" 상태가 아닌 화면.
 *   "없음" 상태의 다른 가족 화면은 같은 콜아웃에서 가는 조건부 이동(derived)으로 함께 낸다.
 * - "VKB 호출"처럼 화면 종류 낱말 없이 요소를 부르면, 그 요소 이름(줄임말은 aliases)이 제목에 든 화면이 대상이다.
 *   닫힘·숨김 상태 화면은 빼고, 이 화면이면(요소가 이 화면 안에 있음) 이동이 아니다.
 */

export interface GraphCallout {
	no: string;
	names: string[];
	sections: { title: string; items: string[] }[];
}

export interface GraphScreen {
	screenId: string;
	title: string | null;
	/** 화면 설명의 진입 조건 문장 ("최근 검색어가 있을 경우 검색 페이지 진입 시 화면") */
	entryConditions: string[];
	callouts: GraphCallout[];
}

export type EdgeAction =
	/** 콜아웃에서 OK */
	| 'select'
	/** 콜아웃(입력란)에 글자를 넣고 확인 */
	| 'submit';

export interface ScreenEdge {
	from: string;
	callout: string;
	action: EdgeAction;
	to: string;
	/** "~ 경우" 조건 (예: "검색 결과가 없을 경우"). 없으면 null */
	condition: string | null;
	/** 대상 화면을 정한 방법: 번호, 제목 이름, 바탕 낱말이 겹치는 가족, 부른 요소 이름이 든 제목 */
	how: 'number' | 'name' | 'family' | 'element';
	/** 문장이 글자 입력을 말함 ("검색어 입력된 결과 페이지") — 입력란에 글자를 넣고 확인해서 가도 된다 */
	typed: boolean;
	/** 같은 콜아웃의 다른 이동에서 가족 조건으로 끌어낸 이동 */
	derived: boolean;
	/** 문장에서 뽑아 대상을 찾은 이름 ("검색 결과 페이지", 부른 요소 "VKB"). 번호로 찾았으면 null */
	name: string | null;
	text: string;
}

export interface UnresolvedMove {
	from: string;
	callout: string;
	text: string;
	reason: string;
	/** 문장에서 뽑은 대상 이름 (못 뽑았으면 null) */
	name: string | null;
	/** 이름 점수 상위 화면 (진단용) */
	candidates: { id: string; score: number }[];
}

/**
 * "(#4.3 … 참고)"처럼 다른 화면을 번호로 가리키는 참고. 이동이 아니라, 같은 자리가 조건에 따라 달라진 화면
 * (최근 검색어가 있을 때 등)이거나 자세한 설명이 다른 화면에 있다는 뜻이다. 대상 화면의 진입 조건 문장을 함께 둔다
 */
export interface ScreenReference {
	from: string;
	callout: string;
	to: string;
	/** 대상 화면의 진입 조건 첫 문장 (없으면 null) */
	condition: string | null;
	text: string;
}

export interface ScreenGraphOptions {
	/** "선택 시" 묶음 제목 (정규식 원문) */
	selectSection: string;
	/** 이동 낱말 (정규식 원문) */
	moveWords: string;
	/** 대상 이름 뒤에 오는 화면 종류 낱말 (정규식 원문): "검색 결과 페이지로", "Option 팝업" */
	placeWords: string;
	/** 글자 입력 후 확인으로 가는 이동 (정규식 원문) */
	submitWords: string;
	/** 참고 괄호 (이동이 아님) */
	referenceWords: string;
	/** 조건 끝말 ("~ 경우", "~ 시") */
	conditionWords: string;
	/** 이름 비교 (planner 이름 규칙) */
	keymap: KeyMapOptions;
	/** 화면 이름으로 고를 최소 점수와 1·2위 차이 */
	minNameScore: number;
	nameMargin: number;
	/** 제목의 바탕과 상태를 가르는 기호 (정규식 원문) */
	titleSeparator: string;
	/** 이름 앞 꾸밈말의 끝 ("해당 검색어 입력된 검색 결과" → "검색 결과") (정규식 원문, 낱말 끝) */
	modifierEnd: string;
	/** 가족으로 고를 최소 겹침 (이름 낱말 중 바탕에 있는 비율) */
	minFamilyScore: number;
	/** "결과 없음" 상태·조건 (정규식 원문) */
	noResultWords: string;
	/** 요소를 부를 때 그 상태가 아닌 화면 (닫힘·숨김) (정규식 원문) */
	closedWords: string;
	/** 글자 입력을 말하는 문장 (정규식 원문) */
	typedWords: string;
	/** 화면설계서에 흔한 줄임말 ↔ 제목 낱말 (TV UI 일반 용어. 앱마다 다른 이름은 바꿔 넣는다) */
	aliases: Record<string, string[]>;
}

export const DEFAULT_SCREEN_GRAPH_OPTIONS: ScreenGraphOptions = {
	selectSection: '선택\\s*시|선택\\s*할\\s*경우|확인\\s*시|OK\\s*시',
	moveWords: '이동|진입|호출|노출|전환|열림',
	placeWords: '페이지|화면|팝업|창|레이어',
	submitWords: '입력\\s*(?:후|하고|한\\s*뒤)',
	referenceWords: '참고|참조',
	conditionWords: '경우|때',
	keymap: DEFAULT_KEYMAP_OPTIONS,
	minNameScore: 0.5,
	nameMargin: 0.1,
	titleSeparator: '\\s+[-–—]\\s+',
	modifierEnd: '(?:된|한|되는|하는|있는|없는)$',
	minFamilyScore: 0.5,
	noResultWords: '없음|없을|없는',
	closedWords: '닫힘|닫기|숨김|비활성',
	typedWords: '입력',
	aliases: { VKB: ['키보드', '가상 키보드', 'keyboard'] }
};

/** 합친 화면설계서 화면 → 이동 지도 입력 */
export function graphScreenFromSpec(screen: MergedSpecScreen): GraphScreen | null {
	if (screen.screenId === null) return null;
	return {
		screenId: screen.screenId,
		title: screen.title,
		entryConditions: screen.parts.flatMap((p) => p.entryConditions),
		callouts: screen.callouts.map((c) => ({
			no: c.no,
			names: [c.description?.label ?? null, c.label].filter((n): n is string => n !== null && n.trim() !== ''),
			sections: c.description?.sections ?? []
		}))
	};
}

/** 키 줄("[▲]: …")과 그 아래 이어지는 조건 줄은 이동 문장이 아니다 (이동 지도 keymap이 읽는다) */
const KEY_LINE = /^\s*[-·•]?\s*\[\s*(?:▲|▼|◀|◄|▶|►|︎►|OK|Back)\s*\]/i;

/** 괄호 안이 참고면 지운다. 참고가 아닌 괄호(이동 설명)는 괄호만 벗긴다 */
function withoutReferences(text: string, options: ScreenGraphOptions): string {
	const ref = new RegExp(options.referenceWords);
	return text.replace(/\(([^()]*)\)/g, (_, inner: string) => (ref.test(inner) ? ' ' : ` ${inner} `));
}

/** 문장 속 화면 번호 ("#4.5", "4.5.") 중 아는 화면 */
function numberedScreens(text: string, known: ReadonlySet<string>): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/#?\s*(\d+(?:\.\d+)+)\.?/g)) {
		const id = m[1] ?? '';
		if (known.has(id) && !out.includes(id)) out.push(id);
	}
	return out;
}

/** "… 검색 결과 페이지로 이동" → "검색 결과" (이동 낱말 바로 앞, 화면 종류 낱말 앞의 이름) */
function placeName(text: string, options: ScreenGraphOptions): string | null {
	const re = new RegExp(
		`([^,.;:()]*?)\\s*(?:${options.placeWords})\\s*(?:으로|로|를|을|이|가)?\\s*(?:${options.moveWords})`
	);
	const m = re.exec(text);
	const raw = (m?.[1] ?? '').trim();
	if (raw === '') return null;
	// 조건("~ 경우")·조작("선택 시") 뒤의 이름만
	const parts = raw.split(new RegExp(`(?:${options.conditionWords}|시)\\s+`));
	const name = (parts[parts.length - 1] ?? '').trim();
	return name === '' ? null : name;
}

function conditionOf(text: string, options: ScreenGraphOptions): string | null {
	const m = new RegExp(`^(.*?(?:${options.conditionWords}))(?:\\s|,|$)`).exec(text.trim());
	const c = m?.[1]?.trim() ?? '';
	return c === '' ? null : c;
}

/** 화면 이름 (제목, 그 바탕, 괄호 설명을 뺀 상태. 진입 조건 문장은 쓰지 않음) */
function screenNames(s: GraphScreen, options: ScreenGraphOptions): string[] {
	if (s.title === null) return [];
	const { base, state } = splitTitle(s.title, options);
	const core =
		state === null
			? ''
			: state
					.replace(/\([^()]*\)/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
	return [...new Set([s.title, base, core].filter((n) => n !== ''))];
}

/**
 * 화면 이름 점수: 문장 속 이름의 낱말이 화면 이름에 모두 있어야 한다 (반대는 안 됨: 제목 "찾기" ⊂ 이름 "찾기 결과"는
 * "결과"가 다른 페이지를 가리키는 말이라 같은 화면이 아니다)
 */
function screenNameScore(name: string, screenName: string, options: ScreenGraphOptions): number {
	const target = squash(screenName);
	if (!wordsOf(name).every((w) => target.includes(w))) return 0;
	return containedNameScore(name, screenName, options.keymap);
}

/** 제목 → 바탕·상태 ("검색 완료 - 검색 결과 없음" → 바탕 "검색 완료", 상태 "검색 결과 없음") */
export function splitTitle(
	title: string,
	options: ScreenGraphOptions = DEFAULT_SCREEN_GRAPH_OPTIONS
): { base: string; state: string | null } {
	const m = new RegExp(options.titleSeparator).exec(title);
	if (m === null) return { base: title.trim(), state: null };
	const state = title.slice(m.index + m[0].length).trim();
	return { base: title.slice(0, m.index).trim(), state: state === '' ? null : state };
}

const squash = (t: string): string => t.replace(/\s+/g, '').toLowerCase();

/** 이름 앞 꾸밈말을 뗀다 (마지막 꾸밈말 뒤만) */
function withoutModifiers(name: string, options: ScreenGraphOptions): string {
	const words = name.split(/\s+/).filter((w) => w !== '');
	const end = new RegExp(options.modifierEnd);
	let last = -1;
	words.forEach((w, i) => {
		if (end.test(w)) last = i;
	});
	const rest = words.slice(last + 1);
	return (rest.length === 0 ? words : rest).join(' ');
}

const wordsOf = (t: string): string[] =>
	t
		.toLowerCase()
		.split(/[\s()[\]{}<>,.;:·/|_-]+/)
		.filter((w) => w !== '');

/** 요소 이름과 그 줄임말·풀이 */
function aliasNames(name: string, options: ScreenGraphOptions): string[] {
	const out = new Set([name]);
	for (const [short, longs] of Object.entries(options.aliases)) {
		const all = [short, ...longs];
		if (all.some((a) => squash(a) === squash(name))) for (const a of all) out.add(a);
	}
	return [...out];
}

/**
 * 화면 종류 낱말 없이 "VKB 호출"처럼 요소를 부를 때 그 요소 이름: 조건("~할 경우")·조작("~ 후") 뒤 마지막 절에서,
 * 마지막 이동 낱말 바로 앞 낱말 (조사 뺌)
 */
function calledName(text: string, options: ScreenGraphOptions): string | null {
	const clauses = text.split(new RegExp(`(?:${options.conditionWords}|후)\\s+`));
	const last = clauses[clauses.length - 1] ?? '';
	const all = [...last.matchAll(new RegExp(`(\\S+?)(?:으로|로|를|을)?\\s*(?:${options.moveWords})`, 'g'))];
	const name = all[all.length - 1]?.[1]?.trim() ?? '';
	return name === '' ? null : name;
}

type Target =
	| { ok: true; to: string; how: ScreenEdge['how']; name: string; derived: { to: string; condition: string }[] }
	| { ok: false; reason: string; name: string | null; candidates: { id: string; score: number }[]; stays?: true };

/**
 * 가족(바탕이 같은 화면들) 안에서 고르기: 조건이나 이름이 "결과 없음"을 말하면 그 상태 화면, 아니면 그 상태가 아닌 화면.
 * 고를 화면이 하나가 아니면 null
 */
function pickInFamily(
	family: readonly GraphScreen[],
	want: string,
	options: ScreenGraphOptions
): { to: string; derived: { to: string; condition: string }[] } | null {
	const noResult = new RegExp(options.noResultWords);
	const stateOf = (x: GraphScreen): string | null => (x.title === null ? null : splitTitle(x.title, options).state);
	const empty = family.filter((x) => noResult.test(stateOf(x) ?? ''));
	const plain = family.filter((x) => !empty.includes(x));
	const wantEmpty = noResult.test(want);
	const pool = wantEmpty ? empty : plain;
	if (pool.length !== 1) return null;
	const to = (pool[0] as GraphScreen).screenId;
	const derived = wantEmpty
		? []
		: empty.map((x) => ({ to: x.screenId, condition: stateOf(x) ?? '' })).filter((d) => d.to !== to);
	return { to, derived };
}

function resolveTarget(
	text: string,
	from: GraphScreen,
	screens: readonly GraphScreen[],
	condition: string | null,
	options: ScreenGraphOptions
): Target {
	const raw = placeName(text, options);
	if (raw === null) return resolveCalled(text, from, screens, options);
	const name = withoutModifiers(raw, options);
	const want = `${condition ?? ''} ${name}`;
	// 이 화면도 함께 본다: 결과 없음 화면에서 "검색 결과 페이지로 이동"은 이 화면이 아닌 같은 가족 화면이다
	const scored = screens
		.map((x) => ({
			id: x.screenId,
			score: Math.max(0, ...screenNames(x, options).map((n) => screenNameScore(name, n, options)))
		}))
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	const [first, second] = scored;
	const byId = new Map(screens.map((x) => [x.screenId, x]));
	const baseOf = (x: GraphScreen): string => (x.title === null ? '' : squash(splitTitle(x.title, options).base));
	const familyOf = (id: string): GraphScreen[] => {
		const b = baseOf(byId.get(id) as GraphScreen);
		return b === '' ? [] : screens.filter((x) => baseOf(x) === b);
	};
	if (first !== undefined && first.score >= options.minNameScore) {
		if (second !== undefined && first.score - second.score < options.nameMargin) {
			// 같은 가족끼리 비기면 가족 안에서 조건으로
			const fam = familyOf(first.id);
			if (fam.some((x) => x.screenId === second.id)) {
				const pick = pickInFamily(fam, want, options);
				if (pick !== null && pick.to !== from.screenId) return { ok: true, how: 'name', name, ...pick };
			}
			return {
				ok: false,
				reason: `"${name}" 화면을 하나로 정할 수 없음 (${first.id} ${first.score.toFixed(2)}, ${second.id} ${second.score.toFixed(2)})`,
				name,
				candidates: scored.slice(0, 3).map((x) => ({ id: x.id, score: round2(x.score) }))
			};
		}
		// 이름이 가족 중 한 화면 제목에 맞아도("검색 결과" ⊂ "검색 완료 - 검색 결과 없음") 가족 안에서 조건으로 다시 고른다
		const fam = familyOf(first.id);
		const pick = fam.length > 1 ? pickInFamily(fam, want, options) : null;
		const to = pick?.to ?? first.id;
		if (to === from.screenId) {
			return { ok: false, reason: `"${name}"은 이 화면 (화면 전환 아님)`, name, candidates: [], stays: true };
		}
		return { ok: true, to, how: 'name', name, derived: pick?.derived ?? [] };
	}
	// 제목과 다른 말: 이름 낱말이 바탕 낱말과 겹치는 비율로 가족을 고른다 (한 가족만 겹칠 때)
	const nameWords = wordsOf(name);
	const families = new Map<string, { score: number; members: GraphScreen[] }>();
	for (const x of screens) {
		if (x.title === null) continue;
		const key = baseOf(x);
		const baseWords = wordsOf(splitTitle(x.title, options).base);
		const shared = nameWords.filter((w) => baseWords.includes(w)).length;
		const score = nameWords.length === 0 ? 0 : shared / nameWords.length;
		const f = families.get(key) ?? { score, members: [] };
		f.members.push(x);
		families.set(key, f);
	}
	const fams = [...families.values()].filter((f) => f.score > 0).sort((a, b) => b.score - a.score);
	const top = fams[0];
	const diag = {
		name,
		candidates: scored.slice(0, 3).map((x) => ({ id: x.id, score: round2(x.score) }))
	};
	if (top === undefined || top.score < options.minFamilyScore) {
		return { ok: false, reason: `"${name}"과 이름이 맞는 화면이 없음`, ...diag };
	}
	if ((fams[1]?.score ?? 0) >= top.score) {
		return { ok: false, reason: `"${name}" 화면을 하나로 정할 수 없음 (가족 둘 이상)`, ...diag };
	}
	const pick = pickInFamily(top.members, want, options);
	if (pick === null || pick.to === from.screenId) {
		return { ok: false, reason: `"${name}" 가족 안에서 화면을 정할 수 없음`, ...diag };
	}
	return { ok: true, how: 'family', name, ...pick };
}

/** "VKB 호출": 부른 요소 이름(줄임말 포함)이 제목에 든 화면 (닫힘 상태 제외). 이 화면이면 이동이 아님 */
function resolveCalled(
	text: string,
	from: GraphScreen,
	screens: readonly GraphScreen[],
	options: ScreenGraphOptions
): Target {
	const called = calledName(text, options);
	if (called === null) return { ok: false, reason: '이동할 화면 이름을 찾지 못함', name: null, candidates: [] };
	const names = aliasNames(called, options).map(squash);
	const closed = new RegExp(options.closedWords);
	const hits = screens.filter((x) => {
		if (x.title === null) return false;
		const t = squash(x.title);
		const state = splitTitle(x.title, options).state ?? '';
		return names.some((n) => t.includes(n)) && !closed.test(state);
	});
	if (hits.some((x) => x.screenId === from.screenId)) {
		return {
			ok: false,
			reason: '부른 요소가 이 화면 안에 있음 (화면 전환 아님)',
			name: called,
			candidates: [],
			stays: true
		};
	}
	if (hits.length === 1) {
		return { ok: true, to: (hits[0] as GraphScreen).screenId, how: 'element', name: called, derived: [] };
	}
	return {
		ok: false,
		reason: hits.length === 0 ? '이동할 화면 이름을 찾지 못함' : '부른 요소가 든 화면을 하나로 정할 수 없음',
		name: called,
		candidates: hits.map((x) => ({ id: x.screenId, score: 1 }))
	};
}

export interface ScreenGraph {
	/** 화면설계서 화면 (번호·제목) */
	screens: { id: string; title: string | null }[];
	edges: ScreenEdge[];
	unresolved: UnresolvedMove[];
	references: ScreenReference[];
}

/** 괄호 안 참고가 번호로 가리키는 아는 화면 */
function referencedScreens(text: string, known: ReadonlySet<string>, options: ScreenGraphOptions): string[] {
	const ref = new RegExp(options.referenceWords);
	const out: string[] = [];
	for (const m of text.matchAll(/\(([^()]*)\)/g)) {
		const inner = m[1] ?? '';
		if (!ref.test(inner)) continue;
		for (const id of numberedScreens(inner, known)) if (!out.includes(id)) out.push(id);
	}
	return out;
}

export function buildScreenGraph(
	screens: readonly GraphScreen[],
	options: ScreenGraphOptions = DEFAULT_SCREEN_GRAPH_OPTIONS
): ScreenGraph {
	const known = new Set(screens.map((s) => s.screenId));
	const edges: ScreenEdge[] = [];
	const unresolved: UnresolvedMove[] = [];
	const references: ScreenReference[] = [];
	const byId = new Map(screens.map((s) => [s.screenId, s]));
	const selectRe = new RegExp(options.selectSection);
	const moveRe = new RegExp(options.moveWords);
	const submitRe = new RegExp(options.submitWords);
	const typedRe = new RegExp(options.typedWords);
	for (const s of screens) {
		for (const c of s.callouts) {
			for (const sec of c.sections) {
				for (const raw of sec.items) {
					for (const to of referencedScreens(raw, known, options)) {
						if (to === s.screenId || references.some((r) => r.from === s.screenId && r.to === to)) continue;
						references.push({
							from: s.screenId,
							callout: c.no,
							to,
							condition: byId.get(to)?.entryConditions[0]?.trim() ?? null,
							text: raw.trim()
						});
					}
				}
				if (!selectRe.test(sec.title)) continue;
				let afterKey = false;
				for (const raw of sec.items) {
					if (KEY_LINE.test(raw)) {
						afterKey = true;
						continue;
					}
					// 키 줄 바로 아래 조건 줄("이동한 이력이 있을 경우: …")은 그 키의 설명
					if (afterKey && /:/.test(raw)) continue;
					afterKey = false;
					const text = withoutReferences(raw, options).replace(/\s+/g, ' ').trim();
					if (!moveRe.test(text)) continue;
					const base = { from: s.screenId, callout: c.no, text: raw.trim() };
					const action: EdgeAction = submitRe.test(text) ? 'submit' : 'select';
					const condition = conditionOf(text, options);
					const typed = typedRe.test(text);
					const edge = { ...base, action, typed, derived: false };
					const byNumber = numberedScreens(text, known).filter((id) => id !== s.screenId);
					if (byNumber.length === 1) {
						edges.push({ ...edge, to: byNumber[0] ?? '', condition, how: 'number', name: null });
						continue;
					}
					const target = resolveTarget(text, s, screens, condition, options);
					if (!target.ok) {
						unresolved.push({
							...base,
							reason: target.reason,
							name: target.name,
							candidates: target.candidates
						});
						continue;
					}
					edges.push({ ...edge, to: target.to, condition, how: target.how, name: target.name });
					for (const d of target.derived) {
						if (d.to === s.screenId) continue;
						if (edges.some((e) => e.from === s.screenId && e.callout === c.no && e.to === d.to)) continue;
						edges.push({
							...edge,
							to: d.to,
							condition: d.condition,
							how: target.how,
							name: target.name,
							derived: true
						});
					}
				}
			}
		}
	}
	return { screens: screens.map((s) => ({ id: s.screenId, title: s.title })), edges, unresolved, references };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
