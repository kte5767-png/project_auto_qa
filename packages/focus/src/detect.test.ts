import { describe, expect, it } from 'vitest';
import { detectFocusAdapters } from './detect';
import { NEUTRAL, el, state } from './testUtils';
import type { FocusState } from './types';

const P = (i: number): string => `body>div:nth-of-type(${i})`;
const RING = { ...NEUTRAL, boxShadow: 'rgb(255, 255, 255) 0px 0px 0px 4px' };

/** 포커스가 1 → 2 → 3 → 2 → 1로 움직이는 상태 목록 */
const ORDER = [1, 2, 3, 2, 1];

function spotlightStates(): FocusState[] {
	return ORDER.map((i) => state({ active: el(P(i), ['spottable']), spottableCount: 5 }));
}

function classStates(): FocusState[] {
	return ORDER.map((i) =>
		state({
			classHolders: { focused: [P(i)], selected: [P(9)], card: [P(1), P(2), P(3)] },
			styles: Object.fromEntries([1, 2, 3].map((n) => [P(n), n === i ? RING : NEUTRAL]))
		})
	);
}

describe('detectFocusAdapters', () => {
	it('Enact Spotlight 앱은 enact-spotlight를 1순위로 고른다', () => {
		const [top, second] = detectFocusAdapters(spotlightStates());
		expect(top?.adapter).toBe('enact-spotlight');
		expect(second?.adapter).toBe('active-element');
	});

	it('일반 DOM 포커스 앱은 active-element를 고른다', () => {
		const states = ORDER.map((i) => state({ active: el(P(i), ['btn']) }));
		expect(detectFocusAdapters(states)[0]?.adapter).toBe('active-element');
	});

	it('가상 포커스 앱은 움직이는 클래스를 선택자로 고르고, 움직이지 않는 클래스는 무시한다', () => {
		const candidates = detectFocusAdapters(classStates());
		expect(candidates[0]).toMatchObject({ adapter: 'selector', selector: '.focused' });
		expect(candidates.some((c) => c.selector === '.selected')).toBe(false);
		expect(candidates.some((c) => c.selector === '.card')).toBe(false);
	});

	it('스타일 변화는 낮은 신뢰도의 후보로 함께 제시한다', () => {
		const styleCandidate = detectFocusAdapters(classStates()).find((c) => c.adapter === 'style-diff');
		expect(styleCandidate?.confidence).toBeCloseTo(0.7);
	});

	it('포커스가 거의 움직이지 않으면 후보로 보지 않는다', () => {
		const stuck = ORDER.map(() => state({ active: el(P(1), ['spottable']), spottableCount: 5 }));
		expect(detectFocusAdapters(stuck)).toEqual([]);
	});

	it('상태가 2개 미만이면 빈 목록', () => {
		expect(detectFocusAdapters([state()])).toEqual([]);
	});
});
