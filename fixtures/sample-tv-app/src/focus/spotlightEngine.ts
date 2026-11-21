import { Spotlight } from '@enact/spotlight';
import { NAV_ATTR, navSelector } from './engine';
import type { FocusEngine, FocusListener } from './engine';

/**
 * Enact Spotlight 방식. 실제 `@enact/spotlight`가 `.spottable` 요소 사이에서 실제 DOM 포커스를 옮긴다.
 * (대상 앱 lg_travel_service_app과 같은 방식, D-013)
 */
export function createSpotlightEngine(root: HTMLElement): FocusEngine {
	const listeners = new Set<FocusListener>();

	const idOf = (el: Element | null): string | null => (el instanceof HTMLElement ? el.getAttribute(NAV_ATTR) : null);

	const notify = (id: string | null): void => {
		for (const listener of listeners) listener(id);
	};

	const onFocusIn = (event: FocusEvent): void => {
		notify(idOf(event.target as Element | null));
	};

	const onFocusOut = (event: FocusEvent): void => {
		if (event.relatedTarget === null) notify(null);
	};

	return {
		mode: 'spotlight',
		start() {
			Spotlight.initialize({ selector: '.spottable' });
			Spotlight.setPointerMode(false);
			root.addEventListener('focusin', onFocusIn);
			root.addEventListener('focusout', onFocusOut);
		},
		stop() {
			root.removeEventListener('focusin', onFocusIn);
			root.removeEventListener('focusout', onFocusOut);
			Spotlight.terminate();
		},
		focus(id) {
			const el = root.querySelector<HTMLElement>(navSelector(id));
			if (el === null) return false;
			return Spotlight.focus(el) === true;
		},
		blur() {
			const current = Spotlight.getCurrent();
			if (current instanceof HTMLElement) current.blur();
		},
		current() {
			return idOf(Spotlight.getCurrent());
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}
