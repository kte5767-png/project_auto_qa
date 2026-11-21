import { describe, expect, it } from 'vitest';
import { StyleDiffTracker, readActiveElement, readEnactSpotlight, readSelector } from './adapters';
import { NEUTRAL, el, state } from './testUtils';

const A = 'body>div:nth-of-type(1)';
const B = 'body>div:nth-of-type(2)';

describe('readActiveElement', () => {
	it('activeElement 경로를 돌려준다', () => {
		expect(readActiveElement(state({ active: el(A) })).path).toBe(A);
		expect(readActiveElement(state()).path).toBeNull();
	});
});

describe('readEnactSpotlight', () => {
	it('.spottable 요소에 포커스가 있을 때만 인정한다', () => {
		expect(readEnactSpotlight(state({ active: el(A, ['spottable']) })).path).toBe(A);
		expect(readEnactSpotlight(state({ active: el(A, ['input']) })).path).toBeNull();
	});
});

describe('readSelector', () => {
	it('선택자에 맞는 요소가 하나일 때만 인정한다', () => {
		expect(readSelector(state({ selectorMatches: [el(A)] })).path).toBe(A);
		expect(readSelector(state({ selectorMatches: [el(A), el(B)] })).path).toBeNull();
		expect(readSelector(state()).path).toBeNull();
	});
});

describe('StyleDiffTracker', () => {
	const focused = { ...NEUTRAL, boxShadow: 'rgb(255, 255, 255) 0px 0px 0px 4px' };

	it('첫 상태는 판단하지 않고, 이후 강조가 옮겨간 요소를 따라간다', () => {
		const tracker = new StyleDiffTracker();
		expect(tracker.update(state({ styles: { [A]: focused, [B]: NEUTRAL } })).path).toBeNull();
		const moved = state({ styles: { [A]: NEUTRAL, [B]: focused }, elements: { [B]: el(B) } });
		const reading = tracker.update(moved);
		expect(reading.path).toBe(B);
		expect(reading.element?.path).toBe(B);
	});

	it('키가 반응하지 않아 변화가 없으면 직전 판단을 유지한다', () => {
		const tracker = new StyleDiffTracker();
		tracker.update(state({ styles: { [A]: focused, [B]: NEUTRAL } }));
		tracker.update(state({ styles: { [A]: NEUTRAL, [B]: focused } }));
		expect(tracker.update(state({ styles: { [A]: NEUTRAL, [B]: focused } })).path).toBe(B);
	});
});
