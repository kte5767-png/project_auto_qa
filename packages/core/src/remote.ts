/**
 * 리모컨 키. 실기기(SSAP 버튼)와 시뮬레이터(CDP 키 이벤트)가 같은 이름을 쓴다.
 * 플랫폼별 키 코드는 프로젝트 프로필(TV 프로필)에서 고른다 (D-014).
 */
export const REMOTE_KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'BACK', 'HOME'] as const;
export type RemoteKey = (typeof REMOTE_KEYS)[number];

export function isRemoteKey(value: string): value is RemoteKey {
	return (REMOTE_KEYS as readonly string[]).includes(value);
}

/**
 * "RIGHT*4 DOWN*3 LEFT" 같은 문자열을 키 목록으로 바꾼다.
 * 공백·쉼표로 구분하고, `*n`으로 반복 횟수를 지정한다.
 */
export function parseKeySequence(text: string): RemoteKey[] {
	const keys: RemoteKey[] = [];
	for (const token of text.split(/[\s,]+/).filter(Boolean)) {
		const match = /^([A-Za-z]+)(?:\*(\d+))?$/.exec(token);
		const name = match?.[1]?.toUpperCase() ?? '';
		if (match === null || !isRemoteKey(name)) {
			throw new Error(`알 수 없는 키: ${token}`);
		}
		const count = match[2] === undefined ? 1 : Number(match[2]);
		if (count < 1 || count > 100) {
			throw new Error(`반복 횟수는 1~100이어야 합니다: ${token}`);
		}
		for (let i = 0; i < count; i++) keys.push(name);
	}
	return keys;
}

/** 페이지에 보내는 키 이벤트 정의 */
export interface KeyDef {
	/** KeyboardEvent.keyCode (= CDP windowsVirtualKeyCode) */
	keyCode: number;
	/** KeyboardEvent.key */
	key: string;
}

/** null은 "페이지 키 이벤트로는 보낼 수 없는 시스템 키"(예: webOS HOME). 실기기 SSAP로만 보낸다. */
export type KeyMap = Record<RemoteKey, KeyDef | null>;

/** webOS 리모컨 (Back = 461). HOME은 시스템이 처리하므로 페이지 키 이벤트가 없다. */
export const WEBOS_KEY_MAP: KeyMap = {
	UP: { keyCode: 38, key: 'ArrowUp' },
	DOWN: { keyCode: 40, key: 'ArrowDown' },
	LEFT: { keyCode: 37, key: 'ArrowLeft' },
	RIGHT: { keyCode: 39, key: 'ArrowRight' },
	OK: { keyCode: 13, key: 'Enter' },
	BACK: { keyCode: 461, key: 'GoBack' },
	HOME: null
};

export interface CdpKeyEvent {
	type: 'rawKeyDown' | 'keyUp';
	windowsVirtualKeyCode: number;
	nativeVirtualKeyCode: number;
	key: string;
}

/** CDP Input.dispatchKeyEvent로 보낼 keydown/keyup 쌍. key와 keyCode를 함께 맞춘다 (설계 7.7). */
export function cdpKeyEvents(def: KeyDef): [CdpKeyEvent, CdpKeyEvent] {
	const base = { windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, key: def.key };
	return [
		{ type: 'rawKeyDown', ...base },
		{ type: 'keyUp', ...base }
	];
}
