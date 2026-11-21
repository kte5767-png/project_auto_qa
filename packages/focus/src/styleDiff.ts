import { commonAncestor, depth } from './paths';
import type { FocusState, StyleSig } from './types';

/**
 * 스타일 변화로 포커스를 추정하는 휴리스틱 (설계 7.1의 4번).
 * 키 입력 전후로 "강조 점수"가 오른 요소를 새로 포커스된 요소로 본다.
 */

function px(value: string): number {
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

/** `matrix(a, b, c, d, e, f)`의 배율. none이면 1 */
export function transformScale(transform: string): number {
	const match = /^matrix\(([^)]+)\)$/.exec(transform.trim());
	if (match === null) return 1;
	const [a = 1, b = 0] = (match[1] ?? '').split(',').map((v) => Number.parseFloat(v));
	return Math.hypot(a, b);
}

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` → [상대 휘도 0~1, 불투명도 0~1] */
export function colorLuminance(color: string): [number, number] {
	const match = /^rgba?\(([^)]+)\)$/.exec(color.trim());
	if (match === null) return [0, 0];
	const [r = 0, g = 0, b = 0, a = 1] = (match[1] ?? '')
		.split(/[\s,/]+/)
		.filter(Boolean)
		.map(Number);
	const lin = (c: number): number => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return [0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b), a];
}

function pseudoScore(value: string): number {
	if (value === 'none') return 0;
	const [display = 'none', opacity = '0', width = '0', style = 'none'] = value.split('|');
	if (display === 'none' || style === 'none' || px(opacity) === 0) return 0;
	return px(width) * 2 * px(opacity);
}

/** 강조 점수. 클수록 "눈에 띄게 강조된" 상태 */
export function emphasisScore(sig: StyleSig): number {
	let score = 0;
	const scale = transformScale(sig.transform);
	if (scale > 1.001) score += (scale - 1) * 100;

	const [outlineStyle = 'none', outlineWidth = '0'] = sig.outline.split('|');
	if (outlineStyle !== 'none') score += px(outlineWidth) * 2;

	const [borderStyle = 'none', borderWidth = '0'] = sig.border.split('|');
	if (borderStyle !== 'none') score += px(borderWidth);

	if (sig.boxShadow !== 'none') score += 5;

	const [bgLum, bgAlpha] = colorLuminance(sig.background);
	score += bgAlpha * (2 + bgLum * 5);

	score += pseudoScore(sig.after) + pseudoScore(sig.before);
	return score;
}

export interface StyleChange {
	path: string;
	before: number;
	after: number;
}

const GAIN_THRESHOLD = 0.5;

/** 두 상태 모두에 있는 요소 중 스타일이 바뀐 요소와 강조 점수 변화 */
export function diffStyles(prev: FocusState, next: FocusState): StyleChange[] {
	const changes: StyleChange[] = [];
	for (const [path, after] of Object.entries(next.styles)) {
		const before = prev.styles[path];
		if (before === undefined || JSON.stringify(before) === JSON.stringify(after)) continue;
		changes.push({ path, before: emphasisScore(before), after: emphasisScore(after) });
	}
	return changes;
}

export interface StyleDiffPick {
	path: string | null;
	gainedCount: number;
}

/**
 * 강조 점수가 오른 요소들로 새 포커스 요소를 고른다.
 * 여러 요소가 함께 강조되면(카드 테두리 + 이미지 확대) 가까운 공통 조상을 고르고,
 * 공통 조상이 너무 멀면(서로 다른 곳이 바뀜) 가장 크게 오른 요소를 고른다.
 */
export function pickByStyleDiff(prev: FocusState, next: FocusState, maxAncestorDistance = 3): StyleDiffPick {
	const gained = diffStyles(prev, next).filter((c) => c.after - c.before > GAIN_THRESHOLD);
	if (gained.length === 0) return { path: null, gainedCount: 0 };
	const strongest = gained.reduce((best, c) => (c.after - c.before > best.after - best.before ? c : best));
	const ancestor = commonAncestor(gained.map((c) => c.path));
	const deepest = Math.max(...gained.map((c) => depth(c.path)));
	if (ancestor !== null && deepest - depth(ancestor) <= maxAncestorDistance) {
		return { path: ancestor, gainedCount: gained.length };
	}
	return { path: strongest.path, gainedCount: gained.length };
}
