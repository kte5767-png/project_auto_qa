import type { ElementInfo, FocusState, StyleSig } from './types';

/** 테스트용 상태 생성 도우미 */
export const NEUTRAL: StyleSig = {
	transform: 'none',
	outline: 'none|0px|rgb(0, 0, 0)',
	border: 'none|0px|rgb(0, 0, 0)',
	boxShadow: 'none',
	background: 'rgba(0, 0, 0, 0)',
	color: 'rgb(255, 255, 255)',
	opacity: '1',
	after: 'none',
	before: 'none'
};

export function el(path: string, classes: string[] = [], extra: Partial<ElementInfo> = {}): ElementInfo {
	return { path, tag: 'div', id: null, classes, spotlightId: null, rect: [0, 0, 100, 100], text: '', ...extra };
}

export function state(partial: Partial<FocusState> = {}): FocusState {
	return {
		active: null,
		spottableCount: 0,
		selectorMatches: [],
		classHolders: {},
		styles: {},
		elements: {},
		...partial
	};
}
