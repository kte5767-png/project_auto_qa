import { pageExpression } from '@auto-qa/core';
import type { ScriptRunner } from '@auto-qa/core';

/**
 * 사람이 지정한 요소(콜아웃 ↔ 앱 요소 대응)를 선택자로 읽는다.
 * 포커스가 어느 요소·몇 번째 항목에 있는지, 요소가 보이는지, 글자와 항목 개수를 돌려준다.
 * 판정은 하지 않는다 — 값만 읽고 비교는 `@auto-qa/judge`가 한다.
 */
export interface ObserveTarget {
	/** 시나리오에서 부르는 이름 (예: "검색창") */
	name: string;
	/** CSS 선택자. 여러 요소가 맞으면 모두 이 요소의 일부로 본다 */
	selector: string;
	/** 이 글자를 포함하는 것만 (textContent, 공백 정리 후) */
	textIncludes: string | null;
	/** 목록 항목 선택자 (맞은 요소 안에서 찾음). 없으면 맞은 요소 자체가 항목 */
	items: string | null;
}

export interface ObservedFocus {
	tag: string;
	/** 가장 가까운 data-spotlight-id (Enact Spotlight 앱) */
	spotlightId: string | null;
	classes: string[];
	text: string;
	/** [x, y, width, height] */
	rect: [number, number, number, number];
	/**
	 * 켜짐·꺼짐 같은 상태 표시: 요소와 안쪽의 aria-checked·aria-pressed·aria-selected, 체크박스 checked, 클래스
	 * (움직임용 클래스 제외). 토글 판정에서 OK 전후를 비교한다
	 */
	state: string;
}

export interface ObservedTarget {
	name: string;
	/** 선택자에 맞은 요소 수 (보이지 않는 것 포함) */
	matched: number;
	/** 보이는 것 수 */
	visible: number;
	/** 보이는 요소의 글자. 안쪽 입력창의 값(없으면 placeholder)은 따로 한 줄 */
	texts: string[];
	/** 보이는 항목 수 */
	itemCount: number;
	itemTexts: string[];
	/** 포커스가 이 요소 안에 있는가 */
	hasFocus: boolean;
	/** 포커스가 있는 항목의 순번 (0부터, 보이는 항목 기준). 없으면 -1 */
	focusItem: number;
	/** 글자가 칸을 넘치는 요소 수와 그중 말줄임(text-overflow: ellipsis)인 수 */
	textOverflow: { overflowing: number; ellipsis: number };
	/** 처음 보이는 요소의 [x, y, width, height]. 보이는 것이 없으면 null */
	rect: [number, number, number, number] | null;
	/** 보이는 항목의 [x, y, width, height] (maxItems개까지) — 그리드 배치 판정용 */
	itemRects: [number, number, number, number][];
}

export interface ObserveOptions {
	/** 포커스 요소를 찾는 선택자 (CSS 클래스 방식 가상 포커스용). null이면 document.activeElement */
	focusSelector: string | null;
	/** 글자 하나의 최대 길이 */
	maxText: number;
	/** 요소 하나에서 돌려줄 최대 항목 글자 수 */
	maxItems: number;
	/** 상태 표시에서 뺄 클래스 (정규식 원문, 대소문자 무시) — 시간이 지나면 저절로 바뀌는 것 */
	stateIgnoreClass: string;
	/** 상태 표시에 넣을 최대 조각 수 */
	maxStateParts: number;
}

export const DEFAULT_OBSERVE_OPTIONS: ObserveOptions = {
	focusSelector: null,
	maxText: 120,
	maxItems: 30,
	stateIgnoreClass: 'marquee|animat|transition',
	maxStateParts: 40
};

export interface Observation {
	/** 포커스 요소. 없으면(body에 머묾) null */
	focus: ObservedFocus | null;
	targets: ObservedTarget[];
	/** 화면 크기 [width, height] (CSS 픽셀) */
	viewport: [number, number];
	/** 선택자 문법 오류 등 */
	errors: string[];
}

interface ObserveInput {
	targets: ObserveTarget[];
	options: ObserveOptions;
}

/**
 * 페이지 안에서 실행되는 함수. 소스가 그대로 직렬화되므로 바깥 변수·import를 쓰면 안 된다.
 * 실기기 구형 엔진(webOS 5.x, Chromium 68)에서도 돌도록 ES2017 문법만 쓴다 (`?.`·`??`·`:has()` 금지).
 */
function observeInPage(input: ObserveInput): Observation {
	const opts = input.options;
	const errors: string[] = [];
	const clean = (s: string | null): string => (s === null ? '' : s.replace(/\s+/g, ' ').trim());
	const cut = (s: string): string => (s.length > opts.maxText ? s.slice(0, opts.maxText) : s);
	const isVisible = (el: Element): boolean => {
		const r = el.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return false;
		const cs = window.getComputedStyle(el);
		return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
	};
	const fieldText = (el: Element): string =>
		el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
			? cut(clean(el.value !== '' ? el.value : el.placeholder))
			: '';
	const textOf = (el: Element): string => {
		const own = fieldText(el);
		if (own !== '') return own;
		return cut(clean(el instanceof HTMLElement ? el.innerText : el.textContent));
	};
	/** 보이는 글자 + 안쪽 입력창의 값(없으면 placeholder) */
	const textsOf = (el: Element): string[] => {
		const out: string[] = [];
		const add = (t: string): void => {
			if (t !== '' && out.indexOf(t) < 0) out.push(t);
		};
		add(textOf(el));
		const fields = el.querySelectorAll('input, textarea');
		for (let i = 0; i < fields.length; i++) add(fieldText(fields[i] as Element));
		return out;
	};
	const queryAll = (root: ParentNode, selector: string, where: string): Element[] => {
		try {
			return Array.prototype.slice.call(root.querySelectorAll(selector)) as Element[];
		} catch (e) {
			errors.push(where + ': 선택자 오류 ' + selector + ' (' + String(e) + ')');
			return [];
		}
	};

	let focusEl: Element | null = null;
	if (opts.focusSelector !== null) {
		const found = queryAll(document, opts.focusSelector, '포커스 선택자');
		focusEl = found.length === 1 ? (found[0] as Element) : null;
	} else {
		const a = document.activeElement;
		focusEl = a === null || a === document.body || a === document.documentElement ? null : a;
	}

	const rectOf = (el: Element): [number, number, number, number] => {
		const r = el.getBoundingClientRect();
		return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
	};
	const ignoreClass = new RegExp(opts.stateIgnoreClass, 'i');
	const stateOf = (el: Element): string => {
		const parts: string[] = [];
		const all = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')) as Element[]);
		const attrs = ['aria-checked', 'aria-pressed', 'aria-selected'];
		for (let i = 0; i < all.length && parts.length < opts.maxStateParts; i++) {
			const e = all[i] as Element;
			for (let j = 0; j < attrs.length; j++) {
				const v = e.getAttribute(attrs[j] as string);
				if (v !== null) parts.push(i + ':' + attrs[j] + '=' + v);
			}
			if (e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'radio')) {
				parts.push(i + ':checked=' + String(e.checked));
			}
			const cls = (Array.prototype.slice.call(e.classList) as string[]).filter((c) => !ignoreClass.test(c));
			if (cls.length > 0) parts.push(i + ':.' + cls.join('.'));
		}
		return parts.slice(0, opts.maxStateParts).join(' ');
	};

	let focus: ObservedFocus | null = null;
	if (focusEl !== null) {
		const r = focusEl.getBoundingClientRect();
		const holder = focusEl.closest('[data-spotlight-id]');
		focus = {
			tag: focusEl.tagName.toLowerCase(),
			spotlightId: holder === null ? null : holder.getAttribute('data-spotlight-id'),
			classes: Array.prototype.slice.call(focusEl.classList) as string[],
			text: textOf(focusEl),
			rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
			state: stateOf(focusEl)
		};
	}
	const contains = (el: Element): boolean => focusEl !== null && (el === focusEl || el.contains(focusEl));

	const targets: ObservedTarget[] = input.targets.map((t) => {
		let matches = queryAll(document, t.selector, t.name);
		if (t.textIncludes !== null) {
			const want = clean(t.textIncludes);
			matches = matches.filter((m) => clean(m.textContent).indexOf(want) >= 0);
		}
		const shown = matches.filter(isVisible);
		let items: Element[] = [];
		if (t.items === null) {
			items = shown;
		} else {
			for (const m of shown) {
				for (const it of queryAll(m, t.items, t.name + ' 항목')) {
					if (items.indexOf(it) < 0 && isVisible(it)) items.push(it);
				}
			}
		}
		let overflowing = 0;
		let ellipsis = 0;
		for (const m of shown) {
			const all = [m].concat(Array.prototype.slice.call(m.querySelectorAll('*')) as Element[]);
			for (const el of all) {
				let ownText = false;
				for (let i = 0; i < el.childNodes.length; i++) {
					const n = el.childNodes[i] as Node;
					if (n.nodeType === 3 && clean(n.textContent) !== '') ownText = true;
				}
				if (!ownText || !(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth + 1) continue;
				overflowing++;
				if (window.getComputedStyle(el).textOverflow === 'ellipsis') ellipsis++;
			}
		}
		let focusItem = -1;
		for (let i = 0; i < items.length; i++) {
			if (contains(items[i] as Element)) {
				focusItem = i;
				break;
			}
		}
		const first = shown.length > 0 ? (shown[0] as Element).getBoundingClientRect() : null;
		return {
			name: t.name,
			rect:
				first === null
					? null
					: [
							Math.round(first.left),
							Math.round(first.top),
							Math.round(first.width),
							Math.round(first.height)
						],
			matched: matches.length,
			visible: shown.length,
			texts: shown.reduce((all: string[], m) => all.concat(textsOf(m)), []),
			itemCount: items.length,
			itemTexts: items.slice(0, opts.maxItems).map(textOf),
			itemRects: items.slice(0, opts.maxItems).map(rectOf),
			hasFocus: matches.some(contains),
			focusItem,
			textOverflow: { overflowing, ellipsis }
		};
	});

	return { focus, targets, viewport: [window.innerWidth, window.innerHeight], errors };
}

export function observeScript(targets: readonly ObserveTarget[], options: Partial<ObserveOptions> = {}): string {
	return pageExpression(observeInPage, {
		targets: targets.map((t) => ({ ...t })),
		options: { ...DEFAULT_OBSERVE_OPTIONS, ...options }
	});
}

/** 드라이버(시뮬레이터·실기기)에 묶이지 않는다 — 실행기만 있으면 된다 */
export function observeTargets(
	runner: ScriptRunner,
	targets: readonly ObserveTarget[],
	options: Partial<ObserveOptions> = {}
): Promise<Observation> {
	return runner.evaluate<Observation>(observeScript(targets, options));
}
