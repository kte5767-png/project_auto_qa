declare module '@enact/spotlight' {
	interface SpotlightApi {
		initialize(containerDefaults?: { selector?: string; restrict?: string }): void;
		terminate(): void;
		focus(elem?: Element | string, options?: { enterTo?: string; preventScroll?: boolean }): boolean;
		getCurrent(): Element | null;
		setPointerMode(pointerMode: boolean): void;
		getPointerMode(): boolean;
	}
	/** CommonJS 모듈이라 기본 export 대신 이름 있는 export를 쓴다 */
	export const Spotlight: SpotlightApi;
}
