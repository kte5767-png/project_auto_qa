import { pageExpression } from '@auto-qa/core';
import type { RemoteKey, ScriptRunner } from '@auto-qa/core';

/**
 * 화면 지문 (D-039): "처음 화면"을 기억해 두었다가 BACK으로 돌아올 때 같은 화면인지 비교한다.
 * 앱마다 다른 키 순서를 코드에 두지 않고, 지문 비교 + 겹친 층(팝업) 처리 규칙으로 돌아온다.
 * 페이지 스크립트는 값만 읽고, 같은지·다음에 누를 키는 아래 순수 함수가 정한다.
 */

export interface FingerprintOptions {
	/** 포커스를 받을 수 있는 요소 */
	focusables: string;
	/** 겹친 층(팝업·대화상자·토스트) */
	layers: string;
	/** 포커스 요소 선택자 (없으면 document.activeElement) */
	focusSelector: string | null;
	/** 이름 → 선택자. 포커스가 어느 영역(GNB 등)에 있는지 본다 */
	regions: Record<string, string>;
	/** 지문에 담는 요소 수 상한 */
	maxItems: number;
}

export const DEFAULT_FINGERPRINT_OPTIONS: FingerprintOptions = {
	focusables: '[data-spotlight-id], .spottable, button, a[href], input, [tabindex]:not([tabindex="-1"])',
	layers: '#floatLayer > *, [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
	focusSelector: null,
	regions: {},
	maxItems: 300
};

export interface FingerprintLayer {
	key: string;
	/** 포커스가 이 층 안에 있는가 (팝업) — 없으면 토스트처럼 포커스 없는 층 */
	hasFocus: boolean;
}

export interface ScreenFingerprint {
	/** 보이는 포커스 가능 요소의 이름 (data-spotlight-id → id → 태그.첫 클래스). 같은 이름은 여러 번 */
	items: string[];
	/** 포커스 요소 이름 */
	focus: string | null;
	/** 포커스가 들어 있는 영역 이름 (options.regions) */
	focusRegion: string | null;
	layers: FingerprintLayer[];
	errors: string[];
}

/** 페이지 안에서 실행된다. ES2017만 (`?.`·`??` 금지), 바깥 변수를 쓰지 않는다 */
function fingerprintInPage(o: FingerprintOptions): ScreenFingerprint {
	const errors: string[] = [];
	const all = (selector: string): Element[] => {
		try {
			return Array.prototype.slice.call(document.querySelectorAll(selector)) as Element[];
		} catch (e) {
			errors.push('선택자 오류 ' + selector + ' (' + String(e) + ')');
			return [];
		}
	};
	const visible = (el: Element): boolean => {
		const r = el.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return false;
		if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return false;
		const cs = window.getComputedStyle(el);
		return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
	};
	const nameOf = (el: Element): string => {
		const sid = el.getAttribute('data-spotlight-id');
		if (sid !== null && sid !== '') return sid;
		if (el.id !== '') return '#' + el.id;
		const cls = el.classList.length > 0 ? '.' + el.classList[0] : '';
		return el.tagName.toLowerCase() + cls;
	};
	let focusEl: Element | null = null;
	if (o.focusSelector !== null) {
		const found = all(o.focusSelector);
		focusEl = found.length === 1 ? (found[0] as Element) : null;
	} else {
		const a = document.activeElement;
		focusEl = a === null || a === document.body || a === document.documentElement ? null : a;
	}
	const items: string[] = [];
	const seen: Element[] = [];
	const list = all(o.focusables);
	for (let i = 0; i < list.length && items.length < o.maxItems; i++) {
		const el = list[i] as Element;
		if (seen.indexOf(el) >= 0 || !visible(el)) continue;
		seen.push(el);
		items.push(nameOf(el));
	}
	items.sort();
	let focusRegion: string | null = null;
	if (focusEl !== null) {
		const names = Object.keys(o.regions);
		for (let i = 0; i < names.length && focusRegion === null; i++) {
			const name = names[i] as string;
			const regions = all(o.regions[name] as string);
			for (let j = 0; j < regions.length; j++) {
				const r = regions[j] as Element;
				if (r === focusEl || r.contains(focusEl)) {
					focusRegion = name;
					break;
				}
			}
		}
	}
	// 겹친 층: 다른 층 안에 든 것은 바깥 층 하나로 본다
	const layerEls = all(o.layers).filter(visible);
	const outer = layerEls.filter((el) => {
		for (let j = 0; j < layerEls.length; j++) {
			const other = layerEls[j] as Element;
			if (other !== el && other.contains(el)) return false;
		}
		return true;
	});
	const layers: FingerprintLayer[] = outer.map((el) => ({
		key: nameOf(el),
		hasFocus: focusEl !== null && (el === focusEl || el.contains(focusEl))
	}));
	return {
		items,
		focus: focusEl === null ? null : nameOf(focusEl),
		focusRegion,
		layers,
		errors
	};
}

export function fingerprintScript(options: Partial<FingerprintOptions> = {}): string {
	return pageExpression(fingerprintInPage, { ...DEFAULT_FINGERPRINT_OPTIONS, ...options });
}

export function takeFingerprint(
	runner: ScriptRunner,
	options: Partial<FingerprintOptions> = {}
): Promise<ScreenFingerprint> {
	return runner.evaluate<ScreenFingerprint>(fingerprintScript(options));
}

// ── 비교·다음 키 (순수 함수) ────────────────────────────

/** 두 이름 목록의 다중집합 Jaccard (0~1) */
export function itemSimilarity(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 && b.length === 0) return 1;
	const count = (xs: readonly string[]): Map<string, number> => {
		const m = new Map<string, number>();
		for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
		return m;
	};
	const ca = count(a);
	const cb = count(b);
	let inter = 0;
	let union = 0;
	for (const k of new Set([...ca.keys(), ...cb.keys()])) {
		const x = ca.get(k) ?? 0;
		const y = cb.get(k) ?? 0;
		inter += Math.min(x, y);
		union += Math.max(x, y);
	}
	return union === 0 ? 1 : inter / union;
}

export interface HomeMatchOptions {
	/** 같은 화면으로 보는 요소 유사도 (콘텐츠가 바뀌어도 같은 화면) */
	minSimilarity: number;
}

export const DEFAULT_HOME_MATCH: HomeMatchOptions = { minSimilarity: 0.7 };

export interface HomeMatch {
	same: boolean;
	similarity: number;
	reason: string;
}

/**
 * 지금 화면이 처음 화면과 같은가: 요소 유사도가 기준 이상이고, 처음 화면보다 겹친 층이 많지 않으며,
 * 포커스가 처음 화면에 없던 영역(GNB 펼침 등)에 있지 않을 것.
 */
export function matchHome(
	home: ScreenFingerprint,
	now: ScreenFingerprint,
	options: HomeMatchOptions = DEFAULT_HOME_MATCH
): HomeMatch {
	const similarity = itemSimilarity(home.items, now.items);
	const r = Math.round(similarity * 100) / 100;
	if (now.layers.length > home.layers.length)
		return { same: false, similarity, reason: `겹친 층 ${now.layers.length}개(처음 ${home.layers.length}개)` };
	if (now.focusRegion !== null && now.focusRegion !== home.focusRegion)
		return { same: false, similarity, reason: `포커스가 ${now.focusRegion}에 있음` };
	if (similarity < options.minSimilarity) return { same: false, similarity, reason: `요소 유사도 ${r}` };
	return { same: true, similarity, reason: `요소 유사도 ${r}` };
}

export interface ResetRules {
	/** 화면을 거슬러 올라가는 키 (기본 BACK) */
	backKey: RemoteKey;
	/** 포커스가 들어간 팝업을 닫는 키 (기본 BACK — 팝업의 취소. OK는 쓰지 않는다: 종료 팝업의 기본 버튼이 "나가기") */
	closePopupKey: RemoteKey;
	/** 영역 이름 → 그 영역에서 화면으로 나오는 키 (예: GNB → RIGHT) */
	regionExit: Record<string, RemoteKey>;
	/** 되돌리기 중 누르지 않는 키 (기본 OK) */
	forbidden: RemoteKey[];
}

export const DEFAULT_RESET_RULES: ResetRules = {
	backKey: 'BACK',
	closePopupKey: 'BACK',
	regionExit: {},
	forbidden: ['OK']
};

export type ResetStep =
	| { kind: 'done'; reason: string }
	| { kind: 'press'; key: RemoteKey; reason: string; closes: 'popup' | 'region' | null }
	/** 포커스 없는 층(토스트 등): BACK을 누르면 앱이 꺼질 수 있어 사라질 때까지 기다린다 */
	| { kind: 'wait'; reason: string }
	/** 키로는 못 돌아온다 (앱이 꺼짐, 최상위를 두 번 지나도 처음 화면이 아님, 금지 키만 남음) → 앱을 다시 연다 */
	| { kind: 'relaunch'; reason: string };

export interface ResetState {
	/**
	 * 최상위에 닿은 횟수: 종료 팝업을 닫았거나, 종료 토스트가 떴거나, BACK을 눌러도 화면이 그대로였다
	 * (앱이 더 올라갈 곳이 없다는 신호)
	 */
	top: number;
}

/** 키를 누르기 전후 지문이 같은가 (BACK 반응 없음 = 최상위) */
/**
 * now에는 있고 base에는 없는 요소 이름 (같은 이름은 개수로 셈). 앞 단계가 남긴 상태(최근 검색어 등)로
 * 화면에 새로 생긴 요소를 찾는 데 쓴다 (D-043 ②)
 */
export function addedItems(base: readonly string[], now: readonly string[]): string[] {
	const left = new Map<string, number>();
	for (const x of base) left.set(x, (left.get(x) ?? 0) + 1);
	const added: string[] = [];
	for (const x of now) {
		const n = left.get(x) ?? 0;
		if (n > 0) left.set(x, n - 1);
		else added.push(x);
	}
	return added;
}

export function sameFingerprint(a: ScreenFingerprint, b: ScreenFingerprint): boolean {
	return (
		a.focus === b.focus &&
		a.focusRegion === b.focusRegion &&
		a.layers.length === b.layers.length &&
		itemSimilarity(a.items, b.items) === 1
	);
}

/**
 * 처음 화면으로 가는 다음 한 걸음 (D-039). 키 순서를 정해 두지 않고 지금 화면만 보고 고른다.
 * ① 처음 화면과 같으면 끝 ② 포커스가 든 새 팝업(종료 팝업 등) → 닫기 키(OK는 누르지 않음)
 * ③ 포커스 없는 새 층(종료 토스트 등) → BACK을 또 누르면 앱이 꺼질 수 있으므로 누르지 않는다:
 *    포커스가 나가기 키가 있는 영역(GNB)에 있으면 그 키, 아니면 기다림
 * ④ 최상위에 닿은 뒤 포커스가 처음 화면에 없던 영역(GNB 펼침)에 있으면 그 영역의 나가기 키
 * ⑤ 최상위를 두 번 지나도 처음 화면이 아니면 다시 열기 ⑥ 그 밖은 BACK (GNB 안에서도 BACK — 홈 메뉴로 간다)
 */
export function nextResetStep(
	home: ScreenFingerprint,
	now: ScreenFingerprint,
	state: ResetState,
	rules: ResetRules = DEFAULT_RESET_RULES,
	match: HomeMatchOptions = DEFAULT_HOME_MATCH
): ResetStep {
	const allowed = (key: RemoteKey): boolean => rules.forbidden.indexOf(key) < 0;
	if (now.items.length === 0 && now.focus === null)
		return { kind: 'relaunch', reason: '앱 화면이 비어 있음 (앱이 꺼졌거나 로딩 중)' };
	const m = matchHome(home, now, match);
	if (m.same) return { kind: 'done', reason: `처음 화면 (${m.reason})` };
	const region = now.focusRegion !== null && now.focusRegion !== home.focusRegion ? now.focusRegion : null;
	const exit = region === null ? undefined : rules.regionExit[region];
	const canExit = exit !== undefined && allowed(exit);
	const extra = now.layers.length > home.layers.length;
	if (extra && now.layers.some((l) => l.hasFocus)) {
		return allowed(rules.closePopupKey)
			? { kind: 'press', key: rules.closePopupKey, reason: '새 팝업에 포커스 → 닫기', closes: 'popup' }
			: { kind: 'relaunch', reason: '팝업을 닫을 키가 금지됨' };
	}
	if (extra) {
		return canExit
			? {
					kind: 'press',
					key: exit,
					reason: `포커스 없는 층이 떠 있음(종료 토스트 등) → ${region ?? ''}에서 나가기`,
					closes: 'region'
				}
			: {
					kind: 'wait',
					reason: '포커스 없는 층(종료 토스트 등)이 떠 있음 → BACK을 누르지 않고 사라질 때까지 기다림'
				};
	}
	if (state.top >= 2) return { kind: 'relaunch', reason: `최상위를 두 번 지났지만 처음 화면이 아님 (${m.reason})` };
	if (state.top > 0 && canExit)
		return { kind: 'press', key: exit, reason: `최상위까지 옴 → ${region ?? ''}에서 나가기`, closes: 'region' };
	return allowed(rules.backKey)
		? { kind: 'press', key: rules.backKey, reason: `처음 화면 아님 (${m.reason}) → 뒤로`, closes: null }
		: { kind: 'relaunch', reason: '뒤로 키가 금지됨' };
}
