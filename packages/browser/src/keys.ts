/** 리모컨 키와 플랫폼별 키 코드 매핑. 매핑은 프로젝트 프로필(TV 프로필)에서 고른다 (D-014). */
export const REMOTE_KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'BACK'] as const;
export type RemoteKey = (typeof REMOTE_KEYS)[number];

export interface KeyDef {
	/** KeyboardEvent.keyCode (= CDP windowsVirtualKeyCode) */
	keyCode: number;
	/** KeyboardEvent.key */
	key: string;
}

export type KeyMap = Record<RemoteKey, KeyDef>;

/** webOS 리모컨 (Back = 461) */
export const WEBOS_KEY_MAP: KeyMap = {
	UP: { keyCode: 38, key: 'ArrowUp' },
	DOWN: { keyCode: 40, key: 'ArrowDown' },
	LEFT: { keyCode: 37, key: 'ArrowLeft' },
	RIGHT: { keyCode: 39, key: 'ArrowRight' },
	OK: { keyCode: 13, key: 'Enter' },
	BACK: { keyCode: 461, key: 'GoBack' }
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

function isRemoteKey(value: string): value is RemoteKey {
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
