import { area, iou } from '@auto-qa/core';
import type { Rect } from '@auto-qa/core';
import { elementById, isShown } from '@auto-qa/figma';
import type { FigmaElement, NormalizedFrame } from '@auto-qa/figma';
import { normalizeLabel } from './describe';
import type { Callout, SpecScreen } from './types';

/**
 * 화면설계서 ↔ GUI 연결 (설계 7.12, D-024). 규칙 기반·결정적이다.
 * 1) 화면 짝: 실제 파일은 화면설계서와 GUI의 번호 체계가 다르다(화면설계서 4.6 = GUI "4.1.2 …").
 *    그래서 번호가 아니라 목업 글자와 GUI 글자의 겹침 + 이름 유사도로 짝을 찾는다.
 * 2) 콜아웃 → GUI 요소: 목업 위치는 대략값이므로 위치(겹침·중심 거리)와 글자 유사도를 함께 본다.
 *    점수가 기준보다 낮으면 "GUI에서 찾지 못함"으로 두어 사람이 확인하게 한다 (디자인 불일치 후보).
 */

export interface LinkOptions {
	/**
	 * 화면 짝 점수 가중치: 목업 글자가 GUI에 있는 비율, 이름 유사도, 콜아웃 대상을 그 GUI에서 찾은 정도(평균 점수).
	 * 실제 파일은 같은 화면의 변형(키보드 열림/닫힘, 옵션 팝업)이 GUI 프레임으로 여럿 있어서
	 * 글자만으로는 구분이 안 된다 → 콜아웃 대상(키보드 등)이 그 GUI에 있는지를 함께 본다.
	 */
	pairWeights: { text: number; name: number; callouts: number };
	minPairScore: number;
	/** 1·2위 점수 차가 이보다 작으면 "확인 필요" */
	pairAmbiguityMargin: number;
	/** 화면 짝: 글자가 같다고 볼 유사도 (2글자 묶음 Dice) */
	pairTextMatch: number;
	/** 콜아웃 대응: 글자가 같다고 볼 유사도. 일부만 겹치는 글자("option" ⊂ "search option 메뉴")는 일치로 보지 않는다 */
	calloutTextMatch: number;
	/** 콜아웃 대응 점수 가중치 (글자 F1, 겹침, 근접도) */
	weights: { text: number; iou: number; near: number };
	minCalloutScore: number;
	/** 글자 근거 없이 위치만으로 고를 때 필요한 최소 겹침 (배경·큰 묶음이 근접만으로 뽑히지 않게) */
	minGeometryIou: number;
	/** 이 비율보다 큰 GUI 요소(배경 등)는 후보에서 뺀다 */
	maxCandidateAreaRatio: number;
}

export const DEFAULT_LINK_OPTIONS: LinkOptions = {
	pairWeights: { text: 0.4, name: 0.2, callouts: 0.4 },
	minPairScore: 0.4,
	pairAmbiguityMargin: 0.1,
	pairTextMatch: 0.8,
	calloutTextMatch: 0.7,
	weights: { text: 0.5, iou: 0.35, near: 0.15 },
	minCalloutScore: 0.3,
	minGeometryIou: 0.1,
	maxCandidateAreaRatio: 0.5
};

/** 비교용 글자: 소문자, 공백·기호·제어 문자 제거 (Figma 이름에 백스페이스(\u0008) 같은 제어 문자가 섞여 있음) */
function compact(text: string): string {
	return text.toLowerCase().replace(/[\s\p{P}\p{S}\p{C}]+/gu, '');
}

function bigrams(text: string): Map<string, number> {
	const s = compact(text);
	const out = new Map<string, number>();
	if (s.length === 1) out.set(s, 1);
	for (let i = 0; i < s.length - 1; i++) {
		const g = s.slice(i, i + 2);
		out.set(g, (out.get(g) ?? 0) + 1);
	}
	return out;
}

/** 2글자 묶음 Dice 유사도 (0~1). 한글·영문 모두 쓸 수 있다 */
export function textSimilarity(a: string, b: string): number {
	const x = bigrams(a);
	const y = bigrams(b);
	const total = [...x.values(), ...y.values()].reduce((s, v) => s + v, 0);
	if (total === 0) return 0;
	let common = 0;
	for (const [k, v] of x) common += Math.min(v, y.get(k) ?? 0);
	return (2 * common) / total;
}

/** 와이어프레임 자리표시 글자는 비교에서 뺀다 */
const PLACEHOLDER = /^(title|sub ?title|icon|logo|image|4k|text|button|\d+)$/i;

/** 숫자만으로 된 낱말(개수·날짜·평점 같은 예시 데이터)은 비교에서 뺀다: "All 64" ↔ "All 180" */
function withoutNumbers(text: string): string {
	return text
		.split(/\s+/)
		.filter((w) => !/^[\d.,:/%+()-]+$/.test(w))
		.join(' ');
}

/** 의미 있는 글자만 (자리표시·숫자·기호·너무 짧은 글자 제외, 같은 글자는 하나로) */
function meaningful(texts: readonly string[], minLength = 3): string[] {
	const out = new Map<string, string>();
	for (const raw of texts) {
		const t = withoutNumbers(raw.split('\n')[0]?.trim() ?? '');
		const key = compact(t);
		if (key.length >= minLength && !PLACEHOLDER.test(t) && !out.has(key)) out.set(key, t);
	}
	return [...out.values()];
}

function meaningfulTexts(elements: FigmaElement[]): string[] {
	return meaningful(elements.map((e) => e.text?.characters ?? ''));
}

const centerOf = (r: Rect): [number, number] => [r.x + r.width / 2, r.y + r.height / 2];
const inside = (r: Rect, [x, y]: [number, number]): boolean =>
	x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** 화면설계서 목업 안의 글자 */
export function mockupTexts(specFrame: NormalizedFrame, spec: SpecScreen): string[] {
	if (spec.mockup === null) return [];
	const m = spec.mockup.rect;
	return meaningfulTexts(
		specFrame.elements.filter((e) => e.kind === 'text' && isShown(e) && inside(m, centerOf(e.rect)))
	);
}

/** GUI 프레임 이름에서 번호·"Search_" 같은 앞부분을 뺀다 */
export function frameTitle(name: string): string {
	return name
		.replace(/\p{C}+/gu, ' ')
		.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, '')
		.replace(/^[A-Za-z]+_/, '')
		.trim();
}

export interface FramePair {
	guiFrameId: string;
	guiFrameName: string;
	score: number;
	/** 목업 글자 중 GUI에도 있는 비율 */
	textOverlap: number;
	nameSimilarity: number;
	/** 콜아웃 대상을 이 GUI에서 찾은 평균 점수 (콜아웃이 없으면 null) */
	calloutFit: number | null;
	matchedTexts: string[];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** 화면설계서 하나에 대해 GUI 프레임 후보를 점수순으로 (콜아웃 연결 결과도 함께) */
function scoreGuiFrames(
	spec: SpecScreen,
	specFrame: NormalizedFrame,
	guiFrames: readonly NormalizedFrame[],
	options: LinkOptions
): { pair: FramePair; links: CalloutLink[] }[] {
	const specTexts = mockupTexts(specFrame, spec);
	const w = options.pairWeights;
	return guiFrames
		.map((g) => {
			const guiTexts = meaningfulTexts(g.elements.filter((e) => e.kind === 'text' && isShown(e)));
			const matched = specTexts.filter((t) =>
				guiTexts.some((u) => textSimilarity(t, u) >= options.pairTextMatch)
			);
			const textOverlap = specTexts.length === 0 ? 0 : matched.length / specTexts.length;
			const nameSimilarity = textSimilarity(frameTitle(g.name), spec.title ?? '');
			const links = spec.callouts.map((c) => linkCallout(c, specFrame, g, options));
			const targeted = links.filter((l, i) => spec.callouts[i]?.target != null);
			const calloutFit =
				targeted.length === 0 ? null : targeted.reduce((sum, l) => sum + l.score, 0) / targeted.length;
			const score =
				calloutFit === null
					? (textOverlap * w.text + nameSimilarity * w.name) / (w.text + w.name)
					: textOverlap * w.text + nameSimilarity * w.name + calloutFit * w.callouts;
			const pair: FramePair = {
				guiFrameId: g.id,
				guiFrameName: g.name,
				score: round3(score),
				textOverlap: round3(textOverlap),
				nameSimilarity: round3(nameSimilarity),
				calloutFit: calloutFit === null ? null : round3(calloutFit),
				matchedTexts: matched
			};
			return { pair, links };
		})
		.sort((a, b) => b.pair.score - a.pair.score || a.pair.guiFrameName.localeCompare(b.pair.guiFrameName));
}

/** 화면설계서 하나에 대해 GUI 프레임 후보를 점수순으로 */
export function rankGuiFrames(
	spec: SpecScreen,
	specFrame: NormalizedFrame,
	guiFrames: readonly NormalizedFrame[],
	options: LinkOptions = DEFAULT_LINK_OPTIONS
): FramePair[] {
	return scoreGuiFrames(spec, specFrame, guiFrames, options).map((x) => x.pair);
}

export interface CalloutLink {
	no: string;
	label: string | null;
	/** 찾은 GUI 요소 (기준 점수 미만이면 null → 디자인 불일치 후보) */
	element: { id: string; name: string; text: string | null; rect: Rect } | null;
	score: number;
	reason: string;
	/** 다음 후보 (사람 확인용) */
	alternatives: { id: string; name: string; score: number }[];
	/** 화면설계서 글자와 GUI 글자가 다른 곳 (비슷하지만 같지 않음 / GUI에 없음). 판정이 아니라 확인 후보 */
	textDiffs: TextDiff[];
}

export interface TextDiff {
	spec: string;
	gui: string | null;
	similarity: number;
}

/** 찾은 요소 안에서 화면설계서 글자마다 가장 비슷한 GUI 글자를 찾아, 같지 않은 것만 남긴다 */
function diffTexts(expected: readonly string[], texts: readonly string[], threshold: number): TextDiff[] {
	const out: TextDiff[] = [];
	for (const w of expected) {
		let best: { t: string; sim: number } | null = null;
		for (const t of texts) {
			const sim = textSimilarity(w, t);
			if (best === null || sim > best.sim) best = { t, sim };
		}
		if (best !== null && compact(best.t) === compact(w)) continue;
		const similar = best !== null && best.sim >= threshold;
		out.push({
			spec: w,
			gui: similar ? (best?.t ?? null) : null,
			similarity: Math.round((best?.sim ?? 0) * 1000) / 1000
		});
	}
	return out;
}

function descendantTexts(frame: NormalizedFrame, e: FigmaElement, limit: number): string[] {
	const out: string[] = [];
	const visit = (x: FigmaElement): void => {
		if (out.length >= limit || x.hidden) return;
		if (x.text !== null && x.text.characters.trim() !== '') out.push(x.text.characters.split('\n')[0] ?? '');
		for (const id of x.childIds) {
			const c = elementById(frame, id);
			if (c !== undefined) visit(c);
		}
	};
	visit(e);
	return out;
}

/** 두 사각형 사이 거리 (겹치면 0) */
function gap(a: Rect, b: Rect): number {
	const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
	const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
	return Math.hypot(dx, dy);
}

/**
 * 글자 F1: 요소 안 글자 중 찾는 글자와 같은 비율(정밀도) × 찾는 글자 중 요소에 있는 비율(재현율).
 * 큰 상자는 찾는 글자를 포함하더라도 다른 글자가 많아 정밀도가 낮다 → 더 알맞은 작은 요소가 이긴다.
 */
function textF1(wanted: readonly string[], texts: readonly string[], threshold: number): number {
	if (wanted.length === 0 || texts.length === 0) return 0;
	const hit = (a: string, list: readonly string[]): boolean => list.some((b) => textSimilarity(a, b) >= threshold);
	const precision = texts.filter((t) => hit(t, wanted)).length / texts.length;
	const recall = wanted.filter((w) => hit(w, texts)).length / wanted.length;
	return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/** 콜아웃 대상 → 같은 화면 GUI 프레임의 요소 */
export function linkCallout(
	callout: Callout,
	specFrame: NormalizedFrame,
	gui: NormalizedFrame,
	options: LinkOptions = DEFAULT_LINK_OPTIONS
): CalloutLink {
	const base = { no: callout.no, label: callout.label };
	const target = callout.target;
	if (target === null)
		return {
			...base,
			element: null,
			score: 0,
			reason: '화면설계서에서 대상을 찾지 못함',
			alternatives: [],
			textDiffs: []
		};

	// 찾는 글자: 화면설계서 대상 영역 안의 목업 글자. 화면에 보이는 글자이므로 GUI에 없으면 감점한다.
	// 설명 이름(label)은 화면 글자가 아닐 수 있으므로("Search Option 메뉴") GUI 글자와 맞을 때만 가점으로 쓴다.
	const region = target.specRect;
	const expected = meaningful(
		specFrame.elements
			.filter((e) => e.kind === 'text' && isShown(e) && inside(region, centerOf(e.rect)))
			.map((e) => e.text?.characters ?? ''),
		2
	);
	const label = callout.label === null ? [] : meaningful([normalizeLabel(callout.label)], 2);

	const screenArea = gui.width * gui.height;
	const reach = Math.hypot(gui.width, gui.height) * 0.25;
	const w = options.weights;
	const scored = gui.elements
		.slice(1)
		.filter((e) => isShown(e) && area(e.rect) <= screenArea * options.maxCandidateAreaRatio && area(e.rect) >= 64)
		.map((e) => {
			const texts = meaningful(descendantTexts(gui, e, 40), 2);
			const overlap = iou(target.screenRect, e.rect);
			const near = Math.max(0, 1 - gap(target.screenRect, e.rect) / reach);
			const withText = (t: number): number => t * w.text + overlap * w.iou + near * w.near;
			let text: number;
			let score: number;
			if (expected.length > 0) {
				text = textF1(expected, texts, options.calloutTextMatch);
				score = withText(text);
			} else {
				text = textF1(label, texts, options.calloutTextMatch);
				const geometry =
					overlap >= options.minGeometryIou ? (overlap * w.iou + near * w.near) / (w.iou + w.near) : 0;
				score = Math.max(geometry, withText(text));
			}
			return { e, texts, score: Math.round(score * 1000) / 1000, text, overlap, near };
		})
		.sort((a, b) => b.score - a.score || area(a.e.rect) - area(b.e.rect) || a.e.id.localeCompare(b.e.id));

	const best = scored[0];
	const alternatives = scored.slice(1, 4).map((x) => ({ id: x.e.id, name: x.e.name, score: x.score }));
	if (best === undefined || best.score < options.minCalloutScore) {
		return {
			...base,
			element: null,
			score: best?.score ?? 0,
			reason: `GUI에서 맞는 요소를 찾지 못함 (최고 점수 ${best?.score ?? 0}) — 디자인 불일치 후보`,
			alternatives,
			textDiffs: []
		};
	}
	return {
		...base,
		element: { id: best.e.id, name: best.e.name, text: best.e.text?.characters ?? null, rect: best.e.rect },
		score: best.score,
		reason: `글자 ${best.text.toFixed(2)}, 겹침 ${best.overlap.toFixed(2)}, 근접 ${best.near.toFixed(2)}`,
		alternatives,
		textDiffs: diffTexts(expected, best.texts, options.calloutTextMatch)
	};
}

export interface SpecGuiLink {
	specFrameId: string;
	screenId: string | null;
	pair: FramePair | null;
	/** 2위와 점수 차가 작아 사람이 확인해야 함 */
	ambiguous: boolean;
	candidates: FramePair[];
	callouts: CalloutLink[];
}

/** 화면설계서 하나를 GUI 프레임들과 연결: 화면 짝 → 콜아웃마다 GUI 요소 */
export function linkSpecToGui(
	spec: SpecScreen,
	specFrame: NormalizedFrame,
	guiFrames: readonly NormalizedFrame[],
	options: LinkOptions = DEFAULT_LINK_OPTIONS
): SpecGuiLink {
	const ranked = scoreGuiFrames(spec, specFrame, guiFrames, options);
	const top = ranked[0];
	const second = ranked[1];
	const found = top !== undefined && top.pair.score >= options.minPairScore ? top : undefined;
	return {
		specFrameId: spec.frameId,
		screenId: spec.screenId,
		pair: found?.pair ?? null,
		ambiguous:
			found !== undefined &&
			second !== undefined &&
			found.pair.score - second.pair.score < options.pairAmbiguityMargin,
		candidates: ranked.slice(0, 3).map((x) => x.pair),
		callouts: found?.links ?? []
	};
}
