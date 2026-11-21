import { NAV_ATTR, navSelector } from './engine';
import type { FocusEngine, FocusListener } from './engine';
import { findNext, keyCodeToDirection } from './spatial';
import type { NavCandidate } from './spatial';

/**
 * CSS 클래스 방식 가상 포커스. 실제 DOM 포커스를 옮기지 않으므로 document.activeElement는 body에 머문다.
 * 현재 포커스 id만 관리하고, `focused` 클래스는 React 렌더링에서 붙인다.
 */
export function createClassEngine(root: HTMLElement): FocusEngine {
	let currentId: string | null = null;
	const listeners = new Set<FocusListener>();

	const notify = (): void => {
		for (const listener of listeners) listener(currentId);
	};

	const elementOf = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(navSelector(id));

	const candidates = (): NavCandidate[] =>
		Array.from(root.querySelectorAll<HTMLElement>(`[${NAV_ATTR}]`)).flatMap((el) => {
			const id = el.getAttribute(NAV_ATTR);
			if (id === null || id === currentId) return [];
			const r = el.getBoundingClientRect();
			return [{ id, box: { left: r.left, top: r.top, width: r.width, height: r.height } }];
		});

	const onKeyDown = (event: KeyboardEvent): void => {
		const direction = keyCodeToDirection(event.keyCode);
		if (direction === null || currentId === null) return;
		const el = elementOf(currentId);
		if (el === null) return;
		event.preventDefault();
		const r = el.getBoundingClientRect();
		const next = findNext({ left: r.left, top: r.top, width: r.width, height: r.height }, candidates(), direction);
		if (next !== null) {
			currentId = next;
			notify();
		}
	};

	return {
		mode: 'class',
		start() {
			window.addEventListener('keydown', onKeyDown);
		},
		stop() {
			window.removeEventListener('keydown', onKeyDown);
		},
		focus(id) {
			if (elementOf(id) === null) return false;
			currentId = id;
			notify();
			return true;
		},
		blur() {
			currentId = null;
			notify();
		},
		current() {
			return currentId;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}
