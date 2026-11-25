import type { FigmaElement, NormalizedFrame } from './normalize';
import { elementById } from './normalize';

/**
 * 반복 요소 묶기 (설계 7.2, D-011). 실제 GUI 파일은 카드가 컴포넌트가 아니므로 이름·컴포넌트로 묶을 수 없다.
 * 같은 부모 아래 형제 중 종류·크기·하위 구조가 비슷한 것을 묶는다. 포커스된 카드처럼 조금 커지거나
 * 테두리 레이어가 하나 더 있어도 같은 묶음에 들어가도록 기준에 여유를 둔다 (수치는 옵션).
 */

export interface RepeatOptions {
	/** 너비·높이 비율 하한 (작은 쪽 ÷ 큰 쪽) */
	minSizeRatio: number;
	/** 하위 구조 유사도(자손 종류·깊이 다중집합의 Jaccard) 하한 */
	minStructureSimilarity: number;
	/**
	 * 하위 구조 포함도(겹침 ÷ 작은 쪽) 하한. 포커스 카드처럼 레이어가 더해진 경우 Jaccard는 낮아도
	 * 한쪽 구조가 다른 쪽을 거의 포함한다. 둘 중 하나를 만족하면 비슷하다고 본다 (Jaccard는 아래 하한 이상일 때만).
	 */
	minStructureOverlap: number;
	/** 포함도로 인정할 때 Jaccard 최소값 */
	minJaccardWithOverlap: number;
	/** 하위 구조를 볼 깊이 */
	structureDepth: number;
}

export const DEFAULT_REPEAT_OPTIONS: RepeatOptions = {
	minSizeRatio: 0.8,
	minStructureSimilarity: 0.7,
	minStructureOverlap: 0.9,
	minJaccardWithOverlap: 0.5,
	structureDepth: 3
};

export interface RepeatGroup {
	id: string;
	parentId: string;
	memberIds: string[];
	axis: 'row' | 'column' | 'grid';
	/** 축 방향 요소 사이 간격의 중앙값 (px) */
	gap: number | null;
	/** 화면에 보이는(일부 포함) 멤버 수 */
	shownCount: number;
}

/** 자손의 "종류@상대 깊이" 다중집합 */
export function structureTokens(frame: NormalizedFrame, element: FigmaElement, maxDepth: number): Map<string, number> {
	const tokens = new Map<string, number>();
	const visit = (e: FigmaElement, depth: number): void => {
		if (depth > maxDepth) return;
		for (const id of e.childIds) {
			const child = elementById(frame, id);
			if (child === undefined) continue;
			const key = `${child.type}@${depth}`;
			tokens.set(key, (tokens.get(key) ?? 0) + 1);
			visit(child, depth + 1);
		}
	};
	visit(element, 1);
	return tokens;
}

export function multisetJaccard(a: Map<string, number>, b: Map<string, number>): number {
	const keys = new Set([...a.keys(), ...b.keys()]);
	if (keys.size === 0) return 1;
	let min = 0;
	let max = 0;
	for (const k of keys) {
		const x = a.get(k) ?? 0;
		const y = b.get(k) ?? 0;
		min += Math.min(x, y);
		max += Math.max(x, y);
	}
	return max === 0 ? 1 : min / max;
}

const ratio = (a: number, b: number): number => (Math.max(a, b) === 0 ? 1 : Math.min(a, b) / Math.max(a, b));

function similar(
	frame: NormalizedFrame,
	a: FigmaElement,
	b: FigmaElement,
	options: RepeatOptions,
	tokenCache: Map<string, Map<string, number>>
): boolean {
	if (a.kind !== b.kind || a.type !== b.type) return false;
	if (a.kind === 'text') {
		return (
			a.text?.fontSize === b.text?.fontSize &&
			a.text?.fontFamily === b.text?.fontFamily &&
			ratio(a.rect.height, b.rect.height) >= options.minSizeRatio
		);
	}
	if (ratio(a.rect.width, b.rect.width) < options.minSizeRatio) return false;
	if (ratio(a.rect.height, b.rect.height) < options.minSizeRatio) return false;
	const tokens = (e: FigmaElement): Map<string, number> => {
		let t = tokenCache.get(e.id);
		if (t === undefined) {
			t = structureTokens(frame, e, options.structureDepth);
			tokenCache.set(e.id, t);
		}
		return t;
	};
	const ta = tokens(a);
	const tb = tokens(b);
	const jaccard = multisetJaccard(ta, tb);
	if (jaccard >= options.minStructureSimilarity) return true;
	return jaccard >= options.minJaccardWithOverlap && multisetOverlap(ta, tb) >= options.minStructureOverlap;
}

/** 겹침 ÷ 작은 쪽 크기 (한쪽이 다른 쪽을 포함하면 1) */
export function multisetOverlap(a: Map<string, number>, b: Map<string, number>): number {
	const size = (m: Map<string, number>): number => [...m.values()].reduce((x, y) => x + y, 0);
	const smaller = Math.min(size(a), size(b));
	if (smaller === 0) return size(a) === size(b) ? 1 : 0;
	let common = 0;
	for (const [k, v] of a) common += Math.min(v, b.get(k) ?? 0);
	return common / smaller;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const s = [...values].sort((x, y) => x - y);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 === 1 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

function layoutOf(members: FigmaElement[]): Pick<RepeatGroup, 'axis' | 'gap'> {
	const cx = members.map((m) => m.rect.x + m.rect.width / 2);
	const cy = members.map((m) => m.rect.y + m.rect.height / 2);
	const mw = median(members.map((m) => m.rect.width)) ?? 0;
	const mh = median(members.map((m) => m.rect.height)) ?? 0;
	const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
	const axis = spread(cy) <= mh * 0.25 ? 'row' : spread(cx) <= mw * 0.25 ? 'column' : 'grid';
	if (axis === 'grid') return { axis, gap: null };
	const sorted = [...members].sort((a, b) => (axis === 'row' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
	const gaps: number[] = [];
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		if (prev === undefined || cur === undefined) continue;
		gaps.push(
			axis === 'row'
				? cur.rect.x - (prev.rect.x + prev.rect.width)
				: cur.rect.y - (prev.rect.y + prev.rect.height)
		);
	}
	const gap = median(gaps);
	return { axis, gap: gap === null ? null : Math.round(gap * 100) / 100 };
}

export function findRepeatGroups(
	frame: NormalizedFrame,
	options: RepeatOptions = DEFAULT_REPEAT_OPTIONS
): RepeatGroup[] {
	const groups: RepeatGroup[] = [];
	const tokenCache = new Map<string, Map<string, number>>();
	for (const parent of frame.elements) {
		const siblings = parent.childIds
			.map((id) => elementById(frame, id))
			.filter((e): e is FigmaElement => e !== undefined && !e.hidden);
		if (siblings.length < 2) continue;
		// 합집합-찾기로 비슷한 형제끼리 묶는다
		const root = siblings.map((_, i) => i);
		const find = (i: number): number => {
			let r = i;
			while (root[r] !== r) r = root[r] ?? r;
			return r;
		};
		for (let i = 0; i < siblings.length; i++) {
			for (let j = i + 1; j < siblings.length; j++) {
				const a = siblings[i];
				const b = siblings[j];
				if (a !== undefined && b !== undefined && similar(frame, a, b, options, tokenCache))
					root[find(j)] = find(i);
			}
		}
		const sets = new Map<number, FigmaElement[]>();
		siblings.forEach((s, i) => sets.set(find(i), [...(sets.get(find(i)) ?? []), s]));
		for (const members of sets.values()) {
			if (members.length < 2) continue;
			groups.push({
				id: `${parent.id}/g${groups.filter((g) => g.parentId === parent.id).length + 1}`,
				parentId: parent.id,
				memberIds: members.map((m) => m.id),
				...layoutOf(members),
				shownCount: members.filter((m) => m.visibility !== 'clipped').length
			});
		}
	}
	return groups;
}
