import { describe, expect, it } from 'vitest';
import { commonAncestor, depth, isAncestor, isSelfOrAncestor } from './paths';

const CARD = 'body>div:nth-of-type(1)>section:nth-of-type(2)>div:nth-of-type(1)';
const IMAGE = `${CARD}>div:nth-of-type(1)`;
const TITLE = `${CARD}>div:nth-of-type(2)`;

describe('paths', () => {
	it('조상 관계를 판단한다', () => {
		expect(isAncestor(CARD, IMAGE)).toBe(true);
		expect(isAncestor(IMAGE, CARD)).toBe(false);
		expect(isAncestor(CARD, CARD)).toBe(false);
		expect(isSelfOrAncestor(CARD, CARD)).toBe(true);
	});

	it('이름이 겹치는 형제를 조상으로 착각하지 않는다', () => {
		expect(isAncestor('body>div:nth-of-type(1)', 'body>div:nth-of-type(10)')).toBe(false);
	});

	it('공통 조상을 찾는다', () => {
		expect(commonAncestor([IMAGE, TITLE])).toBe(CARD);
		expect(commonAncestor([IMAGE])).toBe(IMAGE);
		expect(commonAncestor([])).toBeNull();
	});

	it('깊이를 센다', () => {
		expect(depth('body')).toBe(1);
		expect(depth(IMAGE)).toBe(5);
	});
});
