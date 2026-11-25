import type { Page } from 'playwright-core';
import type { FocusState } from './types';

export interface CollectOptions {
	/** selector 어댑터용 CSS 선택자. 없으면 null */
	selector: string | null;
	/** 스타일을 수집할 최대 요소 수 */
	maxElements: number;
	/** 뷰포트 면적 대비 이보다 큰 요소는 컨테이너로 보고 스타일 수집에서 뺀다 */
	maxAreaRatio: number;
	/** 이보다 작은 요소는 뺀다 (px) */
	minSize: number;
	/** 이 수보다 많은 요소가 가진 클래스 토큰은 포커스 클래스 후보에서 뺀다 */
	maxClassHolders: number;
	/**
	 * 뷰포트 밖으로 이 배율만큼 넓힌 영역까지 스타일을 수집한다.
	 * 포커스 이동과 함께 화면 안으로 스크롤되어 들어오는 요소도 "이전 스타일"을 갖게 하기 위함.
	 */
	viewportMargin: number;
}

export const DEFAULT_COLLECT_OPTIONS: CollectOptions = {
	selector: null,
	maxElements: 4000,
	maxAreaRatio: 0.6,
	minSize: 8,
	maxClassHolders: 3,
	viewportMargin: 1
};

/**
 * 브라우저 안에서 실행되는 수집 함수. page.evaluate로 직렬화되므로 바깥 변수·import를 쓰면 안 된다.
 */
function collectInPage(opts: CollectOptions): FocusState {
	const pathOf = (el: Element): string => {
		const parts: string[] = [];
		let node: Element | null = el;
		while (node !== null && node !== document.body && node.parentElement !== null) {
			const tag = node.tagName.toLowerCase();
			let index = 1;
			let sibling = node.previousElementSibling;
			while (sibling !== null) {
				if (sibling.tagName === node.tagName) index++;
				sibling = sibling.previousElementSibling;
			}
			parts.unshift(`${tag}:nth-of-type(${index})`);
			node = node.parentElement;
		}
		return parts.length === 0 ? 'body' : `body>${parts.join('>')}`;
	};
	const round = (v: number): number => Math.round(v * 100) / 100;
	const infoOf = (el: Element) => {
		const r = el.getBoundingClientRect();
		return {
			path: pathOf(el),
			tag: el.tagName.toLowerCase(),
			id: el.id === '' ? null : el.id,
			classes: Array.from(el.classList),
			spotlightId: el.getAttribute('data-spotlight-id'),
			rect: [round(r.x), round(r.y), round(r.width), round(r.height)] as [number, number, number, number],
			text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
		};
	};
	const pseudo = (el: Element, which: '::after' | '::before'): string => {
		const cs = getComputedStyle(el, which);
		if (cs.content === 'none' || cs.content === 'normal') return 'none';
		return `${cs.display}|${cs.opacity}|${cs.borderTopWidth}|${cs.borderTopStyle}`;
	};

	const activeEl = document.activeElement;
	const active =
		activeEl !== null && activeEl !== document.body && activeEl !== document.documentElement
			? infoOf(activeEl)
			: null;

	const selectorMatches =
		opts.selector === null ? [] : Array.from(document.querySelectorAll(opts.selector)).slice(0, 10).map(infoOf);

	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const styles: FocusState['styles'] = {};
	const elements: FocusState['elements'] = {};
	const classCount = new Map<string, Element[]>();
	const all = Array.from(document.body.querySelectorAll('*')).slice(0, opts.maxElements);

	for (const el of all) {
		for (const token of Array.from(el.classList)) {
			const list = classCount.get(token);
			if (list === undefined) classCount.set(token, [el]);
			else if (list.length <= opts.maxClassHolders) list.push(el);
		}
		const r = el.getBoundingClientRect();
		const mx = vw * opts.viewportMargin;
		const my = vh * opts.viewportMargin;
		const visible =
			r.width >= opts.minSize &&
			r.height >= opts.minSize &&
			r.right > -mx &&
			r.bottom > -my &&
			r.left < vw + mx &&
			r.top < vh + my;
		if (!visible || r.width * r.height > opts.maxAreaRatio * vw * vh) continue;
		const cs = getComputedStyle(el);
		const info = infoOf(el);
		elements[info.path] = info;
		styles[info.path] = {
			transform: cs.transform,
			outline: `${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}`,
			border: `${cs.borderTopStyle}|${cs.borderTopWidth}|${cs.borderTopColor}`,
			boxShadow: cs.boxShadow,
			background: cs.backgroundColor,
			color: cs.color,
			opacity: cs.opacity,
			after: pseudo(el, '::after'),
			before: pseudo(el, '::before')
		};
	}

	const classHolders: FocusState['classHolders'] = {};
	for (const [token, holders] of classCount) {
		if (holders.length > opts.maxClassHolders) continue;
		classHolders[token] = holders.map((el) => {
			const info = infoOf(el);
			elements[info.path] ??= info;
			return info.path;
		});
	}

	return {
		active,
		spottableCount: document.querySelectorAll('.spottable').length,
		selectorMatches,
		classHolders,
		styles,
		elements
	};
}

/** 현재 페이지의 포커스 관련 상태를 수집한다 */
export async function collectFocusState(page: Page, options: Partial<CollectOptions> = {}): Promise<FocusState> {
	// tsx·esbuild의 keepNames가 함수 소스에 넣는 __name 호출이 브라우저에서 깨지지 않도록 대비
	await page.evaluate('globalThis.__name ??= (fn) => fn');
	return page.evaluate(collectInPage, { ...DEFAULT_COLLECT_OPTIONS, ...options });
}
