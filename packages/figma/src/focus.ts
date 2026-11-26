import { area } from '@auto-qa/core';
import type { Rect } from '@auto-qa/core';
import type { ColorSummary, FigmaElement, NormalizedFrame } from './normalize';
import { elementById } from './normalize';
import type { RepeatGroup } from './repeat';
import { matchVisuals, visuals } from './visual';

/**
 * 형제 대비 포커스 요소 추정 (설계 7.3, D-010). GUI 프레임은 포커스 상태 스냅샷이고, 포커스는
 * "같은 묶음의 다른 멤버와 다른 점"(확대, 테두리 레이어, 테두리·배경·그림자 변화)으로 드러난다.
 * 그 차이가 곧 기대 포커스 스타일이다. 점수 가중치와 기준은 옵션으로 둔다.
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
	}
};

export interface FocusStyle {
	scale: { x: number; y: number } | null;
	border: { color: ColorSummary | null; weight: number | 'mixed' | null } | null;
	fill: ColorSummary | null;
	shadow: boolean;
}

export interface FocusCandidate {
	groupId: string;
	memberId: string;
	/** 비교 기준이 된 보통 멤버 */
	typicalId: string;
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
	const changed = (a: { width: number; height: number }, b: { width: number; height: number }): boolean =>
		b.width > 0 &&
		b.height > 0 &&
		Math.max(Math.abs(a.width / b.width - 1), Math.abs(a.height / b.height - 1)) >= options.scaleThreshold;
	// 글자 상자는 내용 길이에 따라, 벡터 아이콘은 모양에 따라 크기가 달라지므로 확대 근거로 쓰지 않는다
	const scaled = pairs
		.filter((p) => (p.a.cls === 'image' || p.a.cls === 'fill' || p.a.cls === 'stroke') && changed(p.a.rel, p.b.rel))
		.sort((x, y) => area(y.a.rel) - area(x.a.rel))[0];
	if (changed(member.rect, typical.rect) || scaled !== undefined) {
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

export function estimateFocus(
	frame: NormalizedFrame,
	groups: readonly RepeatGroup[],
	options: FocusOptions = DEFAULT_FOCUS_OPTIONS
): FocusEstimate {
	const candidates: FocusCandidate[] = [];
	const skipped: FocusEstimate['skipped'] = [];
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
		for (const m of members) {
			if (m === typical) continue;
			const diff = compare(frame, m, typical, options);
			if (diff.score >= options.minScore) {
				candidates.push({ groupId: group.id, memberId: m.id, typicalId: typical.id, ...diff });
			}
		}
	}
	// 같은 포커스가 바깥 묶음(예: 셸프 단위)에서도 잡히면 가장 안쪽 후보만 남긴다
	const specific = candidates.filter(
		(c) => !candidates.some((o) => o !== c && isAncestor(frame, c.memberId, o.memberId))
	);
	specific.sort((x, y) => y.score - x.score || x.memberId.localeCompare(y.memberId));
	const [first, second] = specific;
	return {
		primary: first ?? null,
		ambiguous: first !== undefined && second !== undefined && first.score - second.score < options.ambiguityMargin,
		candidates: specific,
		skipped
	};
}
