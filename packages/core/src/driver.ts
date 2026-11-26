import type { RemoteKey } from './remote';

/**
 * 드라이버 공통 인터페이스 (설계 4장). 실기기(`@auto-qa/device-webos`)와
 * 시뮬레이터(`@auto-qa/browser`)가 같은 인터페이스를 구현하고, 그 위의 패키지는 실행 환경을 모른다.
 */

/** 페이지 안 스크립트 실행기. expression은 값(또는 Promise)을 돌려주는 JS 식이며, 결과는 JSON으로 직렬화 가능해야 한다. */
export interface ScriptRunner {
	evaluate<T>(expression: string): Promise<T>;
}

export interface StableOptions {
	/** DOM 변경·애니메이션이 이 시간 동안 없으면 안정 상태로 본다 (ms) */
	quietMs: number;
	/** 최대 대기 시간. 넘으면 stable=false로 끝낸다 (ms) */
	timeoutMs: number;
	/**
	 * 실행 중인 애니메이션을 직접 볼 수 없는 구형 엔진(`document.getAnimations` 없음, Chromium 84 미만)에서 쓰는 정지 시간.
	 * CSS 전환이 끝나기 전에 안정으로 판단하지 않도록 quietMs보다 길게 잡는다 (ms)
	 */
	legacyQuietMs: number;
	/**
	 * 이 선택자 안의 DOM 변경·애니메이션은 무시한다 (흐르는 글자(마키)처럼 포커스된 동안 끝없이 움직이는 요소).
	 * 빈 문자열이면 무시하지 않는다
	 */
	ignore: string;
}

export const DEFAULT_STABLE_OPTIONS: StableOptions = {
	quietMs: 120,
	timeoutMs: 3000,
	legacyQuietMs: 400,
	ignore: '[class*="marquee"], [class*="Marquee"]'
};

export interface StableResult {
	stable: boolean;
	waitedMs: number;
	/** animations: getAnimations로 실행 중 애니메이션 확인 / legacy: 이벤트와 긴 정지 시간으로 대신 판단 */
	mode: 'animations' | 'legacy';
}

export interface ScreenshotOptions {
	type: 'png' | 'jpeg';
	/** jpeg 품질 0~100 */
	quality?: number;
}

export interface Driver extends ScriptRunner {
	readonly kind: 'webos' | 'browser';
	/** 리모컨 키 한 번. 이 환경에서 보낼 수 없는 키면 UnsupportedKeyError */
	pressKey(key: RemoteKey): Promise<void>;
	waitForStable(options?: StableOptions): Promise<StableResult>;
	/** 앱 화면 캡처 (시스템 UI는 포함하지 않는다) */
	screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
	close(): Promise<void>;
}

export class UnsupportedKeyError extends Error {
	override name = 'UnsupportedKeyError';
	constructor(
		readonly key: RemoteKey,
		readonly driverKind: Driver['kind'],
		detail: string
	) {
		super(`${driverKind} 드라이버에서 ${key} 키를 보낼 수 없습니다: ${detail}`);
	}
}
