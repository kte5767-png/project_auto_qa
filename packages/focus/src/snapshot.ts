import { pageExpression } from '@auto-qa/core';
import type { Rect, ScriptRunner } from '@auto-qa/core';

/**
 * 화면 요소 목록 (D-043 ③): 화면설계서 콜아웃 ↔ 앱 요소 자동 연결의 입력. 보이는 요소마다 글자·위치·이름표(id, 클래스,
 * data-spotlight-id, role, aria-label 등)를 읽는다. 페이지 스크립트는 값만 읽고, 고르기는 순수 함수(@auto-qa/planner)가 한다.
 * 탐지에 data-testid·data-sample-nav는 쓰지 않는다 (읽지도 않는다).
 */

export interface SnapshotProbe {
	/** 결과에 붙일 이름 */
	name: string;
	selector: string;
	/** 이 글자를 포함하는 요소만 */
	textIncludes?: string;
}

export interface SnapshotOptions {
	/** 포커스를 받을 수 있는 요소 */
	focusables: string;
	/** 담는 요소 수 상한 */
	maxNodes: number;
	/** 요소 글자(ownText·label) 길이 상한 */
	maxText: number;
	/** 화면 높이의 이 배수보다 아래에 있는 요소는 뺀다 (긴 목록의 먼 항목) */
	maxScreens: number;
	/** 담지 않는 태그 (안쪽도 보지 않음) */
	skipTags: string[];
	/** 요소 표시: 이 선택자에 맞는 요소에 이름을 붙인다 (정답 선택자 확인, 고른 선택자 검증) */
	probes: SnapshotProbe[];
	/** 읽을 클래스 수 상한 (요소마다) */
	maxClasses: number;
}

export const DEFAULT_SNAPSHOT_OPTIONS: SnapshotOptions = {
	focusables: '[data-spotlight-id], .spottable, button, a[href], input, textarea, [tabindex]:not([tabindex="-1"])',
	maxNodes: 4000,
	maxText: 120,
	maxScreens: 3,
	skipTags: ['script', 'style', 'noscript', 'template', 'link', 'meta', 'head'],
	probes: [],
	maxClasses: 8
};

export interface DomNode {
	/** 목록 안 순번 (문서 순서) */
	i: number;
	/** 목록에 담긴 가장 가까운 조상의 순번 (없으면 -1) */
	parent: number;
	tag: string;
	id: string | null;
	classes: string[];
	spotlightId: string | null;
	/** data-spotlight-container가 있는가 (Enact 묶음) */
	container: boolean;
	role: string | null;
	/** aria-label · alt · title · placeholder 중 처음 있는 것 */
	label: string | null;
	/** 바로 아래 글자 노드 (공백 정리) */
	ownText: string;
	/** 입력란 값 */
	value: string | null;
	rect: Rect;
	focusable: boolean;
	/** 지금 포커스가 있는가 (document.activeElement) */
	focused: boolean;
	/** 맞은 probe 이름 */
	probes: string[];
}

export interface DomSnapshot {
	viewport: { width: number; height: number };
	nodes: DomNode[];
	/** maxNodes에 걸려 잘렸는가 */
	truncated: boolean;
	errors: string[];
}

/** 페이지 안에서 실행된다. ES2017만 (`?.`·`??`·객체 전개 금지), 바깥 변수를 쓰지 않는다 */
function snapshotInPage(o: SnapshotOptions): DomSnapshot {
	const errors: string[] = [];
	const width = window.innerWidth;
	const height = window.innerHeight;
	const squash = (t: string): string => t.replace(/\s+/g, ' ').trim();
	const cut = (t: string): string => (t.length > o.maxText ? t.slice(0, o.maxText) : t);
	const nodes: DomNode[] = [];
	const index = new Map<Element, number>();
	let focusables: Element[] = [];
	try {
		focusables = Array.prototype.slice.call(document.querySelectorAll(o.focusables)) as Element[];
	} catch (e) {
		errors.push('포커스 선택자 오류 ' + o.focusables + ' (' + String(e) + ')');
	}
	const active = document.activeElement;
	let truncated = false;
	// 깊이 우선(문서 순서). 숨은 요소(display none·opacity 0)는 안쪽도 보지 않는다
	const stack: { el: Element; parent: number }[] = [];
	if (document.body !== null) stack.push({ el: document.body, parent: -1 });
	while (stack.length > 0) {
		const top = stack.pop() as { el: Element; parent: number };
		const el = top.el;
		const tag = el.tagName.toLowerCase();
		if (o.skipTags.indexOf(tag) >= 0) continue;
		const cs = window.getComputedStyle(el);
		if (cs.display === 'none' || Number(cs.opacity) === 0) continue;
		const r = el.getBoundingClientRect();
		let parent = top.parent;
		const shown =
			cs.visibility !== 'hidden' &&
			r.width > 0 &&
			r.height > 0 &&
			r.bottom > 0 &&
			r.right > 0 &&
			r.left < width &&
			r.top < height * o.maxScreens;
		if (shown) {
			if (nodes.length >= o.maxNodes) {
				truncated = true;
				break;
			}
			let own = '';
			for (let c = el.firstChild; c !== null; c = c.nextSibling) {
				if (c.nodeType === 3) own += ' ' + (c.nodeValue || '');
			}
			const attr = (name: string): string | null => {
				const v = el.getAttribute(name);
				return v === null || v.trim() === '' ? null : cut(squash(v));
			};
			const label = attr('aria-label') || attr('alt') || attr('title') || attr('placeholder');
			const input = el as HTMLInputElement;
			const value =
				(tag === 'input' || tag === 'textarea') && typeof input.value === 'string' && input.value !== ''
					? cut(input.value)
					: null;
			const classes: string[] = [];
			for (let k = 0; k < el.classList.length && classes.length < o.maxClasses; k++) {
				classes.push(el.classList[k] as string);
			}
			const i = nodes.length;
			nodes.push({
				i,
				parent,
				tag,
				id: el.id === '' ? null : el.id,
				classes,
				spotlightId: attr('data-spotlight-id'),
				container: el.hasAttribute('data-spotlight-container'),
				role: attr('role'),
				label,
				ownText: cut(squash(own)),
				value,
				rect: {
					x: Math.round(r.left),
					y: Math.round(r.top),
					width: Math.round(r.width),
					height: Math.round(r.height)
				},
				focusable: focusables.indexOf(el) >= 0,
				focused: el === active,
				probes: []
			});
			index.set(el, i);
			parent = i;
		}
		// 문서 순서로 꺼내려고 뒤 자식부터 넣는다
		const kids = el.children;
		for (let k = kids.length - 1; k >= 0; k--) stack.push({ el: kids[k] as Element, parent });
	}
	for (let p = 0; p < o.probes.length; p++) {
		const probe = o.probes[p] as SnapshotProbe;
		let found: Element[] = [];
		try {
			found = Array.prototype.slice.call(document.querySelectorAll(probe.selector)) as Element[];
		} catch (e) {
			errors.push('선택자 오류 ' + probe.selector + ' (' + String(e) + ')');
		}
		for (let k = 0; k < found.length; k++) {
			const el = found[k] as Element;
			const at = index.get(el);
			if (at === undefined) continue;
			if (probe.textIncludes !== undefined && (el.textContent || '').indexOf(probe.textIncludes) < 0) continue;
			(nodes[at] as DomNode).probes.push(probe.name);
		}
	}
	return { viewport: { width, height }, nodes, truncated, errors };
}

export function snapshotScript(options: Partial<SnapshotOptions> = {}): string {
	return pageExpression(snapshotInPage, { ...DEFAULT_SNAPSHOT_OPTIONS, ...options });
}

export function takeDomSnapshot(runner: ScriptRunner, options: Partial<SnapshotOptions> = {}): Promise<DomSnapshot> {
	return runner.evaluate<DomSnapshot>(snapshotScript(options));
}

// ── 순수 함수 ────────────────────────────

/** 요소마다 자식 순번 (문서 순서) */
export function childrenOf(snapshot: DomSnapshot): number[][] {
	const out: number[][] = snapshot.nodes.map(() => []);
	for (const n of snapshot.nodes) if (n.parent >= 0) out[n.parent]?.push(n.i);
	return out;
}

/** a가 b의 조상인가 (자신 제외) */
export function isAncestorNode(snapshot: DomSnapshot, a: number, b: number): boolean {
	let p = snapshot.nodes[b]?.parent ?? -1;
	while (p >= 0) {
		if (p === a) return true;
		p = snapshot.nodes[p]?.parent ?? -1;
	}
	return false;
}

/** 요소 안에 보이는 글자 줄 (자신과 자손의 ownText·label·value, 문서 순서). limit개까지 */
export function nodeTexts(snapshot: DomSnapshot, i: number, limit = 60, children = childrenOf(snapshot)): string[] {
	const out: string[] = [];
	const visit = (k: number): void => {
		if (out.length >= limit) return;
		const n = snapshot.nodes[k];
		if (n === undefined) return;
		for (const t of [n.ownText, n.label ?? '', n.value ?? '']) if (t !== '' && out.length < limit) out.push(t);
		for (const c of children[k] ?? []) visit(c);
	};
	visit(i);
	return out;
}

/** 안에 든 포커스 가능 요소 수 (자신 포함) */
export function focusableCount(snapshot: DomSnapshot, children = childrenOf(snapshot)): number[] {
	const out = snapshot.nodes.map(() => 0);
	// 문서 순서의 역순이면 자식이 부모보다 먼저 끝난다
	for (let k = snapshot.nodes.length - 1; k >= 0; k--) {
		const n = snapshot.nodes[k];
		if (n === undefined) continue;
		let sum = n.focusable ? 1 : 0;
		for (const c of children[k] ?? []) sum += out[c] ?? 0;
		out[k] = sum;
	}
	return out;
}
