import { describe, expect, it } from 'vitest';
import { area, clipToViewport, intersection, iou, scaleRect } from './geometry';
import type { Rect } from './geometry';

const TV_VIEWPORT = { width: 1920, height: 1080 };

describe('area', () => {
	it('너비 × 높이를 반환한다', () => {
		expect(area({ x: 10, y: 10, width: 400, height: 225 })).toBe(90000);
	});

	it('음수 크기는 오류를 낸다', () => {
		expect(() => area({ x: 0, y: 0, width: -1, height: 10 })).toThrow(RangeError);
	});

	it('NaN·Infinity는 오류를 낸다', () => {
		expect(() => area({ x: Number.NaN, y: 0, width: 1, height: 1 })).toThrow(RangeError);
		expect(() => area({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 })).toThrow(RangeError);
	});
});

describe('intersection', () => {
	it('겹치는 영역을 반환한다', () => {
		const a: Rect = { x: 0, y: 0, width: 100, height: 100 };
		const b: Rect = { x: 50, y: 50, width: 100, height: 100 };
		expect(intersection(a, b)).toEqual({ x: 50, y: 50, width: 50, height: 50 });
	});

	it('떨어져 있으면 null', () => {
		expect(intersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 })).toBeNull();
	});

	it('변만 맞닿으면 null', () => {
		expect(intersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBeNull();
	});
});

describe('iou', () => {
	it('같은 사각형은 1', () => {
		const r: Rect = { x: 624, y: 0, width: 400, height: 225 };
		expect(iou(r, r)).toBe(1);
	});

	it('겹치지 않으면 0', () => {
		expect(iou({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 100, width: 10, height: 10 })).toBe(0);
	});

	it('절반 겹침의 IoU를 계산한다', () => {
		// 교집합 50, 합집합 150
		const value = iou({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 0, width: 10, height: 10 });
		expect(value).toBeCloseTo(50 / 150, 10);
	});

	it('포커스로 1.1배 커진 카드와 원래 카드는 높은 IoU를 가진다 (Top 10 01 프레임 값)', () => {
		const normal: Rect = { x: 0, y: 0, width: 400, height: 225 };
		const focused: Rect = { x: -20, y: -11.25, width: 440, height: 247.5 };
		expect(iou(normal, focused)).toBeCloseTo((400 * 225) / (440 * 247.5), 10);
		expect(iou(normal, focused)).toBeGreaterThan(0.8);
	});

	it('면적이 0인 두 사각형은 0', () => {
		expect(iou({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 })).toBe(0);
	});
});

describe('scaleRect', () => {
	it('UX 화면설계서 목업(0.625배)을 TV 좌표로 되돌린다', () => {
		const inMockup: Rect = { x: 125, y: 62.5, width: 375, height: 25 };
		expect(scaleRect(inMockup, 1 / 0.625)).toEqual({ x: 200, y: 100, width: 600, height: 40 });
	});

	it('가로·세로 배율을 따로 줄 수 있다', () => {
		expect(scaleRect({ x: 10, y: 10, width: 10, height: 10 }, 2, 3)).toEqual({
			x: 20,
			y: 30,
			width: 20,
			height: 30
		});
	});

	it('0 이하 배율은 오류를 낸다', () => {
		expect(() => scaleRect({ x: 0, y: 0, width: 1, height: 1 }, 0)).toThrow(RangeError);
		expect(() => scaleRect({ x: 0, y: 0, width: 1, height: 1 }, 1, -2)).toThrow(RangeError);
	});
});

describe('clipToViewport (Top 10 01 프레임 실제 값)', () => {
	it('뷰포트 안 카드는 visible', () => {
		const card2: Rect = { x: 804, y: 432, width: 400, height: 225 };
		const result = clipToViewport(card2, TV_VIEWPORT);
		expect(result.visibility).toBe('visible');
		expect(result.visibleRatio).toBe(1);
		expect(result.visibleRect).toEqual(card2);
	});

	it('오른쪽 화면 밖 카드(5번 이후)는 clipped', () => {
		const card6: Rect = { x: 2932, y: 432, width: 400, height: 225 };
		const result = clipToViewport(card6, TV_VIEWPORT);
		expect(result.visibility).toBe('clipped');
		expect(result.visibleRect).toBeNull();
		expect(result.visibleRatio).toBe(0);
	});

	it('하단이 잘린 프로모 카드는 partial', () => {
		const promo: Rect = { x: 180, y: 867, width: 1684, height: 452 };
		const result = clipToViewport(promo, TV_VIEWPORT);
		expect(result.visibility).toBe('partial');
		expect(result.visibleRect).toEqual({ x: 180, y: 867, width: 1684, height: 213 });
		expect(result.visibleRatio).toBeCloseTo(213 / 452, 10);
	});

	it('상단이 잘린 위 셸프는 partial', () => {
		const upperShelf: Rect = { x: 180, y: -436.44921875, width: 1996, height: 659 };
		const result = clipToViewport(upperShelf, TV_VIEWPORT);
		expect(result.visibility).toBe('partial');
		expect(result.visibleRect?.y).toBe(0);
	});

	it('면적 0인 요소는 위치로 판정한다', () => {
		expect(clipToViewport({ x: 100, y: 100, width: 0, height: 0 }, TV_VIEWPORT).visibility).toBe('visible');
		expect(clipToViewport({ x: 3000, y: 100, width: 0, height: 0 }, TV_VIEWPORT).visibility).toBe('clipped');
	});

	it('잘못된 뷰포트는 오류를 낸다', () => {
		expect(() => clipToViewport({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 1080 })).toThrow(
			RangeError
		);
	});
});
