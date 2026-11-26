import { area } from '@auto-qa/core';
import type { Rect } from '@auto-qa/core';
import type { ColorSummary, FigmaElement, NormalizedFrame } from './normalize';
import { elementById } from './normalize';
import type { RepeatGroup } from './repeat';
import { matchVisuals, visuals } from './visual';

/**
 * GUI 프레임의 포커스 요소 추정 (설계 7.3, D-010, D-033). GUI 프레임은 포커스 상태 스냅샷이다. 근거 순서:
 * ① 컴포넌트 변형 상태 — 디자이너가 `status=focused` 같은 변형으로 포커스를 표시한 경우
 * ② 형제 대비 — "같은 묶음의 다른 멤버와 다른 점"(확대, 테두리 레이어, 테두리·배경·그림자 변화)
 * ③ 입력 상태 변형(`status=Typing`) — 플랫폼 키보드가 열리면 포커스는 입력창에 남는다. 약한 근거라 항상 확인 필요
 * 차이가 곧 기대 포커스 스타일이다. 점수 가중치·기준·상태 단어는 옵션으로 둔다.
 */

export interface FocusOptions {
	/** 이 이상 커지거나 작아지면 확대로 본다 (0.03 = 3%) */
	scaleThreshold: number;
	/** 후보로 인정할 최소 점수 */
	minScore: number;
	/** 1위와 2위 점수 차가 이보다 작으면 "확인 필요" */
	ambiguityMargin: number;
	weights: {
		scale: number;
		borderLayer: number;
		otherLayer: number;
		/** 다른 멤버에는 있는 큰 레이어(예: 어둡게 덮는 dim)가 이 멤버에만 없음 */
		removedLayer: number;
		/** 멤버를 덮는 큰 색 칠 레이어 추가 (배경 강조) */
		fillLayer: number;
		stroke: number;
		fill: number;
		shadow: number;
		text: number;
	};
	/** 컴포넌트 변형 이름·속성에서 상태를 뜻하는 단어 (대소문자 무시, 낱말 경계로 비교) */
	states: {
		/** 포커스: 있으면 1순위 근거 */
		focus: string[];
		/** 입력 중: 다른 근거가 없을 때만, 확인 필요로 */
		input: string[];
		/** 포커스가 아닌 상태 (현재 메뉴 표시 등): 형제 대비에서 이 상태 때문에 다른 멤버는 후보에서 뺀다 */
		notFocus: string[];
	};
	/** 변형 상태 근거의 점수 */
	variantScore: number;
	inputStateScore: number;
	/** 변형 근거와 다른 곳에 이 점수 이상의 형제 차이가 있으면 근거가 엇갈린 것으로 보고 확인 필요 */
	conflictScore: number;
}

export const DEFAULT_FOCUS_OPTIONS: FocusOptions = {
	scaleThreshold: 0.03,
	minScore: 0.35,
	ambiguityMargin: 0.15,
	weights: {
		scale: 0.45,
		borderLayer: 0.4,
		otherLayer: 0.15,
		removedLayer: 0.4,
		fillLayer: 0.35,
		stroke: 0.35,
		fill: 0.15,
		shadow: 0.15,
		text: 0.1
	},
	states: { focus: ['focused', 'focus'], input: ['typing', 'editing'], notFocus: ['selected', 'dim', 'disabled'] },
	variantScore: 0.9,
	inputStateScore: 0.5,
	conflictScore: 0.6
};

export interface FocusStyle {
	scale: { x: number; y: number } | null;
	border: { color: ColorSummary | null; weight: number | 'mixed' | null } | null;
	fill: ColorSummary | null;
	shadow: boolean;
}

export type FocusSource = 'variant' | 'siblings' | 'input-state';

export interface FocusCandidate {
	/** 근거 종류 (D-033) */
	source: FocusSource;
	/** 형제 대비일 때 반복 묶음 */
	groupId: string | null;
	memberId: string;
	/** 비교 기준이 된 보통 멤버 (변형 근거면 같은 컴포넌트의 포커스 아닌 인스턴스, 없으면 null) */
	typicalId: string | null;
	score: number;
	evidence: string[];
	style: FocusStyle;
}

export interface FocusEstimate {
	primary: FocusCandidate | null;
	/** 1위와 비슷한 점수의 후보가 있어 사람 확인이 필요 */
	ambiguous: boolean;
	candidates: FocusCandidate[];
	skipped: { groupId: string; reason: string }[];
}

const sameColor = (a: ColorSummary | null, b: ColorSummary | null): boolean =>
	(a === null && b === null) || (a !== null && b !== null && a.hex === b.hex && Math.abs(a.alpha - b.alpha) < 0.05);

const strokeKey = (e: FigmaElement): string =>
	e.style.stroke === null ? 'none' : `${e.style.stroke.color?.hex ?? '-'}/${String(e.style.stroke.weight)}`;

interface Diff {
	score: number;
	evidence: string[];
	style: FocusStyle;
}

const ratio3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * member를 typical과 비교한다. 노드 구조가 아니라 보이는 요소끼리 위치로 짝지어 비교하므로,
 * 포커스 카드만 한 번 더 감싸져 있거나 GROUP/FRAME이 섞여 있어도 같은 요소를 비교한다.
 */
function compare(frame: NormalizedFrame, member: FigmaElement, typical: FigmaElement, options: FocusOptions): Diff {
	const w = options.weights;
	const evidence: string[] = [];
	const style: FocusStyle = { scale: null, border: null, fill: null, shadow: false };
	let score = 0;
	const memberArea = area(member.rect);
	const typicalArea = area(typical.rect);
	const { pairs, added, removed } = matchVisuals(visuals(frame, member), visuals(frame, typical), typical.rect);

	// 확대: 멤버 전체 또는 실제로 커진 가장 큰 요소(예: 순번 숫자를 뺀 카드 이미지)
	// 가로·세로가 함께 바뀌어야 확대로 본다 — 한 방향만 바뀌면 내용 길이에 맞춘 크기(예: 글자 길이가 다른 탭)다
	const changed = (a: { width: number; height: number }, b: { width: number; height: number }): boolean =>
		b.width > 0 &&
		b.height > 0 &&
		Math.abs(a.width / b.width - 1) >= options.scaleThreshold &&
		Math.abs(a.height / b.height - 1) >= options.scaleThreshold;
	// 글자 상자는 내용 길이에 따라, 벡터 아이콘은 모양에 따라 크기가 달라지므로 확대 근거로 쓰지 않는다
	const scaled = pairs
		.filter((p) => (p.a.cls === 'image' || p.a.cls === 'fill' || p.a.cls === 'stroke') && changed(p.a.rel, p.b.rel))
		.sort((x, y) => area(y.a.rel) - area(x.a.rel))[0];
	// 멤버 전체 크기 변화는 멤버에 상자(칠·테두리·이미지)가 있을 때만 확대로 본다 — 글자만 있는 멤버는 내용 길이로 폭이 바뀐다
	const boxed = (e: FigmaElement): boolean =>
		visuals(frame, e).some((v) => v.cls === 'image' || v.cls === 'fill' || v.cls === 'stroke');
	const memberScaled = changed(member.rect, typical.rect) && boxed(member) && boxed(typical);
	if (memberScaled || scaled !== undefined) {
		score += w.scale;
		const [a, b] = scaled === undefined ? [member.rect, typical.rect] : [scaled.a.rel, scaled.b.rel];
		style.scale = { x: ratio3(a.width / b.width), y: ratio3(a.height / b.height) };
		const what = scaled === undefined ? '멤버' : `"${scaled.a.element.name}"`;
		evidence.push(`${what} ${b.width}×${b.height} → ${a.width}×${a.height} (×${style.scale.x}, ×${style.scale.y})`);
	}

	const large = (r: Rect, base: number): boolean => base > 0 && area(r) >= base * 0.5;
	let other = false;
	let highlight = false;
	for (const v of added) {
		const e = v.element;
		if (v.cls === 'glyph') continue;
		if (v.cls === 'fill' && large(v.rel, memberArea) && !highlight) {
			highlight = true;
			score += w.fillLayer;
			if (style.fill === null) style.fill = e.style.fill;
			evidence.push(`배경 레이어 추가: "${e.name}" (${e.style.fill?.hex ?? '?'})`);
		} else if (v.cls === 'stroke' && large(v.rel, memberArea) && style.border === null) {
			score += w.borderLayer;
			style.border = { color: e.style.stroke?.color ?? null, weight: e.style.stroke?.weight ?? null };
			evidence.push(
				`테두리 레이어 추가: "${e.name}" (${e.style.stroke?.color?.hex ?? '?'}, ${String(e.style.stroke?.weight ?? '?')}px)`
			);
		} else if (!other) {
			other = true;
			score += w.otherLayer;
			evidence.push(`레이어 추가: "${e.name}" (${v.cls})`);
		}
	}
	const cover = removed.find((v) => (v.cls === 'fill' || v.cls === 'image') && large(v.rel, typicalArea));
	if (cover !== undefined) {
		score += w.removedLayer;
		evidence.push(
			`다른 멤버의 덮개 레이어 없음: "${cover.element.name}" (${cover.element.style.fill?.hex ?? cover.cls})`
		);
	}

	let text = false;
	for (const { a: va, b: vb } of pairs) {
		const e = va.element;
		const t = vb.element;
		const big = large(va.rel, memberArea) || e === member;
		if (strokeKey(e) !== strokeKey(t) && e.style.stroke !== null && big && style.border === null) {
			score += w.stroke;
			style.border = { color: e.style.stroke.color, weight: e.style.stroke.weight };
			evidence.push(`테두리 ${strokeKey(t)} → ${strokeKey(e)} ("${e.name}")`);
		}
		if (va.cls === 'fill' && big && !sameColor(e.style.fill, t.style.fill) && style.fill === null) {
			score += w.fill;
			style.fill = e.style.fill;
			evidence.push(`배경 ${t.style.fill?.hex ?? '없음'} → ${e.style.fill?.hex ?? '없음'} ("${e.name}")`);
		}
		if (e.style.shadow && !t.style.shadow && !style.shadow) {
			score += w.shadow;
			style.shadow = true;
			evidence.push(`그림자 추가 ("${e.name}")`);
		}
		if (
			va.cls === 'text' &&
			!text &&
			(!sameColor(e.text?.color ?? null, t.text?.color ?? null) || e.text?.fontWeight !== t.text?.fontWeight)
		) {
			text = true;
			score += w.text;
			evidence.push(
				`글자 ${t.text?.color?.hex ?? '?'}/${t.text?.fontWeight ?? '?'} → ${e.text?.color?.hex ?? '?'}/${e.text?.fontWeight ?? '?'} ("${e.name}")`
			);
		}
	}
	return { score: Math.min(1, ratio3(score)), evidence, style };
}

function isAncestor(frame: NormalizedFrame, ancestorId: string, id: string): boolean {
	let cur = elementById(frame, id);
	while (cur?.parentId != null) {
		if (cur.parentId === ancestorId) return true;
		cur = elementById(frame, cur.parentId);
	}
	return false;
}

/** 컴포넌트 변형 이름·속성 글자 */
function variantText(e: FigmaElement): string {
	const c = e.component;
	if (c === null) return '';
	const props = Object.entries(c.properties).map(([k, v]) => `${k}=${String(v)}`);
	return [c.name, ...props].join(', ');
}

/** 낱말 경계로 상태 단어 비교: "toggle_focused" ○, "unfocused" × */
function hasState(text: string, words: readonly string[]): boolean {
	if (words.length === 0 || text === '') return false;
	const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(`(^|[^a-z])(${escaped.join('|')})([^a-z]|$)`, 'i').test(text);
}

/** 상태 단어를 가진 보이는 인스턴스 (안쪽에 같은 상태가 또 있으면 바깥 것 하나) */
function stateInstances(frame: NormalizedFrame, words: readonly string[]): FigmaElement[] {
	const found = frame.elements.filter(
		(e) => e.component !== null && !e.hidden && e.visibility !== 'clipped' && hasState(variantText(e), words)
	);
	return found.filter((e) => !found.some((o) => o !== e && isAncestor(frame, o.id, e.id)));
}

/** 같은 컴포넌트 세트의 포커스 아닌 인스턴스 중 가장 가까운 것 (형제 우선) */
function plainCounterpart(frame: NormalizedFrame, e: FigmaElement, options: FocusOptions): FigmaElement | undefined {
	const set = e.component?.setName ?? null;
	if (set === null) return undefined;
	const dist = (o: FigmaElement): number => Math.hypot(o.rect.x - e.rect.x, o.rect.y - e.rect.y);
	return frame.elements
		.filter(
			(o) =>
				o !== e &&
				o.component?.setName === set &&
				!o.hidden &&
				!hasState(variantText(o), [...options.states.focus, ...options.states.input])
		)
		.sort((a, b) => Number(b.parentId === e.parentId) - Number(a.parentId === e.parentId) || dist(a) - dist(b))[0];
}

/** 요소와 그 안 인스턴스의 변형 이름에 들어 있는 상태 단어 */
function statesIn(frame: NormalizedFrame, e: FigmaElement, words: readonly string[]): Set<string> {
	const out = new Set<string>();
	const visit = (x: FigmaElement): void => {
		if (x.hidden) return;
		const text = variantText(x);
		for (const w of words) if (hasState(text, [w])) out.add(w);
		for (const id of x.childIds) {
			const c = elementById(frame, id);
			if (c !== undefined) visit(c);
		}
	};
	visit(e);
	return out;
}

function ownStyle(e: FigmaElement): FocusStyle {
	return {
		scale: null,
		border: e.style.stroke === null ? null : { color: e.style.stroke.color, weight: e.style.stroke.weight },
		fill: e.style.fill,
		shadow: e.style.shadow
	};
}

function fromState(
	frame: NormalizedFrame,
	e: FigmaElement,
	source: 'variant' | 'input-state',
	options: FocusOptions
): FocusCandidate {
	const label = `${e.component?.setName ?? e.name}: ${e.component?.name ?? ''}`;
	const evidence = [
		source === 'variant' ? `컴포넌트 변형 "${label}"` : `입력 상태 변형 "${label}" (다른 포커스 근거 없음)`
	];
	const plain = plainCounterpart(frame, e, options);
	let style = ownStyle(e);
	if (plain !== undefined) {
		const diff = compare(frame, e, plain, options);
		style = diff.style;
		evidence.push(
			`보통 상태 "${plain.component?.name ?? plain.name}"와 비교: ${diff.evidence.join('; ') || '차이 없음'}`
		);
	}
	return {
		source,
		groupId: null,
		memberId: e.id,
		typicalId: plain?.id ?? null,
		score: source === 'variant' ? options.variantScore : options.inputStateScore,
		evidence,
		style
	};
}

function siblingCandidates(
	frame: NormalizedFrame,
	groups: readonly RepeatGroup[],
	options: FocusOptions,
	skipped: FocusEstimate['skipped']
): FocusCandidate[] {
	const candidates: FocusCandidate[] = [];
	for (const group of groups) {
		const members = group.memberIds
			.map((id) => elementById(frame, id))
			.filter((e): e is FigmaElement => e !== undefined);
		if (members.length < 3) {
			skipped.push({ groupId: group.id, reason: `멤버 ${members.length}개 — 어느 쪽이 다른지 정할 수 없음` });
			continue;
		}
		// 보통 멤버: 다른 멤버들과의 차이 합이 가장 작은 멤버 (차이는 양방향으로 본다 — 한쪽에만 있는 레이어)
		const distance = (x: FigmaElement, y: FigmaElement): number =>
			Math.max(compare(frame, x, y, options).score, compare(frame, y, x, options).score);
		let typical = members[0] as FigmaElement;
		let best = Infinity;
		for (const m of members) {
			const total = members.reduce((sum, o) => (o === m ? sum : sum + distance(o, m)), 0);
			if (total < best) {
				best = total;
				typical = m;
			}
		}
		const typicalStates = statesIn(frame, typical, options.states.notFocus);
		for (const m of members) {
			if (m === typical) continue;
			// TV는 포커스를 화면 안으로 스크롤하므로 화면에 걸친 멤버(가장자리 흐림 처리 등)는 후보가 아니다
			if (m.visibility !== 'visible') continue;
			const own = [...statesIn(frame, m, options.states.notFocus)].filter((x) => !typicalStates.has(x));
			if (own.length > 0) {
				skipped.push({
					groupId: group.id,
					reason: `"${m.name}"은 포커스가 아닌 변형 상태(${own.join(', ')})라 후보에서 뺌`
				});
				continue;
			}
			const diff = compare(frame, m, typical, options);
			if (diff.score >= options.minScore) {
				candidates.push({
					source: 'siblings',
					groupId: group.id,
					memberId: m.id,
					typicalId: typical.id,
					...diff
				});
			}
		}
	}
	// 같은 포커스가 바깥 묶음(예: 셸프 단위)에서도 잡히면 가장 안쪽 후보만 남긴다
	return candidates
		.filter((c) => !candidates.some((o) => o !== c && isAncestor(frame, c.memberId, o.memberId)))
		.sort((x, y) => y.score - x.score || x.memberId.localeCompare(y.memberId));
}

export function estimateFocus(
	frame: NormalizedFrame,
	groups: readonly RepeatGroup[],
	options: FocusOptions = DEFAULT_FOCUS_OPTIONS
): FocusEstimate {
	const skipped: FocusEstimate['skipped'] = [];
	const variant = stateInstances(frame, options.states.focus).map((e) => fromState(frame, e, 'variant', options));
	const siblings = siblingCandidates(frame, groups, options, skipped);
	const focusIds = new Set(variant.map((c) => c.memberId));
	const input = stateInstances(frame, options.states.input)
		.filter((e) => !focusIds.has(e.id))
		.map((e) => fromState(frame, e, 'input-state', options));
	// 근거 순서: 변형 상태 → 형제 대비 → 입력 상태. 아래 순위 근거는 참고 후보로 남긴다
	const candidates = [...variant, ...siblings, ...input];
	const [first, second] = candidates;
	const related = (a: string, b: string): boolean => a === b || isAncestor(frame, a, b) || isAncestor(frame, b, a);
	let ambiguous = false;
	if (first?.source === 'input-state') ambiguous = true;
	else if (first?.source === 'variant') {
		// 포커스 변형이 둘 이상이거나, 다른 곳에 뚜렷한 형제 차이(확대·테두리 등)가 있으면 근거가 엇갈린다
		ambiguous =
			variant.length > 1 ||
			siblings.some((c) => c.score >= options.conflictScore && !related(c.memberId, first.memberId));
	} else if (first !== undefined && second?.source === first.source) {
		ambiguous = first.score - second.score < options.ambiguityMargin;
	}
	return { primary: first ?? null, ambiguous, candidates, skipped };
}
