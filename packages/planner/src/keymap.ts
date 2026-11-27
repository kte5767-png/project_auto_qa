import type { Rect } from '@auto-qa/core';
import type { SpecKey } from '@auto-qa/spec';

/**
 * 화면설계서 콜아웃의 키 동작 문장("▼: 추천 검색어 좌측 첫 번째 항목으로 이동")을 이동으로 해석한다 (D-036).
 * 규칙 기반·결정적이며 AI를 쓰지 않는다. 근거가 약하면 추측하지 않고 element/unknown으로 남기고,
 * 키 방향(목업 위 위치)으로 고른 후보는 estimate로 따로 붙인다.
 */

/** 이동 지도의 콜아웃 하나 */
export interface NavCallout {
	/** 콜아웃 번호 (예: "2") */
	no: string;
	/** 콜아웃 이름 (설명 첫 줄 등) */
	names: string[];
	/** 대상 영역 안의 목업 글자 (항목 이름을 찾을 때 쓴다) */
	texts: string[];
	/** 화면 좌표 (키 방향 판단용) */
	rect: Rect | null;
	/** 설명에 적힌 키 동작 문장 */
	keys: Partial<Record<SpecKey, string>>;
}

export interface NavScreen {
	screenId: string | null;
	title: string | null;
	callouts: NavCallout[];
	/** 화면설계서 화면 설명의 "Default Focus: …" (없으면 없음) */
	defaultFocus?: string | null;
}

export type KeyEffect =
	| { kind: 'none' }
	/** 화면 밖으로 (예: GNB 확장) */
	| { kind: 'leave'; to: string }
	/** 같은 목록 안의 다음(+1)·이전(-1) 항목. item은 문장에 적힌 항목 이름 */
	| { kind: 'step'; delta: 1 | -1; item: string | null }
	/** 다른 콜아웃으로. memory: 이동한 이력이 있으면 마지막 위치로 */
	| { kind: 'move'; to: string; position: 'first' | 'last'; item: string | null; memory: boolean }
	/** 콜아웃이 아닌 요소(또는 이름을 콜아웃에 대응시키지 못함) */
	| { kind: 'element'; name: string; memory: boolean }
	| { kind: 'unknown' };

export interface KeyAction {
	from: string;
	key: SpecKey;
	text: string;
	effect: KeyEffect;
	/** 더 이상 이동할 항목이 없으면 동작 없음 */
	endNoop: boolean;
	/** 이름으로 정하지 못했을 때 키 방향으로 고른 콜아웃 (확인 필요) */
	estimate: { to: string; reason: string } | null;
	reason: string;
}

export interface KeyMapOptions {
	noneWords: string[];
	leave: { pattern: string; to: string }[];
	nextWords: string[];
	prevWords: string[];
	lastWords: string[];
	memoryWords: string[];
	/**
	 * 본문이 "마지막으로 포커스했던 곳"으로 가라고 할 때의 말 (예: "추천검색어의 라스트포커스로 이동").
	 * 이력 위치(memory)로 읽고, 이름·"마지막 항목"을 찾을 때는 이 말을 뺀다
	 */
	lastFocusWords: string[];
	endNoopWords: string[];
	/** 이름 비교에서 빼는 일반 낱말 */
	stopWords: string[];
	/** 낱말 끝에서 떼는 조사 (긴 것부터) */
	particles: string[];
	/** 이름 일치(F1) 기준 */
	minNameScore: number;
	/** 이름이 일부 맞고 키 방향도 맞으면 더하는 점수 */
	directionBonus: number;
	/** 1·2위 차이가 이보다 작으면 정하지 않는다 */
	ambiguityMargin: number;
	/** 키 방향 후보를 고를 때 옆 방향 틈에 곱하는 값 */
	offAxisWeight: number;
	/** 가장자리가 이만큼(px) 겹쳐도 그 방향으로 본다 */
	edgeTolerance: number;
	/**
	 * 사람이 정한 다른 이름 (콜아웃 이름 → 문장에서 부르는 이름들).
	 * 예: { "Recommended Keywords": ["추천 검색어"] }. 프로젝트 프로필에 저장해 재사용한다 (D-036)
	 */
	aliases: Record<string, string[]>;
}

export const DEFAULT_KEYMAP_OPTIONS: KeyMapOptions = {
	noneWords: ['동작 없음', '동작없음', '반응 없음', '이동 없음', '이동하지 않음'],
	leave: [
		{ pattern: 'GNB', to: 'GNB' },
		{ pattern: '이전 화면', to: 'previous' }
	],
	nextWords: ['다음'],
	prevWords: ['이전'],
	lastWords: ['마지막'],
	memoryWords: ['이동한 이력', '이력이 있을'],
	lastFocusWords: [
		'라스트 포커스',
		'라스트포커스',
		'마지막 포커스한',
		'마지막으로 포커스한',
		'마지막 포커스',
		'마지막으로 포커스'
	],
	endNoopWords: ['더 이상'],
	stopWords: [
		'영역',
		'버튼',
		'포커스',
		'항목',
		'콘텐츠',
		'이동',
		'노출',
		'좌측',
		'우측',
		'상단',
		'하단',
		'첫',
		'번째',
		'첫번째',
		'위치',
		'카테고리',
		'focus',
		'button'
	],
	particles: ['으로', '에서', '에게', '로', '에', '의', '을', '를', '은', '는', '이', '가', '와', '과'],
	minNameScore: 0.5,
	directionBonus: 0.2,
	ambiguityMargin: 0.1,
	offAxisWeight: 2,
	edgeTolerance: 8,
	aliases: {}
};

const QUOTES = /[“”"‘’'「」『』{}]/g;
const BALANCED = /[“"‘「『]\s*\{?\s*([^“”"‘’「」『』{}]+?)\s*\}?\s*[”"’」』]/g;

function normalize(text: string): string {
	return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function stripParticle(token: string, particles: readonly string[]): string {
	for (const p of particles) {
		if (token.length > p.length + 1 && token.endsWith(p)) return token.slice(0, -p.length);
	}
	return token;
}

/** 비교용 낱말 (소문자, 조사 떼기, 일반 낱말 빼기) */
export function nameTokens(text: string, options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS): string[] {
	const stop = new Set(options.stopWords.map((w) => w.toLowerCase()));
	const out: string[] = [];
	for (const raw of normalize(text.replace(QUOTES, ' '))
		.toLowerCase()
		.split(/[\s,./:;()[\]<>·_-]+/)) {
		if (raw === '') continue;
		const token = stripParticle(raw, options.particles);
		if (token === '' || stop.has(token) || stop.has(raw)) continue;
		out.push(token);
	}
	return out;
}

function f1(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	const rest = [...b];
	let common = 0;
	for (const t of a) {
		const i = rest.indexOf(t);
		if (i >= 0) {
			common++;
			rest.splice(i, 1);
		}
	}
	if (common === 0) return 0;
	const p = common / a.length;
	const r = common / b.length;
	return (2 * p * r) / (p + r);
}

/** 두 이름의 낱말 일치(F1, 0~1). 조사·일반 낱말은 빼고 비교한다 */
export function nameScore(a: string, b: string, options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS): number {
	return spacedF1(nameTokens(a, options), nameTokens(b, options));
}

/** 콜아웃 이름 + 사람이 정한 다른 이름 */
function namesOf(c: NavCallout, options: KeyMapOptions): string[] {
	const out = [...c.names];
	const own = new Set(c.names.map((n) => normalize(n).toLowerCase()));
	for (const [name, aliases] of Object.entries(options.aliases)) {
		if (own.has(normalize(name).toLowerCase())) out.push(...aliases);
	}
	return out;
}

/**
 * 띄어쓰기 차이 맞추기: a의 낱말 하나가 b의 이어진 낱말들을 붙인 것과 같으면 그 낱말들로 나눈다
 * ("추천검색어" ↔ "추천 검색어"). TC·화면설계서는 같은 이름을 붙여 쓰기도 띄어 쓰기도 한다
 */
export function splitLikeOther(a: readonly string[], b: readonly string[]): string[] {
	const out: string[] = [];
	for (const t of a) {
		let parts: string[] | null = null;
		for (let i = 0; i < b.length && parts === null; i++) {
			let joined = '';
			for (let j = i; j < b.length; j++) {
				joined += b[j];
				if (joined.length > t.length) break;
				if (j > i && joined === t) {
					parts = b.slice(i, j + 1);
					break;
				}
			}
		}
		out.push(...(parts ?? [t]));
	}
	return out;
}

/** 띄어쓰기를 맞춘 F1 (양쪽 모두 상대 낱말 기준으로 나눈 뒤 비교) */
export function spacedF1(a: readonly string[], b: readonly string[]): number {
	return f1(splitLikeOther(a, b), splitLikeOther(b, a));
}

function bestNameScore(phrase: readonly string[], c: NavCallout, options: KeyMapOptions): number {
	let best = 0;
	for (const n of namesOf(c, options)) best = Math.max(best, spacedF1(phrase, nameTokens(n, options)));
	return best;
}

/** 글자 안에 이름이 낱말 단위로 들어 있는가 (대소문자·공백 무시) */
function containsName(texts: readonly string[], name: string): boolean {
	const needle = normalize(name).toLowerCase();
	if (needle === '') return false;
	return texts.some((t) => {
		const hay = ` ${normalize(t.replace(QUOTES, ' ')).toLowerCase()} `;
		return hay.includes(` ${needle} `);
	});
}

const DIRECTION: Record<SpecKey, [number, number] | null> = {
	up: [0, -1],
	down: [0, 1],
	left: [-1, 0],
	right: [1, 0],
	ok: null,
	back: null
};

/**
 * 키 방향에 있는 콜아웃을 가까운 순으로.
 * 대상의 가까운 쪽 가장자리가 출발 요소의 먼 쪽 가장자리를 넘어야 그 방향으로 본다(넓은 요소의 중심에 속지 않게).
 * 거리 = 진행 방향 틈 + 가중치 × 옆 방향 틈(투영이 겹치면 0).
 */
export function calloutsInDirection(
	from: NavCallout,
	key: SpecKey,
	callouts: readonly NavCallout[],
	options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS
): NavCallout[] {
	const dir = DIRECTION[key];
	const f = from.rect;
	if (dir === null || f === null) return [];
	const horizontal = dir[0] !== 0;
	const scored: { c: NavCallout; cost: number }[] = [];
	for (const c of callouts) {
		const r = c.rect;
		if (c.no === from.no || r === null) continue;
		const along = horizontal
			? dir[0] > 0
				? r.x - (f.x + f.width)
				: f.x - (r.x + r.width)
			: dir[1] > 0
				? r.y - (f.y + f.height)
				: f.y - (r.y + r.height);
		if (along < -options.edgeTolerance) continue;
		const across = horizontal
			? Math.max(0, Math.max(f.y, r.y) - Math.min(f.y + f.height, r.y + r.height))
			: Math.max(0, Math.max(f.x, r.x) - Math.min(f.x + f.width, r.x + r.width));
		scored.push({ c, cost: Math.max(0, along) + options.offAxisWeight * across });
	}
	scored.sort((a, b) => a.cost - b.cost || a.c.no.localeCompare(b.c.no, undefined, { numeric: true }));
	return scored.map((s) => s.c);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasAny(text: string, words: readonly string[]): boolean {
	return words.some((w) => text.includes(w));
}

/** 키 동작 문장 하나를 해석한다 */
export function parseKeyAction(
	from: NavCallout,
	key: SpecKey,
	text: string,
	callouts: readonly NavCallout[],
	options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS
): KeyAction {
	const raw = normalize(text);
	const conditions = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? '');
	const body = normalize(raw.replace(/\([^)]*\)/g, ' '));
	const lastFocus = [...options.lastFocusWords].sort((a, b) => b.length - a.length).find((w) => body.includes(w));
	const main =
		lastFocus === undefined
			? body
			: normalize(body.replace(new RegExp(`${escapeRegExp(lastFocus)}(?:으로|로|에|을|를)?`, 'g'), ' '));
	const memory = lastFocus !== undefined || conditions.some((c) => hasAny(c, options.memoryWords));
	const endNoop = conditions.some((c) => hasAny(c, options.endNoopWords));
	const base = { from: from.no, key, text: raw, endNoop, estimate: null };
	const done = (effect: KeyEffect, reason: string): KeyAction => ({ ...base, effect, reason });

	if (main === '' || hasAny(main.replace(/\s+/g, ' '), options.noneWords)) return done({ kind: 'none' }, '동작 없음');
	for (const l of options.leave) {
		if (main.includes(l.pattern)) return done({ kind: 'leave', to: l.to }, `"${l.pattern}" → 화면 밖`);
	}

	const tokens = nameTokens(main, options);
	const first = tokens[0];
	if (first !== undefined && (options.nextWords.includes(first) || options.prevWords.includes(first))) {
		const delta = options.nextWords.includes(first) ? 1 : -1;
		return done({ kind: 'step', delta, item: null }, `"${first}" → 같은 목록 ${delta > 0 ? '다음' : '이전'} 항목`);
	}

	const others = callouts.filter((c) => c.no !== from.no);
	const position: 'first' | 'last' = hasAny(main, options.lastWords) ? 'last' : 'first';
	const quoted = [...main.matchAll(BALANCED)].map((m) => normalize(m[1] ?? '')).filter((q) => q !== '');
	const directional = DIRECTION[key] !== null;

	// 따옴표로 묶인 이름: 콜아웃 이름 → 목업 글자 속 항목 순서로 찾는다
	for (const q of quoted) {
		const qTokens = nameTokens(q, options);
		const named = rankByName(qTokens, others, from, key, options);
		if (named !== null) {
			return done(
				{ kind: 'move', to: named.c.no, position, item: null, memory },
				`"${q}" = ${named.c.no}번 이름 (${named.score.toFixed(2)})`
			);
		}
		if (directional && containsName(from.texts, q)) {
			const delta = key === 'right' || key === 'down' ? 1 : -1;
			return done({ kind: 'step', delta, item: q }, `"${q}"는 같은 콜아웃의 항목`);
		}
		const owner = others.find((c) => containsName(c.texts, q));
		if (owner !== undefined) {
			return done(
				{ kind: 'move', to: owner.no, position, item: q, memory },
				`"${q}"는 ${owner.no}번 영역의 항목`
			);
		}
	}

	// 문장 속 이름
	const named = rankByName(tokens, others, from, key, options);
	if (named !== null) {
		return done(
			{ kind: 'move', to: named.c.no, position, item: null, memory },
			`이름 일치 ${named.c.no}번 (${named.score.toFixed(2)})`
		);
	}
	const phrase = tokens.join(' ');
	if (phrase !== '') {
		const owner = others.find((c) => containsName(c.texts, phrase));
		if (owner !== undefined) {
			return done(
				{ kind: 'move', to: owner.no, position, item: phrase, memory },
				`"${phrase}"는 ${owner.no}번 영역의 항목`
			);
		}
	}

	// 이름으로 못 정함: 콜아웃이 아닌 요소로 남기고, 키 방향 후보는 따로 붙인다
	const nearest = calloutsInDirection(from, key, callouts, options)[0];
	const estimate = nearest === undefined ? null : { to: nearest.no, reason: `키 방향에서 가장 가까운 콜아웃` };
	const name = quoted[0] ?? phrase;
	if (name === '') return { ...done({ kind: 'unknown' }, '대상 이름 없음'), estimate };
	return { ...done({ kind: 'element', name, memory }, `"${name}"에 맞는 콜아웃 없음`), estimate };
}

function rankByName(
	tokens: readonly string[],
	candidates: readonly NavCallout[],
	from: NavCallout,
	key: SpecKey,
	options: KeyMapOptions
): { c: NavCallout; score: number } | null {
	if (tokens.length === 0) return null;
	const nearest = calloutsInDirection(from, key, candidates, options)[0];
	const ranked = candidates
		.map((c) => {
			const name = bestNameScore(tokens, c, options);
			const bonus = name > 0 && nearest !== undefined && nearest.no === c.no ? options.directionBonus : 0;
			return { c, score: name + bonus };
		})
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score);
	const top = ranked[0];
	if (top === undefined || top.score < options.minNameScore) return null;
	const second = ranked[1];
	if (second !== undefined && top.score - second.score < options.ambiguityMargin) return null;
	return top;
}

/** 화면의 모든 키 동작을 해석한다 */
export function buildKeyMap(screen: NavScreen, options: KeyMapOptions = DEFAULT_KEYMAP_OPTIONS): KeyAction[] {
	const out: KeyAction[] = [];
	for (const c of screen.callouts) {
		for (const key of ['up', 'down', 'left', 'right', 'ok', 'back'] as const) {
			const text = c.keys[key];
			if (text === undefined) continue;
			out.push(parseKeyAction(c, key, text, screen.callouts, options));
		}
	}
	return out;
}

/** 비교·리포트용 한 줄 표현 (예: "move:2:first+memory") */
export function describeEffect(effect: KeyEffect): string {
	switch (effect.kind) {
		case 'none':
		case 'unknown':
			return effect.kind;
		case 'leave':
			return `leave:${effect.to}`;
		case 'step':
			return effect.delta > 0 ? 'next' : 'prev';
		case 'move':
			return `move:${effect.to}:${effect.item === null ? effect.position : `item=${effect.item.toLowerCase()}`}${effect.memory ? '+memory' : ''}`;
		case 'element':
			return `element:${effect.name.toLowerCase()}${effect.memory ? '+memory' : ''}`;
	}
}
