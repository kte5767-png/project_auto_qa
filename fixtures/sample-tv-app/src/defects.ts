import defectsJson from '../defects.json';

export const DEFECT_CATEGORIES = ['gui', 'focus', 'flow', 'spec'] as const;
export const SCREENS = ['home', 'detail', 'search'] as const;
export const REMOTE_KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'BACK'] as const;

export type DefectCategory = (typeof DEFECT_CATEGORIES)[number];
export type ScreenName = (typeof SCREENS)[number];
export type RemoteKey = (typeof REMOTE_KEYS)[number];

export interface DefectSpec {
	id: string;
	category: DefectCategory;
	screen: ScreenName;
	/** 채점용 data-testid. QA 서비스는 검출에 쓰지 않는다. */
	target: string;
	summary: string;
	expected: string;
	actual: string;
	/** 앱 시작 상태에서 이 결함만 켰을 때 결함이 드러나는 키 시퀀스 */
	reproKeys: RemoteKey[];
	/** 결함이 없을 때 reproKeys 이후 포커스가 있어야 하는 요소 (포커스·흐름 결함) */
	baselineFocus?: string;
}

export interface DefectsFile {
	version: number;
	defects: DefectSpec[];
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
	return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/** defects.json 구조를 검사하고 오류 메시지 목록을 돌려준다. 빈 배열이면 정상. */
export function validateDefectsFile(data: unknown): string[] {
	const errors: string[] = [];
	if (typeof data !== 'object' || data === null) {
		return ['최상위 값이 객체가 아닙니다.'];
	}
	const file = data as Record<string, unknown>;
	if (file['version'] !== 1) {
		errors.push('version은 1이어야 합니다.');
	}
	const defects = file['defects'];
	if (!Array.isArray(defects)) {
		return [...errors, 'defects가 배열이 아닙니다.'];
	}
	const seen = new Set<string>();
	defects.forEach((raw: unknown, index) => {
		const where = `defects[${index}]`;
		if (typeof raw !== 'object' || raw === null) {
			errors.push(`${where}: 객체가 아닙니다.`);
			return;
		}
		const d = raw as Record<string, unknown>;
		const id = d['id'];
		if (typeof id !== 'string' || !/^D\d{2}$/.test(id)) {
			errors.push(`${where}: id 형식은 D01 같은 형태여야 합니다.`);
		} else if (seen.has(id)) {
			errors.push(`${where}: id ${id}가 중복됩니다.`);
		} else {
			seen.add(id);
		}
		if (!includes(DEFECT_CATEGORIES, d['category'])) errors.push(`${where}: category가 올바르지 않습니다.`);
		if (!includes(SCREENS, d['screen'])) errors.push(`${where}: screen이 올바르지 않습니다.`);
		for (const key of ['target', 'summary', 'expected', 'actual'] as const) {
			if (typeof d[key] !== 'string' || (d[key] as string).length === 0) {
				errors.push(`${where}: ${key}가 비어 있습니다.`);
			}
		}
		const keys = d['reproKeys'];
		if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => includes(REMOTE_KEYS, k))) {
			errors.push(`${where}: reproKeys는 비어 있지 않은 리모컨 키 배열이어야 합니다.`);
		}
		if (d['baselineFocus'] !== undefined && typeof d['baselineFocus'] !== 'string') {
			errors.push(`${where}: baselineFocus는 문자열이어야 합니다.`);
		}
		if ((d['category'] === 'focus' || d['category'] === 'flow') && d['baselineFocus'] === undefined) {
			errors.push(`${where}: focus·flow 결함은 baselineFocus가 필요합니다.`);
		}
	});
	return errors;
}

export const DEFECTS: readonly DefectSpec[] = (defectsJson as DefectsFile).defects;
export const ALL_DEFECT_IDS: readonly string[] = DEFECTS.map((d) => d.id);
