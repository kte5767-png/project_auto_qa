import type { Rect } from '@auto-qa/core';
import { DEFAULT_KEYMAP_OPTIONS, parseKeyAction } from './keymap';
import type { KeyMapOptions, NavCallout, NavScreen } from './keymap';

/**
 * TC 문장 "화면 최상단 Default 포커스 항목에 포커스 이동"의 기대 위치 (Search!24·47).
 *
 * 근거 순서 (앱 상태가 아니라 TC·화면설계서에서 정한다):
 * 1. 화면설계서가 그 화면의 Default Focus를 적었고 콜아웃 이름을 가리키면 → 그 콜아웃
 *    (예: "Default Focus: Search field" → ①)
 * 2. 문장이나 Default Focus가 위치로만 말하면("최상단 … 항목", "좌측 상단 첫 번째 항목") →
 *    화면 맨 위 목록 콜아웃의 첫 항목. "항목"은 TC에서 목록 안의 한 칸을 부르는 말이고,
 *    맨 위 = 화면설계서 목업 위치(y, 같으면 x)가 가장 위, 위치가 없으면 콜아웃 번호가 가장 작은 것
 * 3. 둘 다 아니면 null (부르는 쪽이 진입 시 포커스로 판정)
 *
 * 목록 콜아웃(lists)은 앱 요소 목록에서 항목 선택자가 있는 콜아웃이다.
 */
export interface DefaultFocusTarget {
	/** 콜아웃 번호 */
	no: string;
	/** 목록이면 첫 항목([0])이어야 함 */
	firstItem: boolean;
	/** 리포트에 적을 근거 */
	basis: string;
}

/** 위치로 맨 위·첫 항목을 가리키는 말 */
const POSITION_WORDS = /최상단|상단|맨\s*위|첫\s*번째|처음/;

function top(a: Rect | null, b: Rect | null): number {
	if (a === null && b === null) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a.y - b.y || a.x - b.x;
}

/** 화면 맨 위 목록 콜아웃: 목업 위치가 가장 위(같으면 왼쪽), 위치가 없으면 번호 순 */
export function topmostList(screen: NavScreen, lists: ReadonlySet<string>): NavCallout | null {
	const candidates = screen.callouts.filter((c) => lists.has(c.no));
	const sorted = [...candidates].sort(
		(a, b) => top(a.rect, b.rect) || a.no.localeCompare(b.no, undefined, { numeric: true })
	);
	return sorted[0] ?? null;
}

export function defaultFocusTarget(
	screen: NavScreen,
	clauseText: string,
	declared: string | null,
	lists: ReadonlySet<string>,
	options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS
): DefaultFocusTarget | null {
	const spec = declared?.trim() ?? '';
	if (spec !== '') {
		const origin: NavCallout = { no: '', names: [], texts: [], rect: null, keys: {} };
		const action = parseKeyAction(origin, 'ok', spec, screen.callouts, options);
		if (action.effect.kind === 'move') {
			const no = action.effect.to;
			return {
				no,
				firstItem: lists.has(no) && action.effect.position === 'first',
				basis: `화면설계서 Default Focus "${spec}"`
			};
		}
	}
	const positional = POSITION_WORDS.test(clauseText) || POSITION_WORDS.test(spec);
	if (!positional) return null;
	const list = topmostList(screen, lists);
	if (list === null) return null;
	const where = `맨 위 목록(${list.names[0] ?? list.no})의 첫 항목`;
	return {
		no: list.no,
		firstItem: true,
		basis:
			spec === '' ? `화면설계서에 Default Focus가 없어 ${where}` : `화면설계서 Default Focus "${spec}" → ${where}`
	};
}
