import type { MergedSpecScreen } from '@auto-qa/spec';
import { containedNameScore } from './expect';
import { DEFAULT_KEYMAP_OPTIONS } from './keymap';
import type { KeyMapOptions } from './keymap';

/**
 * 화면 이동 지도 (D-043 ④ 진입 경로 자동 계산의 입력). 화면설계서 콜아웃의 "선택 시" 문장에서
 * "어느 화면의 어느 콜아웃을 고르면(OK·글자 입력 후 확인) 어느 화면으로 가는지"를 읽는다. 규칙 기반·결정적이다.
 * 대상 화면은 번호("#4.5")나 이름("검색 결과 페이지로 이동" ↔ 화면 제목)으로 찾고, 못 찾으면 이유를 남긴다 (추측하지 않음).
 * "(… 참고)" 괄호는 다른 화면을 가리키는 참고이지 이동이 아니다.
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
	/** 대상 화면을 정한 방법 */
	how: 'number' | 'name';
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
	nameMargin: 0.1
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

/** 화면 이름 (제목, 진입 조건 첫 문장은 쓰지 않음) */
const screenNames = (s: GraphScreen): string[] => (s.title === null ? [] : [s.title]);

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
					const byNumber = numberedScreens(text, known).filter((id) => id !== s.screenId);
					if (byNumber.length === 1) {
						edges.push({ ...base, action, to: byNumber[0] ?? '', condition, how: 'number' });
						continue;
					}
					const name = placeName(text, options);
					if (name === null) {
						unresolved.push({
							...base,
							reason: '이동할 화면 이름을 찾지 못함',
							name: null,
							candidates: []
						});
						continue;
					}
					const scored = screens
						.filter((x) => x.screenId !== s.screenId)
						.map((x) => ({
							id: x.screenId,
							score: Math.max(
								0,
								...screenNames(x).map((n) => containedNameScore(name, n, options.keymap))
							)
						}))
						.sort((a, b) => b.score - a.score);
					const [first, second] = scored;
					const diag = {
						name,
						candidates: scored.slice(0, 3).map((x) => ({ id: x.id, score: round2(x.score) }))
					};
					if (first === undefined || first.score < options.minNameScore) {
						unresolved.push({ ...base, reason: `"${name}"과 이름이 맞는 화면이 없음`, ...diag });
					} else if (second !== undefined && first.score - second.score < options.nameMargin) {
						unresolved.push({
							...base,
							reason: `"${name}" 화면을 하나로 정할 수 없음 (${first.id} ${first.score.toFixed(2)}, ${second.id} ${second.score.toFixed(2)})`,
							...diag
						});
					} else {
						edges.push({ ...base, action, to: first.id, condition, how: 'name' });
					}
				}
			}
		}
	}
	return { screens: screens.map((s) => ({ id: s.screenId, title: s.title })), edges, unresolved, references };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
