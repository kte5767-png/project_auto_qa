import { describe, expect, it } from 'vitest';
import { findNext, keyCodeToDirection } from './spatial';
import type { Box, NavCandidate } from './spatial';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });
const c = (id: string, b: Box): NavCandidate => ({ id, box: b });

describe('findNext', () => {
	const row = [c('a', box(0, 0, 100, 100)), c('b', box(150, 0, 100, 100)), c('c', box(300, 0, 100, 100))];

	it('오른쪽으로 가장 가까운 요소를 고른다', () => {
		expect(findNext(box(0, 0, 100, 100), row, 'right')).toBe('b');
	});

	it('왼쪽 끝에서 왼쪽으로 가면 null', () => {
		expect(findNext(box(0, 0, 100, 100), row, 'left')).toBeNull();
	});

	it('같은 열(범위가 겹치는) 요소를 대각선 요소보다 먼저 고른다', () => {
		const candidates = [c('diagonal', box(250, 120, 100, 100)), c('below', box(0, 200, 100, 100))];
		expect(findNext(box(0, 0, 100, 100), candidates, 'down')).toBe('below');
	});

	it('수직 범위가 모두 겹치면 중심이 가까운 요소를 고른다 (GNB 진입)', () => {
		const gnb = [
			c('gnb-home', box(33, 358, 64, 64)),
			c('gnb-search', box(33, 457, 64, 64)),
			c('gnb-luggage', box(33, 556, 64, 64))
		];
		const thumb = box(180, 179, 400, 600);
		expect(findNext(thumb, gnb, 'left')).toBe('gnb-search');
	});

	it('멀리 떨어진 GNB보다 위쪽 같은 열의 카드를 고른다 (프로모 버튼에서 ↑)', () => {
		const promoButton = box(250, 675, 442, 72);
		const candidates = [c('gnb-luggage', box(33, 556, 64, 64)), c('top10-card-1', box(272, -62, 400, 275))];
		expect(findNext(promoButton, candidates, 'up')).toBe('top10-card-1');
	});

	it('크기가 0인 요소는 후보에서 뺀다', () => {
		expect(findNext(box(0, 0, 100, 100), [c('empty', box(150, 0, 0, 0))], 'right')).toBeNull();
	});

	it('1px 이내로 겹친 요소는 진행 방향 후보로 인정한다', () => {
		expect(findNext(box(0, 0, 100, 100), [c('touching', box(99.5, 0, 100, 100))], 'right')).toBe('touching');
	});
});

describe('keyCodeToDirection', () => {
	it('방향키 코드를 방향으로 바꾼다', () => {
		expect(keyCodeToDirection(37)).toBe('left');
		expect(keyCodeToDirection(38)).toBe('up');
		expect(keyCodeToDirection(39)).toBe('right');
		expect(keyCodeToDirection(40)).toBe('down');
	});

	it('방향키가 아니면 null', () => {
		expect(keyCodeToDirection(13)).toBeNull();
		expect(keyCodeToDirection(461)).toBeNull();
	});
});
