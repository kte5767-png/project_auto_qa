import { area } from '@auto-qa/core';
import type { Rect } from '@auto-qa/core';
import type { FigmaElement, NormalizedFrame } from './normalize';
import { elementById } from './normalize';

/**
 * 보이는 요소 단위로 하위 구조를 본다 (D-030 보완). 실제 GUI 파일은 같은 카드라도 포커스된 카드만
 * FRAME으로 한 번 더 감싸거나, GROUP과 FRAME을 섞어 쓴다. 노드 종류·깊이로 비교하면 이런 차이에 걸리므로,
 * 칠·테두리·그림자가 없는 "감싸기만 하는 상자"는 건너뛰고 화면에 그려지는 요소만 모은다.
 */

/**
 * text: 글자, image: 이미지 칠, fill: 색 칠(또는 그림자)이 있는 상자·도형, stroke: 칠 없이 테두리만 있는 상자·도형,
 * glyph: 벡터 아이콘·모양 (아이콘마다 모양이 달라 크기 비교·추가/제거 근거로 쓰지 않는다)
 */
export type VisualClass = 'text' | 'image' | 'fill' | 'stroke' | 'glyph';

export interface Visual {
	element: FigmaElement;
	cls: VisualClass;
	/** 멤버 왼쪽 위 기준 위치 */
	rel: Rect;
}

export function visualClass(e: FigmaElement): VisualClass | null {
	if (e.kind === 'text') return e.text !== null && e.text.characters.trim() !== '' ? 'text' : null;
	if (e.kind === 'image') return 'image';
	if (e.kind === 'vector') return e.style.fill !== null || e.style.stroke !== null ? 'glyph' : null;
	const fill = e.style.fill !== null && e.style.fill.alpha > 0;
	if (fill || e.style.shadow) return 'fill';
	if (e.style.stroke !== null) return 'stroke';
	return null;
}

/** 멤버(자신 포함)와 자손 중 보이는 요소. 숨김 요소는 뺀다 */
export function visuals(frame: NormalizedFrame, member: FigmaElement): Visual[] {
	const out: Visual[] = [];
	const visit = (e: FigmaElement): void => {
		if (e.hidden) return;
		const cls = visualClass(e);
		if (cls !== null) {
			out.push({
				element: e,
				cls,
				rel: {
					x: e.rect.x - member.rect.x,
					y: e.rect.y - member.rect.y,
					width: e.rect.width,
					height: e.rect.height
				}
			});
		}
		for (const id of e.childIds) {
			const child = elementById(frame, id);
			if (child !== undefined) visit(child);
		}
	};
	visit(member);
	return out;
}

export function visualCounts(list: readonly Visual[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const v of list) counts.set(v.cls, (counts.get(v.cls) ?? 0) + 1);
	return counts;
}

export interface VisualMatch {
	pairs: { a: Visual; b: Visual }[];
	/** a에만 있음 */
	added: Visual[];
	/** b에만 있음 */
	removed: Visual[];
}

const center = (r: Rect): [number, number] => [r.x + r.width / 2, r.y + r.height / 2];

/**
 * 두 멤버의 보이는 요소를 짝짓는다: 같은 종류이고, 멤버 기준 중심 위치가 가깝고, 크기가 절반~두 배 안인 것.
 * 큰 요소부터 가장 비용이 낮은 짝을 고른다 (결정적).
 */
export function matchVisuals(
	a: readonly Visual[],
	b: readonly Visual[],
	memberSize: { width: number; height: number },
	maxCenterShift = 0.25
): VisualMatch {
	const limit = Math.max(memberSize.width, memberSize.height) * maxCenterShift;
	const diag = Math.hypot(memberSize.width, memberSize.height) || 1;
	const used = new Set<number>();
	const pairs: VisualMatch['pairs'] = [];
	const added: Visual[] = [];
	const order = [...a].sort((x, y) => area(y.rel) - area(x.rel) || x.element.id.localeCompare(y.element.id));
	for (const va of order) {
		let best = -1;
		let bestCost = Infinity;
		b.forEach((vb, i) => {
			if (used.has(i) || vb.cls !== va.cls) return;
			const [ax, ay] = center(va.rel);
			const [bx, by] = center(vb.rel);
			const shift = Math.hypot(ax - bx, ay - by);
			const wr = vb.rel.width === 0 ? 1 : va.rel.width / vb.rel.width;
			const hr = vb.rel.height === 0 ? 1 : va.rel.height / vb.rel.height;
			if (shift > limit || wr < 0.5 || wr > 2 || hr < 0.5 || hr > 2) return;
			const cost = shift / diag + Math.abs(Math.log(wr || 1)) + Math.abs(Math.log(hr || 1));
			if (cost < bestCost) {
				bestCost = cost;
				best = i;
			}
		});
		const vb = b[best];
		if (vb === undefined) {
			added.push(va);
		} else {
			used.add(best);
			pairs.push({ a: va, b: vb });
		}
	}
	return { pairs, added, removed: b.filter((_, i) => !used.has(i)) };
}
