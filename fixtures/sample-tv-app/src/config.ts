import { ALL_DEFECT_IDS } from './defects';

export type FocusMode = 'spotlight' | 'class';

export interface SampleConfig {
	/** spotlight: Enact Spotlight(실제 DOM 포커스), class: CSS 클래스 가상 포커스 */
	focusMode: FocusMode;
	/** 리모컨 Back 키 코드. webOS 기본값 461 */
	backKeyCode: number;
	/** 켜진 결함 id */
	defects: ReadonlySet<string>;
}

export const DEFAULT_BACK_KEY_CODE = 461;

export class ConfigError extends Error {
	override name = 'ConfigError';
}

/**
 * URL 쿼리 문자열을 설정으로 바꾼다.
 * - focus: spotlight(기본) | class
 * - back: 양의 정수 키 코드 (기본 461)
 * - defects: none(기본) | all | D01,D03 …
 */
export function parseConfig(search: string, knownDefectIds: readonly string[] = ALL_DEFECT_IDS): SampleConfig {
	const params = new URLSearchParams(search);

	const focusRaw = params.get('focus') ?? 'spotlight';
	if (focusRaw !== 'spotlight' && focusRaw !== 'class') {
		throw new ConfigError(`focus 값이 올바르지 않습니다: ${focusRaw} (spotlight | class)`);
	}

	const backRaw = params.get('back');
	let backKeyCode = DEFAULT_BACK_KEY_CODE;
	if (backRaw !== null) {
		if (!/^\d+$/.test(backRaw) || Number(backRaw) <= 0) {
			throw new ConfigError(`back 값은 양의 정수 키 코드여야 합니다: ${backRaw}`);
		}
		backKeyCode = Number(backRaw);
	}
	if ([13, 37, 38, 39, 40].includes(backKeyCode)) {
		throw new ConfigError(`back 키 코드는 OK·방향키와 겹칠 수 없습니다: ${backKeyCode}`);
	}

	const defectsRaw = (params.get('defects') ?? 'none').trim();
	let defects: Set<string>;
	if (defectsRaw === '' || defectsRaw === 'none') {
		defects = new Set();
	} else if (defectsRaw === 'all') {
		defects = new Set(knownDefectIds);
	} else {
		const ids = defectsRaw.split(',').map((s) => s.trim().toUpperCase());
		const unknown = ids.filter((id) => !knownDefectIds.includes(id));
		if (unknown.length > 0) {
			throw new ConfigError(`알 수 없는 결함 id: ${unknown.join(', ')}`);
		}
		defects = new Set(ids);
	}

	return { focusMode: focusRaw, backKeyCode, defects };
}

/**
 * webOS 앱 실행 인자를 쿼리 문자열로 바꾼다. TV에 설치한 샘플 앱은 URL 쿼리 대신
 * `ares-launch --params "{'focus':'class','defects':'none'}"`로 설정을 받는다.
 * 실행 인자는 JSON 문자열(PalmSystem.launchParams / webOSSystem.launchParams) 또는 객체다.
 * focus·back·defects만 옮기고, 해석할 수 없으면 빈 문자열(기본값)을 돌려준다.
 */
export function launchParamsToSearch(raw: unknown): string {
	let value: unknown = raw;
	if (typeof raw === 'string') {
		if (raw.trim() === '') return '';
		try {
			value = JSON.parse(raw);
		} catch {
			return '';
		}
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
	const params = new URLSearchParams();
	for (const key of ['focus', 'back', 'defects']) {
		const v = (value as Record<string, unknown>)[key];
		if (typeof v === 'string' || typeof v === 'number') params.set(key, String(v));
	}
	const text = params.toString();
	return text === '' ? '' : `?${text}`;
}
