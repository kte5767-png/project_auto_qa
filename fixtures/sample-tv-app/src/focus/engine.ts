import type { FocusMode } from '../config';

/** 포커스 가능한 요소에 붙는 속성. 앱 내부용이며 QA 서비스는 검출에 쓰면 안 된다. */
export const NAV_ATTR = 'data-sample-nav';

export type FocusListener = (id: string | null) => void;

/**
 * 포커스 방식(Enact Spotlight / CSS 클래스)을 감싸는 공통 인터페이스.
 * 방향키 처리는 엔진이 하고, OK·Back은 앱이 처리한다.
 */
export interface FocusEngine {
	readonly mode: FocusMode;
	start(): void;
	stop(): void;
	focus(id: string): boolean;
	blur(): void;
	current(): string | null;
	subscribe(listener: FocusListener): () => void;
}

export function navSelector(id: string): string {
	return `[${NAV_ATTR}="${CSS.escape(id)}"]`;
}
