import type { DomNode, DomSnapshot } from '@auto-qa/focus';

/**
 * 화면 표시(detect) 자동 선택 (D-043 ④). 자동 연결이 고른 선택자 중, 이 화면 스냅숏에는 있고 다른 화면 스냅숏에는 없는 것을
 * 고른다. 스냅숏은 보이는 요소만 담으므로 "스냅숏에 있음" ≈ "보임"이다. 결정적이다.
 */

interface Compound {
	tag: string | null;
	ids: string[];
	classes: string[];
	attrs: { name: string; value: string }[];
}

const IDENT = '-?[A-Za-z_][A-Za-z0-9_-]*';
const TOKEN = new RegExp(`^(?:(${IDENT})|#(${IDENT})|\\.(${IDENT})|\\[([a-z-]+)="((?:[^"\\\\]|\\\\.)*)"\\])`);

function parseCompound(text: string): Compound | null {
	const c: Compound = { tag: null, ids: [], classes: [], attrs: [] };
	let rest = text;
	let first = true;
	while (rest !== '') {
		const m = TOKEN.exec(rest);
		if (m === null) return null;
		if (m[1] !== undefined) {
			if (!first) return null;
			c.tag = m[1].toLowerCase();
		} else if (m[2] !== undefined) c.ids.push(m[2]);
		else if (m[3] !== undefined) c.classes.push(m[3]);
		else if (m[4] !== undefined) c.attrs.push({ name: m[4], value: (m[5] ?? '').replace(/\\(.)/g, '$1') });
		rest = rest.slice(m[0].length);
		first = false;
	}
	return c;
}

function attrOf(n: DomNode, name: string): string | null {
	if (name === 'data-spotlight-id') return n.spotlightId;
	if (name === 'role') return n.role;
	if (name === 'id') return n.id;
	return null;
}

const KNOWN_ATTRS = new Set(['data-spotlight-id', 'role', 'id']);

function matchesCompound(n: DomNode, c: Compound): boolean {
	if (c.tag !== null && n.tag !== c.tag) return false;
	if (!c.ids.every((id) => n.id === id)) return false;
	if (!c.classes.every((k) => n.classes.includes(k))) return false;
	return c.attrs.every((a) => attrOf(n, a.name) === a.value);
}

/** 선택자를 조각(공백으로 이은 자손)으로. 자동 연결이 내는 단순 문법만 안다. 모르면 null */
export function parseSimpleSelector(css: string): Compound[] | null {
	const parts = css.trim().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/);
	const out: Compound[] = [];
	for (const p of parts) {
		const c = parseCompound(p);
		if (c === null || c.attrs.some((a) => !KNOWN_ATTRS.has(a.name))) return null;
		out.push(c);
	}
	return out.length === 0 ? null : out;
}

/** 스냅숏에서 선택자에 맞는 요소 번호. 모르는 문법이면 null */
export function matchSelector(snapshot: DomSnapshot, css: string): number[] | null {
	const chain = parseSimpleSelector(css);
	if (chain === null) return null;
	const last = chain[chain.length - 1] as Compound;
	const ancestors = chain.slice(0, -1);
	return snapshot.nodes
		.filter((n) => {
			if (!matchesCompound(n, last)) return false;
			// 앞 조각들이 조상 쪽으로 차례로 맞아야 한다 (가까운 조상부터 거꾸로)
			let at = n.i;
			for (let k = ancestors.length - 1; k >= 0; k--) {
				const want = ancestors[k] as Compound;
				let p = snapshot.nodes[at]?.parent ?? -1;
				while (p >= 0 && !matchesCompound(snapshot.nodes[p] as DomNode, want))
					p = snapshot.nodes[p]?.parent ?? -1;
				if (p < 0) return false;
				at = p;
			}
			return true;
		})
		.map((n) => n.i);
}

export interface DetectChoice {
	selector: string;
	/** 이 선택자가 맞는 다른 화면 (비어 있으면 모든 다른 화면과 구별됨) */
	sharedWith: string[];
	reason: string;
}

/**
 * 화면 표시 선택자: 후보(앞쪽이 먼저) 중 이 화면에 있고 다른 화면과 가장 잘 구별되는 것.
 * 다른 화면 모두와 구별되는 후보가 없으면 가장 적게 겹치는 것을 고르고 겹친 화면을 적는다 (같은 패널의 상태 변형 등)
 */
export function chooseDetect(
	screen: DomSnapshot,
	others: ReadonlyMap<string, DomSnapshot>,
	candidates: readonly string[]
): DetectChoice | null {
	let best: { selector: string; shared: string[]; order: number } | null = null;
	candidates.forEach((selector, order) => {
		const here = matchSelector(screen, selector);
		if (here === null || here.length === 0) return;
		const shared = [...others].filter(([, s]) => (matchSelector(s, selector)?.length ?? 0) > 0).map(([id]) => id);
		if (best === null || shared.length < best.shared.length) best = { selector, shared, order };
	});
	if (best === null) return null;
	const b = best as { selector: string; shared: string[]; order: number };
	return {
		selector: b.selector,
		sharedWith: b.shared,
		reason:
			b.shared.length === 0
				? `다른 화면 ${others.size}개에 없음`
				: `다른 화면 ${b.shared.join('·')}에도 있음 (구별되는 요소 없음)`
	};
}
