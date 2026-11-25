import { describe, expect, it } from 'vitest';
import { colorLuminance, diffStyles, emphasisScore, pickByStyleDiff, transformScale } from './styleDiff';
import { NEUTRAL, state } from './testUtils';

const CARD = 'body>div:nth-of-type(1)>div:nth-of-type(3)';
const IMAGE = `${CARD}>div:nth-of-type(1)`;
const OTHER = 'body>div:nth-of-type(1)>div:nth-of-type(4)';
const FAR = 'body>nav:nth-of-type(1)>div:nth-of-type(2)>span:nth-of-type(1)>i:nth-of-type(1)>b:nth-of-type(1)';

describe('transformScale', () => {
	it('matrix에서 배율을 읽는다', () => {
		expect(transformScale('matrix(1.1, 0, 0, 1.1, 0, 0)')).toBeCloseTo(1.1);
		expect(transformScale('none')).toBe(1);
		expect(transformScale('matrix(1, 0, 0, 1, 500, 0)')).toBe(1);
	});
});

describe('colorLuminance', () => {
	it('흰색·검정·투명을 구분한다', () => {
		const [whiteLum, whiteAlpha] = colorLuminance('rgb(255, 255, 255)');
		expect(whiteLum).toBeCloseTo(1);
		expect(whiteAlpha).toBe(1);
		expect(colorLuminance('rgb(0, 0, 0)')).toEqual([0, 1]);
		expect(colorLuminance('rgba(0, 0, 0, 0)')[1]).toBe(0);
		expect(colorLuminance('transparent')).toEqual([0, 0]);
	});
});

describe('emphasisScore', () => {
	it('중립 스타일은 0', () => {
		expect(emphasisScore(NEUTRAL)).toBe(0);
	});

	it('확대, 외곽선, 그림자, 의사 요소 테두리, 밝은 배경이 점수를 올린다', () => {
		expect(emphasisScore({ ...NEUTRAL, transform: 'matrix(1.1, 0, 0, 1.1, 0, 0)' })).toBeCloseTo(10);
		expect(emphasisScore({ ...NEUTRAL, outline: 'solid|3px|rgb(255, 255, 255)' })).toBe(6);
		expect(emphasisScore({ ...NEUTRAL, boxShadow: 'rgb(255, 255, 255) 0px 0px 0px 4px' })).toBe(5);
		expect(emphasisScore({ ...NEUTRAL, after: 'block|1|4px|solid' })).toBe(8);
		expect(emphasisScore({ ...NEUTRAL, background: 'rgb(255, 255, 255)' })).toBeCloseTo(7);
	});

	it('보이지 않는 의사 요소 테두리는 점수에 넣지 않는다', () => {
		expect(emphasisScore({ ...NEUTRAL, after: 'block|0|4px|solid' })).toBe(0);
		expect(emphasisScore({ ...NEUTRAL, after: 'none|1|4px|solid' })).toBe(0);
	});
});

describe('diffStyles / pickByStyleDiff', () => {
	const focusedImage = { ...NEUTRAL, transform: 'matrix(1.1, 0, 0, 1.1, 0, 0)', after: 'block|1|4px|solid' };

	it('스타일이 바뀐 요소만 돌려준다', () => {
		const prev = state({ styles: { [IMAGE]: NEUTRAL, [OTHER]: NEUTRAL } });
		const next = state({ styles: { [IMAGE]: focusedImage, [OTHER]: NEUTRAL } });
		expect(diffStyles(prev, next).map((c) => c.path)).toEqual([IMAGE]);
	});

	it('강조가 생긴 요소를 고르고, 강조가 사라진 요소는 무시한다', () => {
		const prev = state({ styles: { [IMAGE]: NEUTRAL, [OTHER]: focusedImage } });
		const next = state({ styles: { [IMAGE]: focusedImage, [OTHER]: NEUTRAL } });
		expect(pickByStyleDiff(prev, next).path).toBe(IMAGE);
	});

	it('가까운 여러 요소가 함께 강조되면 공통 조상을 고른다', () => {
		const prev = state({ styles: { [CARD]: NEUTRAL, [IMAGE]: NEUTRAL } });
		const next = state({ styles: { [CARD]: { ...NEUTRAL, boxShadow: 'x' }, [IMAGE]: focusedImage } });
		expect(pickByStyleDiff(prev, next).path).toBe(CARD);
	});

	it('멀리 떨어진 요소들이 강조되면 가장 크게 오른 요소를 고른다', () => {
		const prev = state({ styles: { [IMAGE]: NEUTRAL, [FAR]: NEUTRAL } });
		const next = state({ styles: { [IMAGE]: focusedImage, [FAR]: { ...NEUTRAL, boxShadow: 'x' } } });
		expect(pickByStyleDiff(prev, next).path).toBe(IMAGE);
	});

	it('이전 상태에 없던 요소는 비교하지 않는다', () => {
		const prev = state({ styles: {} });
		const next = state({ styles: { [IMAGE]: focusedImage } });
		expect(pickByStyleDiff(prev, next)).toEqual({ path: null, gainedCount: 0 });
	});

	it('스크롤로 transform 이동만 바뀌면 강조로 보지 않는다', () => {
		const prev = state({ styles: { [CARD]: { ...NEUTRAL, transform: 'matrix(1, 0, 0, 1, 0, 0)' } } });
		const next = state({ styles: { [CARD]: { ...NEUTRAL, transform: 'matrix(1, 0, 0, 1, -528, 0)' } } });
		expect(pickByStyleDiff(prev, next).path).toBeNull();
	});
});
