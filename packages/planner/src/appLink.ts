import { area, iou } from '@auto-qa/core';
import type { Rect } from '@auto-qa/core';
import { childrenOf, isAncestorNode, nodeTexts } from '@auto-qa/focus';
import type { DomNode, DomSnapshot } from '@auto-qa/focus';
import { meaningful, normalizeLabel, textSimilarity } from '@auto-qa/spec';
import type { NavCallout, NavScreen } from './keymap';

/**
 * 화면설계서 콜아웃 ↔ 앱 요소 자동 연결 (D-043 ③, D-024·D-032). 규칙 기반·결정적이다.
 * 목업 글자·위치(화면 좌표)와 앱 화면 요소(글자·위치·포커스 가능 여부)를 비교해 콜아웃마다 앱 요소 하나와 선택자를 고른다.
 * 점수 차가 작으면 "애매함"으로 표시하고 다음 후보를 함께 준다 (로컬 AI가 후보 중에서 고르거나 사람이 확인, D-045).
 * 사람이 적은 프로필 대응은 채점 정답으로만 쓴다.
 */

export interface AppLinkOptions {
	/** 점수 가중치: 글자 F1, 겹침(IoU), 근접도, 포커스(키 동작이 적힌 콜아웃인데 안에 포커스 가능한 요소가 있는가) */
	weights: { text: number; iou: number; near: number; focus: number };
	/** 글자가 같다고 볼 유사도 (2글자 묶음 Dice) */
	textMatch: number;
	/** 이 점수보다 낮으면 "앱에서 찾지 못함" */
	minScore: number;
	/** 1·2위 점수 차가 이보다 작으면 애매함 */
	ambiguityMargin: number;
	/** 화면 넓이의 이 비율보다 큰 요소(배경·패널 전체)는 후보에서 뺀다 */
	maxAreaRatio: number;
	/** 이보다 작은 요소(넓이 px²)는 뺀다 */
	minArea: number;
	/** 조상·자손 사이에서 겹침이 이 이상이면 같은 상자로 본다 (감싸기만 하는 요소) */
	sameBoxIou: number;
	/** 근접도: 이 거리(화면 대각선 비율) 밖이면 0 */
	reachRatio: number;
	/** 위치 근거로 겹침을 쓰는 최소 겹침 */
	minGeometryIou: number;
	/** 겹침이 그보다 작을 때 근접만으로 위치 근거를 주는 최소 근접도 (작은 버튼) */
	minNearOnly: number;
	/** 함께 줄 다음 후보 수 */
	alternatives: number;
	/** 형제 묶음·목록 항목으로 볼 최소 개수 */
	minGroup: number;
	/**
	 * 선택자·묶음에 쓰지 않는 상태 클래스 (포커스·선택에 따라 붙었다 떨어짐): "selected", "Switch_selected",
	 * "categoryBtnActive"(낙타 표기 끝), Enact가 붙이는 "spottable-next-down"
	 */
	stateClass: RegExp;
	/** 좁히기(포커스 영역·목록 묶음)를 해 볼 상위 후보 수 */
	refineTop: number;
	/**
	 * 콜아웃 이름이 영역·목록을 뜻하는 낱말 (정규식 원문, "카테고리 필터 영역"). 목업 표시가 첫 항목만 가리켜도
	 * 같은 항목이 나란히 있으면 목록으로 넓힌다
	 */
	areaWords: string;
	/** 목록으로 넓힌 뒤, 같은 항목만 담은 포커스 묶음(data-spotlight-container·spotlight id)까지 올라가 볼 단계 수 */
	containerLift: number;
	/** 목록으로 넓힐 때 넓힌 요소가 화면 넓이의 이 비율 이하일 때만 (결과 격자처럼 큰 목록은 되지만 화면 전체는 안 됨) */
	maxLiftAreaRatio: number;
	/** 다시 그릴 때 번호가 바뀌는 이름 (예: container-12) */
	counterName: RegExp;
}

export const DEFAULT_APP_LINK_OPTIONS: AppLinkOptions = {
	weights: { text: 0.45, iou: 0.3, near: 0.1, focus: 0.15 },
	textMatch: 0.7,
	minScore: 0.3,
	ambiguityMargin: 0.05,
	maxAreaRatio: 0.6,
	minArea: 64,
	sameBoxIou: 0.8,
	reachRatio: 0.25,
	minGeometryIou: 0.1,
	minNearOnly: 0.85,
	alternatives: 3,
	minGroup: 2,
	refineTop: 30,
	areaWords: '영역|목록|리스트|탭|area|list|tabs?$',
	containerLift: 4,
	maxLiftAreaRatio: 0.9,
	stateClass:
		/(^|[_-])(focus(ed)?|selected|active|pressed|hover(ed)?|checked|disabled|on|off)([_-]|$)|[a-z](Focus(ed)?|Selected|Active|Pressed|Hover(ed)?|Checked|Disabled)$|^spottable-next-/,
	counterName: /(^|[-_])\d+$/
};

export interface AppLinkCandidate {
	/** 스냅숏 안 순번 (형제 묶음이면 첫 요소) */
	node: number;
	/** 요소들: 하나, 또는 감싸는 요소 없이 나란히 놓인 형제 묶음(같은 태그·클래스의 항목들) */
	nodes: number[];
	score: number;
	/** 점수 근거 */
	text: number;
	overlap: number;
	near: number;
	focus: number | null;
	/** 요소 글자 (앞 몇 개) */
	texts: string[];
	rect: Rect;
	/** 점수를 받은 요소에서 좁히거나 넓힌 경우 그 설명 (예: "포커스 영역으로 좁힘") */
	refined?: string;
}

export interface AppCalloutLink {
	no: string;
	name: string | null;
	/** 고른 요소 (기준 점수 미만이면 null) */
	best: AppLinkCandidate | null;
	/** 고른 요소와 같은 상자로 보는 후보들 (조상·자손, 형제 묶음과 그것을 꼭 맞게 감싼 요소). 선택자는 이 중 가장 안정적인 것으로 */
	sameBox: AppLinkCandidate[];
	selector: SelectorProposal | null;
	/** 1·2위 점수 차가 작음 → AI가 후보 중에서 고르거나 사람 확인 */
	ambiguous: boolean;
	alternatives: AppLinkCandidate[];
	reason: string;
}

export interface SelectorProposal {
	/** 선택자를 붙인 요소 (sameBox 중 하나, 형제 묶음이면 첫 요소) */
	node: number;
	/** 선택자가 가리키는 요소 수 (형제 묶음이면 여럿) */
	count: number;
	selector: string;
	/** 안의 목록 항목 선택자 (같은 클래스의 포커스 가능 요소가 여럿이면) */
	items?: string;
	/** 스냅숏 안에서 이 요소 하나만 맞는가 */
	unique: boolean;
	/** 번호가 바뀌는 이름·해시가 아닌 이름만 썼는가 */
	stable: boolean;
}

export interface AppScreenLink {
	screenId: string | null;
	callouts: AppCalloutLink[];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** 두 사각형 사이 거리 (겹치면 0) */
/** 포커스 항목: 포커스 가능하고 포커스 묶음(spotlight container) 자신이 아닌 요소 */
export const isItem = (n: DomNode | undefined): boolean => n !== undefined && n.focusable && !n.container;

const screenAreaOf = (snapshot: DomSnapshot): number => snapshot.viewport.width * snapshot.viewport.height;

function gap(a: Rect, b: Rect): number {
	const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
	const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
	return Math.hypot(dx, dy);
}

/** 글자 F1 (spec/link.ts와 같은 뜻): 요소 글자 중 찾는 글자 비율 × 찾는 글자 중 요소에 있는 비율 */
function textF1(wanted: readonly string[], texts: readonly string[], threshold: number): number {
	if (wanted.length === 0 || texts.length === 0) return 0;
	const hit = (a: string, list: readonly string[]): boolean => list.some((b) => textSimilarity(a, b) >= threshold);
	const precision = texts.filter((t) => hit(t, wanted)).length / texts.length;
	const recall = wanted.filter((w) => hit(w, texts)).length / wanted.length;
	return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

const hasKeys = (c: NavCallout): boolean => Object.keys(c.keys).length > 0;

/** 사각형들을 감싸는 사각형 */
export function unionRect(rects: readonly Rect[]): Rect {
	const x = Math.min(...rects.map((r) => r.x));
	const y = Math.min(...rects.map((r) => r.y));
	const right = Math.max(...rects.map((r) => r.x + r.width));
	const bottom = Math.max(...rects.map((r) => r.y + r.height));
	return { x, y, width: right - x, height: bottom - y };
}

/** 선택자·묶음에 쓸 수 있는 클래스 (상태·번호 클래스 제외) */
function stableClasses(n: DomNode, options: AppLinkOptions): string[] {
	return n.classes.filter((k) => !options.stateClass.test(k) && !options.counterName.test(k) && cssName(k) !== null);
}

/**
 * 감싸는 요소 없이 나란히 놓인 형제 묶음 (목록 항목): 같은 부모 아래 같은 태그·같은 클래스를 가진 형제들.
 * 클래스마다 따로 묶는다 ("nav-item"은 검색어·카드 모두, "search-chip"은 검색어만) — 어느 묶음이 콜아웃에 맞는지는 점수가 정한다
 */
export function siblingGroups(
	snapshot: DomSnapshot,
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS,
	children = childrenOf(snapshot)
): number[][] {
	const out: number[][] = [];
	const seen = new Set<string>();
	for (const kids of children) {
		const byKey = new Map<string, number[]>();
		for (const k of kids) {
			const n = snapshot.nodes[k];
			if (n === undefined) continue;
			for (const c of stableClasses(n, options)) {
				const key = `${n.tag}.${c}`;
				byKey.set(key, [...(byKey.get(key) ?? []), k]);
			}
		}
		for (const members of byKey.values()) {
			const id = members.join(',');
			if (members.length < options.minGroup || seen.has(id)) continue;
			seen.add(id);
			out.push(members);
		}
	}
	return out;
}

/** 콜아웃 하나 → 앱 요소 후보 (점수순). 요소 하나씩과 형제 묶음을 함께 본다 */
export function rankAppElements(
	callout: NavCallout,
	snapshot: DomSnapshot,
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS,
	cache: SnapshotCache = snapshotCache(snapshot, options)
): AppLinkCandidate[] {
	const wanted = meaningful(callout.texts, 2);
	const label = meaningful(callout.names.map(normalizeLabel), 2);
	const screenArea = snapshot.viewport.width * snapshot.viewport.height;
	const reach = Math.hypot(snapshot.viewport.width, snapshot.viewport.height) * options.reachRatio;
	const w = options.weights;
	const wantFocus = hasKeys(callout);
	const rect = callout.rect;
	// 1) 후보마다 근거(글자·겹침·근접·포커스)를 재고 2) 점수를 낸다. 목업 글자가 화면 어디에도 없으면(예시 데이터·자리표시)
	// 글자는 근거가 되지 못하므로 위치·포커스로만 본다
	const feats: Omit<AppLinkCandidate, 'score'>[] = [];
	const consider = (nodes: number[], box: Rect, texts: string[], focusables: number): void => {
		const a = area(box);
		if (a < options.minArea || a > screenArea * options.maxAreaRatio) return;
		const overlap = rect === null ? 0 : iou(rect, box);
		const near = rect === null ? 0 : Math.max(0, 1 - gap(rect, box) / reach);
		const focus = wantFocus ? (focusables > 0 ? 1 : 0) : null;
		const text = textF1(wanted.length > 0 ? wanted : label, texts, options.textMatch);
		feats.push({
			node: nodes[0] ?? -1,
			nodes,
			text: round3(text),
			overlap: round3(overlap),
			near: round3(near),
			focus,
			texts: texts.slice(0, 5),
			rect: box
		});
	};
	for (const n of snapshot.nodes) consider([n.i], n.rect, cache.texts(n.i), cache.focusables[n.i] ?? 0);
	for (const g of cache.groups) {
		const rects = g.map((k) => snapshot.nodes[k]?.rect).filter((r): r is Rect => r !== undefined);
		consider(
			g,
			unionRect(rects),
			g.flatMap((k) => cache.texts(k)),
			g.reduce((sum, k) => sum + (cache.focusables[k] ?? 0), 0)
		);
	}
	const textEvidence = feats.some((f) => f.text > 0);
	const out: AppLinkCandidate[] = [];
	for (const f of feats) {
		const focusPart = f.focus === null ? 0 : f.focus * w.focus;
		const focusWeight = f.focus === null ? 0 : w.focus;
		const geoWeight = rect === null ? 0 : w.iou + w.near;
		// 위치 근거: 겹치면 겹침·근접, 겹침이 작으면 아주 가까울 때만 근접으로 (작은 버튼은 목업 위치가 조금만 어긋나도 안 겹친다)
		const geoPart =
			rect === null
				? 0
				: f.overlap >= options.minGeometryIou
					? f.overlap * w.iou + f.near * w.near
					: f.near >= options.minNearOnly
						? f.near * w.near
						: 0;
		let score: number;
		if (textEvidence && wanted.length > 0) {
			score = (f.text * w.text + geoPart + focusPart) / (w.text + geoWeight + focusWeight);
		} else {
			// 글자 근거 없음(목업 글자 없음·화면에 없음): 위치로만. 이름이 화면 글자와 맞으면 가점
			const geometry = geoPart > 0 ? (geoPart + focusPart) / (geoWeight + focusWeight) : 0;
			const named = f.text > 0 ? (f.text * w.text + geoPart + focusPart) / (w.text + geoWeight + focusWeight) : 0;
			score = Math.max(geometry, named);
		}
		if (score > 0) out.push({ ...f, score: round3(score) });
	}
	return out.sort(
		(x, y) => y.score - x.score || area(x.rect) - area(y.rect) || x.nodes.length - y.nodes.length || x.node - y.node
	);
}

export interface SnapshotCache {
	children: number[][];
	focusables: number[];
	/** 형제 묶음 (siblingGroups) */
	groups: number[][];
	texts(i: number): string[];
}

/** 같은 스냅숏으로 콜아웃 여러 개를 볼 때 한 번만 계산 */
export function snapshotCache(
	snapshot: DomSnapshot,
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS
): SnapshotCache {
	const children = childrenOf(snapshot);
	// 포커스 항목 수: 포커스 묶음(spotlight container) 자신은 항목이 아니다 (Enact 묶음은 tabindex가 있어 포커스 가능으로 읽힌다)
	const focusables = snapshot.nodes.map(() => 0);
	for (let k = snapshot.nodes.length - 1; k >= 0; k--) {
		let sum = isItem(snapshot.nodes[k]) ? 1 : 0;
		for (const c of children[k] ?? []) sum += focusables[c] ?? 0;
		focusables[k] = sum;
	}
	const groups = siblingGroups(snapshot, options, children);
	const memo = new Map<number, string[]>();
	return {
		children,
		focusables,
		groups,
		texts(i) {
			let t = memo.get(i);
			if (t === undefined) {
				t = meaningful(nodeTexts(snapshot, i, 60, children), 2);
				memo.set(i, t);
			}
			return t;
		}
	};
}

/** a와 b가 같은 상자인가: 같거나, 조상·자손이면서 겹침이 기준 이상 */
export function sameBox(snapshot: DomSnapshot, a: number, b: number, minIou: number): boolean {
	if (a === b) return true;
	const ra = snapshot.nodes[a]?.rect;
	const rb = snapshot.nodes[b]?.rect;
	if (ra === undefined || rb === undefined) return false;
	if (!isAncestorNode(snapshot, a, b) && !isAncestorNode(snapshot, b, a)) return false;
	return iou(ra, rb) >= minIou;
}

const selfOrAncestor = (snapshot: DomSnapshot, a: number, b: number): boolean =>
	a === b || isAncestorNode(snapshot, a, b);

/**
 * 후보 둘이 같은 상자인가: 겹침이 기준 이상이고, 한쪽 요소가 다른 쪽 요소를 감싸거나 같다
 * (감싸기만 하는 요소, 형제 묶음과 그것을 꼭 맞게 감싼 요소)
 */
export function sameCandidateBox(
	snapshot: DomSnapshot,
	a: Pick<AppLinkCandidate, 'nodes' | 'rect'>,
	b: Pick<AppLinkCandidate, 'nodes' | 'rect'>,
	minIou: number
): boolean {
	if (iou(a.rect, b.rect) < minIou) return false;
	const covers = (x: readonly number[], y: readonly number[]): boolean =>
		y.every((j) => x.some((i) => selfOrAncestor(snapshot, i, j)));
	return covers(a.nodes, b.nodes) || covers(b.nodes, a.nodes);
}

/** 화면 하나의 콜아웃 전체 */
export function linkScreenToApp(
	nav: NavScreen,
	snapshot: DomSnapshot,
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS
): AppScreenLink {
	const cache = snapshotCache(snapshot, options);
	return {
		screenId: nav.screenId,
		callouts: nav.callouts.map((c) => linkCalloutToApp(c, snapshot, options, cache))
	};
}

export function linkCalloutToApp(
	callout: NavCallout,
	snapshot: DomSnapshot,
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS,
	cache: SnapshotCache = snapshotCache(snapshot, options)
): AppCalloutLink {
	const name = callout.names[0] ?? null;
	// 키 동작이 적힌 콜아웃은 포커스를 받는 곳이다 → 안에 포커스 가능한 요소가 없는 후보(제목 글자 등)는 뺀다
	const wantFocus = hasKeys(callout);
	const scored = rankAppElements(callout, snapshot, options, cache).filter((c) => !wantFocus || c.focus === 1);
	// 상위 후보를 포커스 영역·목록 묶음으로 좁히거나 넓힌 뒤, 같은 상자가 된 것은 하나로 (점수 높은 것 먼저)
	const same = (a: AppLinkCandidate, b: AppLinkCandidate): boolean =>
		sameCandidateBox(snapshot, a, b, options.sameBoxIou);
	const ranked: AppLinkCandidate[] = [];
	for (const c of scored.slice(0, options.refineTop)) {
		const r = refineCandidate(snapshot, cache, callout, c, scored, options);
		if (!ranked.some((x) => x.nodes.join() === r.nodes.join())) ranked.push(r);
	}
	ranked.push(...scored.slice(options.refineTop));
	// 1위와 거의 같은 점수의 후보들이 한 요소 안에 모두 들어 있으면(버튼 셋과 그 줄) 그 요소가 콜아웃 영역이다
	const top = ranked[0];
	if (top !== undefined) {
		const limit = screenAreaOf(snapshot) * options.maxAreaRatio;
		const tied = ranked.filter((x) => top.score - x.score < options.ambiguityMargin && area(x.rect) <= limit);
		const covers = (x: AppLinkCandidate, y: AppLinkCandidate): boolean =>
			y.nodes.every((j) => x.nodes.some((i) => selfOrAncestor(snapshot, i, j)));
		const outer =
			tied.length > 1 && tied.includes(top) ? tied.find((x) => tied.every((y) => covers(x, y))) : undefined;
		if (outer !== undefined && outer !== top) {
			ranked.splice(ranked.indexOf(outer), 1);
			ranked.unshift({
				...outer,
				refined: [outer.refined, '같은 점수 후보를 모두 담은 요소'].filter(Boolean).join(', ')
			});
		}
	}
	const best = ranked[0];
	if (best === undefined || best.score < options.minScore) {
		return {
			no: callout.no,
			name,
			best: null,
			sameBox: [],
			selector: null,
			ambiguous: false,
			alternatives: ranked.slice(0, options.alternatives),
			reason: `앱 화면에서 맞는 요소를 찾지 못함 (최고 점수 ${best?.score ?? 0})`
		};
	}
	const group = [best, ...scored.filter((x) => x.nodes.join() !== best.nodes.join() && same(best, x))];
	const others = ranked.filter((x) => x !== best && !same(best, x));
	// 다음 후보는 서로 다른 상자만 (같은 상자를 감싼 요소가 줄줄이 나오지 않게)
	const alternatives: AppLinkCandidate[] = [];
	for (const x of others) {
		if (alternatives.length >= options.alternatives) break;
		if (alternatives.some((y) => same(x, y))) continue;
		alternatives.push(x);
	}
	// 고른 요소 안에 든 후보(항목·부품)는 경쟁 후보가 아니다
	const inside = (x: AppLinkCandidate): boolean =>
		x.nodes.every((j) => best.nodes.some((i) => selfOrAncestor(snapshot, i, j)));
	const second = alternatives.find((x) => !inside(x));
	const ambiguous = second !== undefined && best.score - second.score < options.ambiguityMargin;
	const selector = chooseSelector(snapshot, group, options);
	const why = [
		`점수 ${best.score}`,
		`글자 ${best.text}`,
		callout.rect === null ? '위치 없음' : `겹침 ${best.overlap}`,
		best.focus === null ? null : best.focus > 0 ? '포커스 가능 요소 있음' : '포커스 가능 요소 없음',
		best.refined ?? null,
		ambiguous ? `2위와 차이 ${round3(best.score - (second?.score ?? 0))} → 애매함` : null
	].filter((x): x is string => x !== null);
	return {
		no: callout.no,
		name,
		best,
		sameBox: group,
		selector,
		ambiguous,
		alternatives,
		reason: why.join(', ')
	};
}

/**
 * 안에 든 포커스 가능 요소를 모두 담는 가장 작은 자손 (감싸기만 하는 요소를 지나 내려간다).
 * 요소 자신이 포커스 가능하면 거기서 멈춘다 (그 안은 항목의 부품)
 */
export function focusContainer(snapshot: DomSnapshot, cache: SnapshotCache, node: number): number {
	let cur = node;
	for (;;) {
		const total = cache.focusables[cur] ?? 0;
		if (total === 0 || isItem(snapshot.nodes[cur])) return cur;
		const kids = (cache.children[cur] ?? []).filter((k) => (cache.focusables[k] ?? 0) > 0);
		const only = kids[0];
		if (kids.length !== 1 || only === undefined || (cache.focusables[only] ?? 0) !== total) return cur;
		cur = only;
	}
}

/**
 * 목록 묶음: 항목들의 부모에서 몇 단계 위까지, 같은 포커스 가능 요소만 담은 포커스 묶음(data-spotlight-container 또는
 * spotlight id가 있는 요소)이 있으면 그것 (Enact 목록은 스크롤 안쪽 줄을 감싼 묶음에 이름이 붙는다). 없으면 부모
 */
function listContainer(snapshot: DomSnapshot, cache: SnapshotCache, parent: number, options: AppLinkOptions): number {
	const want = cache.focusables[parent] ?? 0;
	let cur = parent;
	for (let k = 0; k <= options.containerLift && cur >= 0; k++) {
		const n = snapshot.nodes[cur];
		if (n === undefined || (cache.focusables[cur] ?? 0) !== want) break;
		if (n.container || (n.spotlightId !== null && !options.counterName.test(n.spotlightId))) return cur;
		cur = n.parent;
	}
	return parent;
}

/**
 * 점수를 받은 요소를 콜아웃이 가리키는 대상으로 좁히거나 넓힌다 (프로필 대응의 관례: 콜아웃 = 포커스 영역 또는 목록 묶음).
 * 1) 포커스 가능 요소를 담은 요소 → 그것들을 모두 담는 가장 작은 자손 (제목+목록 섹션 → 목록, 헤더 영역 → 버튼)
 * 2) 목록 항목 하나(또는 그 안 부품) → 콜아웃 위치가 항목 하나보다 항목 줄 전체에 더 맞으면 목록(항목들의 부모)
 */
function refineCandidate(
	snapshot: DomSnapshot,
	cache: SnapshotCache,
	callout: NavCallout,
	c: AppLinkCandidate,
	scored: readonly AppLinkCandidate[],
	options: AppLinkOptions
): AppLinkCandidate {
	if (c.nodes.length !== 1) return c;
	let node = c.node;
	const notes: string[] = [];
	const inner = focusContainer(snapshot, cache, node);
	if (inner !== node) {
		node = inner;
		notes.push('포커스 영역으로 좁힘');
	}
	// 포커스 가능 요소들을 담은 요소 → 같은 것만 담은 포커스 묶음(spotlight container·id)이 조금 위에 있으면 그것
	if (!isItem(snapshot.nodes[node]) && (cache.focusables[node] ?? 0) > 0) {
		const up = listContainer(snapshot, cache, node, options);
		const upRect = snapshot.nodes[up]?.rect;
		if (up !== node && upRect !== undefined && area(upRect) <= screenAreaOf(snapshot) * options.maxLiftAreaRatio) {
			node = up;
			notes.push('포커스 묶음으로 넓힘');
		}
	}
	// 가장 가까운 포커스 가능 요소 (자신 또는 두 단계 위까지)
	let item = node;
	for (let k = 0; k < 2 && item >= 0 && !isItem(snapshot.nodes[item]); k++) {
		item = snapshot.nodes[item]?.parent ?? -1;
	}
	const itemNode = snapshot.nodes[item];
	if (itemNode !== undefined && isItem(itemNode) && itemNode.parent >= 0 && callout.rect !== null) {
		const rect = callout.rect;
		// 같은 항목: 같은 부모 아래 태그·안정 클래스(상태 클래스 제외)가 모두 같은 형제 ("nav-item"만 같은 다른 버튼은 아님)
		const sig = (n: DomNode): string => `${n.tag}|${stableClasses(n, options).sort().join(' ')}`;
		const mine = sig(itemNode);
		const sameItem = (m: number): boolean => {
			const n = snapshot.nodes[m];
			return n !== undefined && stableClasses(n, options).length > 0 && sig(n) === mine;
		};
		// 항목 칸: 가상 목록은 항목마다 칸(요소)으로 한 번 더 감싼다 → 포커스 가능 요소 하나만 담은 칸이면 칸끼리 형제를 본다
		const onlyFocusable = (m: number): number | undefined => {
			if ((cache.focusables[m] ?? 0) !== 1) return undefined;
			return snapshot.nodes.find((n) => isItem(n) && (n.i === m || isAncestorNode(snapshot, m, n.i)))?.i;
		};
		let unit = item;
		let group: number[] = [];
		for (let k = 0; k < 2; k++) {
			const parent = snapshot.nodes[unit]?.parent ?? -1;
			if (parent < 0) break;
			const sibs = (cache.children[parent] ?? []).filter((m) => {
				if (k === 0) return sameItem(m);
				const f = onlyFocusable(m);
				return f !== undefined && sameItem(f);
			});
			if (sibs.length >= options.minGroup) {
				group = sibs;
				break;
			}
			if ((cache.focusables[parent] ?? 0) !== 1) break;
			unit = parent;
		}
		const groupParent = snapshot.nodes[group[0] ?? -1]?.parent ?? -1;
		if (group.length >= options.minGroup && groupParent >= 0) {
			const rects = group.map((m) => snapshot.nodes[m]?.rect).filter((r): r is Rect => r !== undefined);
			const whole = iou(rect, unionRect(rects));
			const named = callout.names.some((n) => new RegExp(options.areaWords, 'i').test(n));
			const list = listContainer(snapshot, cache, groupParent, options);
			const listRect = snapshot.nodes[list]?.rect;
			// 항목들을 감싼 요소가 없어 부모가 화면 전체이면 넓히지 않는다 (그때는 형제 묶음 후보가 목록이다)
			const tight = listRect !== undefined && area(listRect) <= screenAreaOf(snapshot) * options.maxLiftAreaRatio;
			if (tight && ((whole >= options.minGeometryIou && whole > iou(rect, itemNode.rect)) || named)) {
				node = list;
				notes.push(
					`항목 ${group.length}개의 목록으로 넓힘${named && whole <= iou(rect, itemNode.rect) ? ' (이름이 영역)' : ''}`
				);
			}
		}
	}
	if (node === c.node) return c;
	const n = snapshot.nodes[node];
	if (n === undefined) return c;
	const known = scored.find((x) => x.nodes.length === 1 && x.node === node);
	return {
		...(known ?? c),
		node,
		nodes: [node],
		score: c.score,
		rect: n.rect,
		texts: known?.texts ?? cache.texts(node).slice(0, 5),
		refined: notes.join(', ')
	};
}

// ── 선택자 ────────────────────────────

/** CSS 이름에 쓸 수 없는 글자는 뺀다 (숫자로 시작하는 이름도 쓰지 않는다) */
function cssName(t: string): string | null {
	return /^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(t) ? t : null;
}

const attrValue = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

interface Part {
	css: string;
	/** 이 조각이 요소에 맞는가 */
	test(n: DomNode): boolean;
	stable: boolean;
}

/** 요소 하나를 가리킬 수 있는 단순 선택자 조각들 (안정적인 것 먼저) */
function partsOf(n: DomNode, options: AppLinkOptions): Part[] {
	const out: Part[] = [];
	const id = n.id === null ? null : cssName(n.id);
	if (id !== null) {
		out.push({ css: `#${id}`, test: (m) => m.id === id, stable: !options.counterName.test(id) });
	}
	const sid = n.spotlightId;
	if (sid !== null) {
		out.push({
			css: `[data-spotlight-id="${attrValue(sid)}"]`,
			test: (m) => m.spotlightId === sid,
			stable: !options.counterName.test(sid)
		});
	}
	for (const c of n.classes) {
		if (options.stateClass.test(c) || cssName(c) === null) continue;
		out.push({ css: `.${c}`, test: (m) => m.classes.includes(c), stable: !options.counterName.test(c) });
	}
	if (n.role !== null && /^[a-z]+$/.test(n.role)) {
		const role = n.role;
		out.push({ css: `[role="${role}"]`, test: (m) => m.role === role, stable: true });
	}
	return out.sort((a, b) => Number(b.stable) - Number(a.stable));
}

/**
 * 같은 상자 후보들 중 그 요소(들)만 정확히 가리키는 가장 짧고 안정적인 선택자.
 * 요소 하나(감싸는 요소)를 형제 묶음보다 먼저 고르고, 안에 같은 클래스의 포커스 가능 항목이 여럿이면 items도 붙인다
 */
export function chooseSelector(
	snapshot: DomSnapshot,
	group: readonly Pick<AppLinkCandidate, 'nodes'>[],
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS
): SelectorProposal | null {
	const proposals: (SelectorProposal & { length: number })[] = [];
	for (const c of group) {
		const p = selectorFor(snapshot, c.nodes, options);
		if (p !== null) proposals.push(p);
	}
	proposals.sort(
		(a, b) =>
			Number(b.unique) - Number(a.unique) ||
			Number(b.stable) - Number(a.stable) ||
			a.count - b.count ||
			a.length - b.length
	);
	const best = proposals[0];
	if (best === undefined) return null;
	const items = best.count === 1 ? itemsSelector(snapshot, best.node, options) : null;
	return {
		node: best.node,
		count: best.count,
		selector: best.selector,
		unique: best.unique,
		stable: best.stable,
		...(items === null ? {} : { items })
	};
}

/**
 * 요소 안 목록 항목: 같은 클래스의 포커스 가능 자손이 여럿이고 그 클래스가 안에서 그 항목들에만 붙어 있으면 그 클래스 선택자.
 * 여럿이면 항목이 많은 것, 같으면 화면 전체에서 덜 쓰인(더 구체적인) 클래스
 */
export function itemsSelector(
	snapshot: DomSnapshot,
	node: number,
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS
): string | null {
	const inside = snapshot.nodes.filter((m) => isAncestorNode(snapshot, node, m.i));
	const byClass = new Map<string, number>();
	for (const m of inside) {
		if (!isItem(m)) continue;
		for (const c of stableClasses(m, options)) byClass.set(c, (byClass.get(c) ?? 0) + 1);
	}
	const usage = (c: string): number => snapshot.nodes.filter((m) => m.classes.includes(c)).length;
	const fits = [...byClass.entries()]
		.filter(([c, n]) => n >= options.minGroup && inside.filter((m) => m.classes.includes(c)).length === n)
		.sort((a, b) => b[1] - a[1] || usage(a[0]) - usage(b[0]) || a[0].localeCompare(b[0]));
	const best = fits[0];
	return best === undefined ? null : `.${best[0]}`;
}

/**
 * 요소(들)의 선택자: 모두에 맞는 자기 조각 하나 → 조각 둘 → 모두를 감싸고 하나만 맞는 조상 아래로 좁히기.
 * 스냅숏 안에서 정확히 그 요소들만 맞아야 unique
 */
export function selectorFor(
	snapshot: DomSnapshot,
	nodes: readonly number[],
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS
): (SelectorProposal & { length: number }) | null {
	const members = nodes.map((k) => snapshot.nodes[k]).filter((m): m is DomNode => m !== undefined);
	const n = members[0];
	if (n === undefined) return null;
	const set = new Set(members.map((m) => m.i));
	const parts = partsOf(n, options).filter((p) => members.every((m) => p.test(m)));
	const exact = (tests: ((m: DomNode) => boolean)[], under: number | null = null): boolean => {
		const hit = snapshot.nodes.filter(
			(m) => tests.every((t) => t(m)) && (under === null || isAncestorNode(snapshot, under, m.i))
		);
		return hit.length === set.size && hit.every((m) => set.has(m.i));
	};
	const unique1 = (q: Part): boolean => snapshot.nodes.filter((m) => q.test(m)).length === 1;
	const make = (css: string, ps: Part[], unique: boolean): SelectorProposal & { length: number } => ({
		node: n.i,
		count: set.size,
		selector: css,
		unique,
		stable: ps.every((p) => p.stable),
		length: ps.length
	});
	for (const p of parts) if (exact([p.test])) return make(p.css, [p], true);
	for (let a = 0; a < parts.length; a++) {
		for (let b = a + 1; b < parts.length; b++) {
			const pa = parts[a] as Part;
			const pb = parts[b] as Part;
			if (exact([pa.test, pb.test])) return make(`${pa.css}${pb.css}`, [pa, pb], true);
		}
	}
	// 모두를 감싸는 조상 중 하나만 맞는 것 아래에서 정확히 맞는가
	for (let p = n.parent; p >= 0; p = snapshot.nodes[p]?.parent ?? -1) {
		const anc = snapshot.nodes[p];
		if (anc === undefined) break;
		if (!members.every((m) => isAncestorNode(snapshot, p, m.i))) continue;
		const own = partsOf(anc, options).find(unique1);
		if (own === undefined) continue;
		for (const q of parts) if (exact([q.test], p)) return make(`${own.css} ${q.css}`, [own, q], true);
		const tag: Part = { css: n.tag, test: (m) => m.tag === n.tag, stable: true };
		if (members.every((m) => m.tag === n.tag) && exact([tag.test], p))
			return make(`${own.css} ${tag.css}`, [own, tag], true);
	}
	const first = parts[0];
	return first === undefined ? null : make(first.css, [first], false);
}
