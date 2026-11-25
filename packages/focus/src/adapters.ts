import { pickByStyleDiff } from './styleDiff';
import type { FocusReading, FocusState } from './types';

/** document.activeElement를 포커스로 본다 */
export function readActiveElement(state: FocusState): FocusReading {
	return { adapter: 'active-element', path: state.active?.path ?? null, element: state.active };
}

/** Enact Spotlight: 실제 DOM 포커스가 `.spottable` 요소에 있을 때만 포커스로 본다 */
export function readEnactSpotlight(state: FocusState): FocusReading {
	const active = state.active;
	if (active === null || !active.classes.includes('spottable')) {
		return { adapter: 'enact-spotlight', path: null, element: null };
	}
	return { adapter: 'enact-spotlight', path: active.path, element: active };
}

/** 설정된 포커스 선택자(예: `.focused`)에 맞는 요소. 여러 개면 판단하지 않는다 */
export function readSelector(state: FocusState): FocusReading {
	const only = state.selectorMatches.length === 1 ? state.selectorMatches[0] : undefined;
	return { adapter: 'selector', path: only?.path ?? null, element: only ?? null };
}

/**
 * 스타일 변화 추적기. 이전 상태와 비교해 새로 강조된 요소를 포커스로 보고,
 * 아무것도 강조되지 않았으면 직전 판단을 유지한다 (키가 반응하지 않은 경우 등).
 */
export class StyleDiffTracker {
	private prev: FocusState | null = null;
	private lastPath: string | null = null;

	update(state: FocusState): FocusReading {
		if (this.prev !== null) {
			const pick = pickByStyleDiff(this.prev, state);
			if (pick.path !== null) this.lastPath = pick.path;
		}
		this.prev = state;
		const element = this.lastPath === null ? null : (state.elements[this.lastPath] ?? null);
		return { adapter: 'style-diff', path: this.lastPath, element };
	}
}
