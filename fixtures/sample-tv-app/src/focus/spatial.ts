/**
 * CSS 클래스 방식 포커스에서 쓰는 공간 탐색. 방향키 방향에 있는 후보 중 가장 가까운 요소를 고른다.
 * 1) 진행 방향 거리 2) 수직 방향 어긋남(범위가 겹치면 0) 3) 중심 간 거리 순으로 비교한다.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface NavCandidate {
	id: string;
	box: Box;
}

const EDGE_TOLERANCE = 1;
/** 수직 방향 어긋남 가중치. 크게 둬서 같은 열·행에 있는 요소를 먼저 고른다 (Spotlight 동작에 맞춤) */
const CROSS_AXIS_WEIGHT = 5;

function right(b: Box): number {
	return b.left + b.width;
}

function bottom(b: Box): number {
	return b.top + b.height;
}

function rangeGap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
	if (aEnd < bStart) return bStart - aEnd;
	if (bEnd < aStart) return aStart - bEnd;
	return 0;
}

function mainDistance(from: Box, to: Box, direction: Direction): number {
	switch (direction) {
		case 'right':
			return to.left - right(from);
		case 'left':
			return from.left - right(to);
		case 'down':
			return to.top - bottom(from);
		case 'up':
			return from.top - bottom(to);
	}
}

function crossGap(from: Box, to: Box, direction: Direction): number {
	return direction === 'left' || direction === 'right'
		? rangeGap(from.top, bottom(from), to.top, bottom(to))
		: rangeGap(from.left, right(from), to.left, right(to));
}

function centerDistance(from: Box, to: Box): number {
	const dx = from.left + from.width / 2 - (to.left + to.width / 2);
	const dy = from.top + from.height / 2 - (to.top + to.height / 2);
	return Math.hypot(dx, dy);
}

export function findNext(current: Box, candidates: readonly NavCandidate[], direction: Direction): string | null {
	let best: { id: string; score: number; center: number } | null = null;
	for (const c of candidates) {
		if (c.box.width <= 0 || c.box.height <= 0) continue;
		const main = mainDistance(current, c.box, direction);
		if (main < -EDGE_TOLERANCE) continue;
		const score = Math.max(main, 0) + CROSS_AXIS_WEIGHT * crossGap(current, c.box, direction);
		const center = centerDistance(current, c.box);
		if (best === null || score < best.score || (score === best.score && center < best.center)) {
			best = { id: c.id, score, center };
		}
	}
	return best?.id ?? null;
}

export function keyCodeToDirection(keyCode: number): Direction | null {
	switch (keyCode) {
		case 37:
			return 'left';
		case 38:
			return 'up';
		case 39:
			return 'right';
		case 40:
			return 'down';
		default:
			return null;
	}
}
