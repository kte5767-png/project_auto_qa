import { area } from '@auto-qa/core';
import type { ColorSummary, FigmaElement, NormalizedFrame } from './normalize';
import { elementById } from './normalize';
import type { RepeatGroup } from './repeat';

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

/** 멤버 아래 자손을 "종류#같은 종류 안 순번" 경로로 색인 */
function descendants(frame: NormalizedFrame, member: FigmaElement): Map<string, FigmaElement> {
	const map = new Map<string, FigmaElement>([['', member]]);
	const visit = (e: FigmaElement, prefix: string): void => {
		const seen = new Map<string, number>();
		for (const id of e.childIds) {
			const child = elementById(frame, id);
			if (child === undefined) continue;
			const n = seen.get(child.type) ?? 0;
			seen.set(child.type, n + 1);
			const key = `${prefix}/${child.type}#${n}`;
			if (!child.hidden) map.set(key, child);
			visit(child, key);
		}
	};
	visit(member, '');
	return map;
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

function compare(frame: NormalizedFrame, member: FigmaElement, typical: FigmaElement, options: FocusOptions): Diff {
	const w = options.weights;
	const a = descendants(frame, member);
	const b = descendants(frame, typical);
	const evidence: string[] = [];
	const style: FocusStyle = { scale: null, border: null, fill: null, shadow: false };
	let score = 0;
	const memberArea = area(member.rect);

	const sx = typical.rect.width === 0 ? 1 : member.rect.width / typical.rect.width;
	const sy = typical.rect.height === 0 ? 1 : member.rect.height / typical.rect.height;
	if (Math.max(Math.abs(sx - 1), Math.abs(sy - 1)) >= options.scaleThreshold) {
		score += w.scale;
		style.scale = { x: Math.round(sx * 1000) / 1000, y: Math.round(sy * 1000) / 1000 };
		evidence.push(
			`크기 ${typical.rect.width}×${typical.rect.height} → ${member.rect.width}×${member.rect.height} (×${style.scale.x}, ×${style.scale.y})`
		);
	}

	// 확대는 멤버 전체보다 실제로 커진 가장 큰 자손(예: 순번 숫자를 뺀 카드)의 배율이 기대 포커스 스타일에 가깝다
	if (style.scale !== null) {
		let biggest: { e: FigmaElement; t: FigmaElement } | null = null;
		for (const [key, e] of a) {
			const t = b.get(key);
			if (key === '' || t === undefined || t.rect.width === 0 || t.rect.height === 0) continue;
			const ex = e.rect.width / t.rect.width;
			const ey = e.rect.height / t.rect.height;
			if (Math.max(Math.abs(ex - 1), Math.abs(ey - 1)) < options.scaleThreshold) continue;
			if (biggest === null || area(e.rect) > area(biggest.e.rect)) biggest = { e, t };
		}
		if (biggest !== null) {
			const { e, t } = biggest;
			style.scale = {
				x: Math.round((e.rect.width / t.rect.width) * 1000) / 1000,
				y: Math.round((e.rect.height / t.rect.height) * 1000) / 1000
			};
			evidence.push(
				`안쪽 "${e.name}" ${t.rect.width}×${t.rect.height} → ${e.rect.width}×${e.rect.height} (×${style.scale.x}, ×${style.scale.y})`
			);
		}
	}

	let otherLayers = 0;
	for (const [key, e] of a) {
		const t = b.get(key);
		const large = memberArea > 0 && area(e.rect) >= memberArea * 0.5;
		if (t === undefined) {
			const borderLike =
				(e.style.stroke !== null || e.type === 'LINE') &&
				(e.style.fill === null || e.style.fill.alpha === 0) &&
				(large || e.type === 'LINE');
			if (borderLike && style.border === null) {
				score += w.borderLayer;
				style.border = { color: e.style.stroke?.color ?? null, weight: e.style.stroke?.weight ?? null };
				evidence.push(
					`테두리 레이어 추가: "${e.name}" (${e.style.stroke?.color?.hex ?? '?'}, ${String(e.style.stroke?.weight ?? '?')}px)`
				);
			} else if (otherLayers === 0) {
				otherLayers++;
				score += w.otherLayer;
				evidence.push(`레이어 추가: "${e.name}" (${e.type})`);
			}
			continue;
		}
		if (strokeKey(e) !== strokeKey(t) && e.style.stroke !== null && (large || key === '')) {
			if (style.border === null) {
				score += w.stroke;
				style.border = { color: e.style.stroke.color, weight: e.style.stroke.weight };
				evidence.push(`테두리 ${strokeKey(t)} → ${strokeKey(e)} ("${e.name}")`);
			}
		}
		if (
			(e.kind === 'container' || e.kind === 'shape') &&
			(large || key === '') &&
			!sameColor(e.style.fill, t.style.fill) &&
			style.fill === null
		) {
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
			e.kind === 'text' &&
			t.kind === 'text' &&
			(!sameColor(e.text?.color ?? null, t.text?.color ?? null) || e.text?.fontWeight !== t.text?.fontWeight) &&
			!evidence.some((x) => x.startsWith('글자'))
		) {
			score += w.text;
			evidence.push(
				`글자 ${t.text?.color?.hex ?? '?'}/${t.text?.fontWeight ?? '?'} → ${e.text?.color?.hex ?? '?'}/${e.text?.fontWeight ?? '?'}`
			);
		}
	}
	for (const [key, t] of b) {
		if (a.has(key) || key === '') continue;
		if (memberArea > 0 && area(t.rect) >= area(typical.rect) * 0.5) {
			score += w.removedLayer;
			evidence.push(`다른 멤버의 덮개 레이어 없음: "${t.name}" (${t.style.fill?.hex ?? t.type})`);
			break;
		}
	}
	return { score: Math.min(1, Math.round(score * 1000) / 1000), evidence, style };
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
