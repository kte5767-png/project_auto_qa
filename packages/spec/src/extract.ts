import { area } from '@auto-qa/core';
import type { Rect } from '@auto-qa/core';
import { elementById, isShown } from '@auto-qa/figma';
import type { FigmaElement, NormalizedFrame } from '@auto-qa/figma';
import { compareVersions, lines, normalizeLabel, parseDescription, parseScreenTitle, parseVersions } from './describe';
import type { Callout, CalloutTarget, SpecScreen } from './types';

/**
 * 화면설계서 프레임 → SpecScreen (설계 7.11 구조 추출, D-012, D-024). 규칙 기반·결정적이다.
 * 실제 파일은 목업 요소가 목업 상자 안에 묶여 있지 않고 큰 사각형 위에 형제로 놓여 있으므로,
 * "목업 영역 안에 중심이 있는 요소"를 목업 요소로 본다.
 */

export interface SpecOptions {
	/** 목업이 나타내는 실제 화면 크기 */
	screen: { width: number; height: number };
	/** 헤더 영역: 프레임 높이 대비 비율 */
	headerRatio: number;
	/** 목업 판정: 화면 비율 허용 오차, 프레임 너비 대비 최소 너비 */
	mockupAspectTolerance: number;
	mockupMinWidthRatio: number;
	/** 세로로 긴(스크롤된 화면) 목업의 최대 세로/가로 비율. 화면 비율 목업이 없을 때만 쓴다 */
	mockupMaxTallRatio: number;
	/** 마커 원 지름 범위 (px) */
	markerSize: [number, number];
	/** 이름이 같은 목업 글자를 찾을 반경 (px, 페이지 좌표) */
	labelRadius: number;
}

export const DEFAULT_SPEC_OPTIONS: SpecOptions = {
	screen: { width: 1920, height: 1080 },
	headerRatio: 0.09,
	mockupAspectTolerance: 0.03,
	mockupMinWidthRatio: 0.4,
	mockupMaxTallRatio: 2.2,
	markerSize: [16, 96],
	labelRadius: 400
};

interface Marker {
	no: string;
	rect: Rect;
	/** 마커를 이루는 요소 (대상 후보에서 뺀다) */
	ids: Set<string>;
}

const center = (r: Rect): [number, number] => [r.x + r.width / 2, r.y + r.height / 2];
const contains = (r: Rect, [x, y]: [number, number]): boolean =>
	x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** 두 사각형 사이 거리 (겹치면 0) */
function gap(a: Rect, b: Rect): number {
	const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
	const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
	return Math.hypot(dx, dy);
}

function children(frame: NormalizedFrame, e: FigmaElement): FigmaElement[] {
	return e.childIds
		.map((id) => elementById(frame, id))
		.filter((c): c is FigmaElement => c !== undefined && isShown(c));
}

const MARKER_TEXT = /^\s*(\d{1,2}|[A-Z])\s*$/;

/** 번호 마커: 원(ELLIPSE) + 번호 글자. 묶여 있으면 묶음을, 아니면 원을 마커로 본다 */
export function findMarkers(frame: NormalizedFrame, options: SpecOptions = DEFAULT_SPEC_OPTIONS): Marker[] {
	const [min, max] = options.markerSize;
	const isCircle = (e: FigmaElement): boolean =>
		e.type === 'ELLIPSE' &&
		e.rect.width >= min &&
		e.rect.width <= max &&
		Math.abs(e.rect.width - e.rect.height) <= e.rect.width * 0.2;
	const numberIn = (circle: FigmaElement, candidates: FigmaElement[]): FigmaElement | undefined =>
		candidates.find(
			(t) =>
				t.kind === 'text' && MARKER_TEXT.test(t.text?.characters ?? '') && contains(circle.rect, center(t.rect))
		);
	const markers: Marker[] = [];
	const used = new Set<string>();
	for (const e of frame.elements) {
		if (!isShown(e) || e.childIds.length === 0) continue;
		const kids = children(frame, e);
		const circles = kids.filter(isCircle);
		// 묶음 하나가 원 + 번호 하나로 이뤄진 경우
		if (kids.length <= 3 && circles.length === 1) {
			const circle = circles[0] as FigmaElement;
			const label = numberIn(circle, kids);
			if (label !== undefined) {
				markers.push({
					no: (label.text?.characters ?? '').trim(),
					rect: e.rect,
					ids: new Set([e.id, circle.id, label.id])
				});
				for (const id of [e.id, circle.id, label.id]) used.add(id);
				continue;
			}
		}
		// 묶이지 않고 형제로 놓인 원 + 번호
		for (const circle of circles) {
			if (used.has(circle.id)) continue;
			const label = numberIn(
				circle,
				kids.filter((k) => !used.has(k.id))
			);
			if (label === undefined) continue;
			markers.push({
				no: (label.text?.characters ?? '').trim(),
				rect: circle.rect,
				ids: new Set([circle.id, label.id])
			});
			used.add(circle.id);
			used.add(label.id);
		}
	}
	return markers.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

/**
 * 목업: 화면 비율(예: 16:9)이고 충분히 큰 가장 큰 상자. 없으면 같은 너비 조건의 세로로 긴 상자
 * (스크롤된 화면을 한 장에 그린 목업, 예: 1200×900)를 쓴다.
 */
export function findMockup(frame: NormalizedFrame, options: SpecOptions = DEFAULT_SPEC_OPTIONS): FigmaElement | null {
	const screenRatio = options.screen.height / options.screen.width;
	let exact: FigmaElement | null = null;
	let tall: FigmaElement | null = null;
	for (const e of frame.elements.slice(1)) {
		if (!isShown(e) || e.kind === 'text' || e.rect.height === 0 || e.style.fill === null) continue;
		if (e.rect.width < frame.width * options.mockupMinWidthRatio) continue;
		const ratio = e.rect.height / e.rect.width;
		if (Math.abs(ratio / screenRatio - 1) <= options.mockupAspectTolerance) {
			if (exact === null || area(e.rect) > area(exact.rect)) exact = e;
		} else if (ratio > screenRatio && ratio <= options.mockupMaxTallRatio) {
			if (tall === null || area(e.rect) > area(tall.rect)) tall = e;
		}
	}
	return exact ?? tall;
}

function textOf(e: FigmaElement): string {
	return e.text?.characters ?? '';
}

function resolveTarget(
	frame: NormalizedFrame,
	marker: Marker,
	label: string | null,
	mockup: FigmaElement,
	candidates: FigmaElement[],
	toScreen: (r: Rect) => Rect,
	options: SpecOptions
): CalloutTarget | null {
	const c = center(marker.rect);
	const markerArea = area(marker.rect);
	const mockupArea = area(mockup.rect);
	const make = (
		e: FigmaElement,
		method: CalloutTarget['method'],
		confidence: number,
		reason: string
	): CalloutTarget => ({
		method,
		elementId: e.id,
		name: e.name,
		text: e.text?.characters ?? null,
		specRect: e.rect,
		screenRect: toScreen(e.rect),
		confidence,
		reason
	});
	// 가장 작은 상자. 크기가 거의 같으면(2% 이내, 예: 묶음과 그 배경 사각형) 바깥 묶음을 고른다
	const smallest = (list: FigmaElement[]): FigmaElement | undefined => {
		const min = Math.min(...list.map((e) => area(e.rect)));
		return list
			.filter((e) => area(e.rect) <= min * 1.02)
			.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))[0];
	};

	// 1) 마커를 감싼 강조 상자 (칠 없이 테두리만)
	const boxes = candidates.filter(
		(e) =>
			e.kind !== 'text' &&
			e.style.stroke !== null &&
			(e.style.fill === null || e.style.fill.alpha === 0) &&
			contains(e.rect, c) &&
			area(e.rect) >= markerArea * 4
	);
	const box = smallest(boxes);
	if (box !== undefined) return make(box, 'annotation-box', 0.9, '마커를 감싼 강조 상자');

	// 2) 설명 이름과 같은 목업 글자
	const wanted = label === null ? '' : normalizeLabel(label);
	if (wanted.length >= 2) {
		const hits = candidates
			.filter(
				(e) =>
					e.kind === 'text' &&
					normalizeLabel(textOf(e)) === wanted &&
					gap(e.rect, marker.rect) <= options.labelRadius
			)
			.sort((a, b) => gap(a.rect, marker.rect) - gap(b.rect, marker.rect));
		const hit = hits[0];
		if (hit !== undefined) return make(hit, 'label', 0.85, `설명 이름 "${label}"과 같은 목업 글자`);
	}

	// 3) 마커를 감싼 목업 상자 (예: 키보드 전체)
	const containers = candidates.filter(
		(e) =>
			e.kind !== 'text' &&
			contains(e.rect, c) &&
			area(e.rect) >= markerArea * 4 &&
			area(e.rect) <= mockupArea * 0.6
	);
	const container = smallest(containers);
	if (container !== undefined) return make(container, 'container', 0.6, '마커를 감싼 목업 상자');

	// 4) 가장 가까운 요소 (마커는 보통 대상 왼쪽에 찍히므로 오른쪽을 조금 우선) → 같은 거리의 바깥 묶음으로 올라간다
	// 마커와 같은 높이(세로 범위가 마커 중심을 지남)에 있는 요소를 우선한다
	const aligned = (e: FigmaElement): boolean => e.rect.y <= c[1] && e.rect.y + e.rect.height >= c[1];
	const cost = (e: FigmaElement): number =>
		gap(e.rect, marker.rect) + (center(e.rect)[0] < c[0] ? 40 : 0) + (aligned(e) ? 0 : 20);
	const near = candidates
		.filter((e) => area(e.rect) >= markerArea * 0.25)
		.sort((a, b) => cost(a) - cost(b) || area(b.rect) - area(a.rect))[0];
	if (near === undefined) return null;
	const inMockup = new Set(candidates.map((e) => e.id));
	let target = near;
	const baseGap = gap(near.rect, marker.rect);
	for (let p = elementById(frame, target.parentId ?? ''); p !== undefined; p = elementById(frame, p.parentId ?? '')) {
		if (!inMockup.has(p.id) || area(p.rect) > mockupArea * 0.25 || gap(p.rect, marker.rect) > baseGap + 4) break;
		target = p;
	}
	const g = Math.round(gap(target.rect, marker.rect));
	return make(target, 'nearest', g <= 24 ? 0.6 : 0.4, `가장 가까운 목업 요소 (거리 ${g}px)`);
}

export function extractSpecScreen(frame: NormalizedFrame, options: SpecOptions = DEFAULT_SPEC_OPTIONS): SpecScreen {
	const diagnostics: string[] = [];
	const shown = frame.elements.slice(1).filter(isShown);
	const texts = shown.filter((e) => e.kind === 'text' && textOf(e).trim() !== '');
	const offFrameNotes = frame.elements
		.slice(1)
		.filter((e) => !e.hidden && e.visibility === 'clipped' && e.kind === 'text')
		.map(textOf);

	const markers = findMarkers(frame, options);
	const markerIds = new Set(markers.flatMap((m) => [...m.ids]));
	const mockupEl = findMockup(frame, options);
	const headerBottom = Math.min(frame.height * options.headerRatio, mockupEl?.rect.y ?? Infinity);
	const inHeader = (e: FigmaElement): boolean => e.rect.y + e.rect.height <= headerBottom + 4;

	// 헤더: 가장 큰 화면 번호 글자 = 이 화면, 나머지 번호 글자 = 상위 화면
	const titled = texts
		.filter((e) => inHeader(e) && !markerIds.has(e.id))
		.map((e) => ({ e, parsed: parseScreenTitle(textOf(e)) }))
		.filter((x): x is { e: FigmaElement; parsed: { screenId: string; title: string } } => x.parsed !== null)
		.sort((a, b) => (b.e.text?.fontSize ?? 0) - (a.e.text?.fontSize ?? 0));
	const main = titled[0]?.parsed ?? null;
	if (main === null) diagnostics.push('화면 번호 제목(예: "4.1. …")을 찾지 못함');
	const parents = titled
		.slice(1)
		.map((x) => x.parsed)
		.filter((p) => main !== null && main.screenId.startsWith(`${p.screenId}.`));

	const versions = texts
		.filter((e) => /^\s*\[v\d/i.test(textOf(e)))
		.flatMap((e) => parseVersions(textOf(e)))
		.sort((a, b) => compareVersions(b.version, a.version));
	const modified = texts.some((e) => inHeader(e) && textOf(e).trim() === 'M');
	const pageNumber =
		texts.find((e) => e.name === 'PageNumberText') ??
		texts.find(
			(e) => /^\d{1,4}$/.test(textOf(e).trim()) && e.rect.x > frame.width * 0.9 && e.rect.y > frame.height * 0.9
		);

	const notes = texts.filter((e) => /^\s*\[추가\s*설명\]/.test(textOf(e))).flatMap((e) => lines(textOf(e)).slice(1));
	const audioGuidance = texts
		.filter((e) => /^\s*audio\s*guidance\b/i.test(textOf(e)))
		.flatMap((e) => lines(textOf(e)).slice(1));

	let mockup: SpecScreen['mockup'] = null;
	let entryConditions: string[] = [];
	const callouts: Callout[] = [];
	if (mockupEl === null) {
		diagnostics.push('목업(화면 비율 사각형)을 찾지 못함 — 콜아웃 위치를 화면 좌표로 바꿀 수 없음');
	} else {
		const m = mockupEl.rect;
		const scale = options.screen.width / m.width;
		// 세로로 긴 목업은 스크롤된 화면이므로 화면 좌표의 세로 범위가 화면 높이보다 길다
		const contentHeight = Math.max(options.screen.height, Math.round(m.height * scale));
		mockup = {
			rect: m,
			scale: round1(scale * 1000) / 1000,
			screen: options.screen,
			scroll: contentHeight > options.screen.height,
			contentHeight
		};
		// 화면 범위로 자른다 (강조 상자가 목업보다 조금 크게 그려진 경우)
		const toScreen = (r: Rect): Rect => {
			const x1 = Math.max(0, (r.x - m.x) * scale);
			const y1 = Math.max(0, (r.y - m.y) * scale);
			const x2 = Math.min(options.screen.width, (r.x + r.width - m.x) * scale);
			const y2 = Math.min(contentHeight, (r.y + r.height - m.y) * scale);
			return {
				x: round1(x1),
				y: round1(y1),
				width: round1(Math.max(0, x2 - x1)),
				height: round1(Math.max(0, y2 - y1))
			};
		};
		entryConditions = texts
			.filter((e) => !inHeader(e) && e.rect.y + e.rect.height <= m.y + 4 && !markerIds.has(e.id))
			.sort((a, b) => a.rect.y - b.rect.y)
			.flatMap((e) => lines(textOf(e)));

		const inside = (e: FigmaElement): boolean => contains(m, center(e.rect));
		const candidates = shown.filter(
			(e) => e.id !== mockupEl.id && !markerIds.has(e.id) && inside(e) && area(e.rect) < area(m) * 0.95
		);
		const mockMarkers = markers.filter((mk) => contains(m, center(mk.rect)));
		// 설명이 헤더 선 바로 아래에서 시작하는 쪽도 있으므로, 마커가 헤더 안에 완전히 들어 있을 때만 뺀다
		const descMarkers = markers.filter(
			(mk) => !contains(m, center(mk.rect)) && mk.rect.y + mk.rect.height > headerBottom
		);

		// 설명 마커 → 오른쪽에 붙은 글자
		const descriptions = new Map<string, { rect: Rect; text: string }>();
		for (const mk of descMarkers) {
			const right = mk.rect.x + mk.rect.width;
			const text = texts
				.filter(
					(t) =>
						!markerIds.has(t.id) &&
						t.rect.x >= right - 8 &&
						Math.abs(t.rect.y - mk.rect.y) <= mk.rect.height
				)
				.sort(
					(a, b) =>
						a.rect.x - right - (b.rect.x - right) ||
						Math.abs(a.rect.y - mk.rect.y) - Math.abs(b.rect.y - mk.rect.y)
				)[0];
			if (text === undefined) {
				diagnostics.push(`설명 마커 ${mk.no}: 옆에 설명 글자가 없음`);
				continue;
			}
			if (descriptions.has(mk.no)) diagnostics.push(`설명 마커 ${mk.no}가 두 번 있음 (첫 번째 사용)`);
			else descriptions.set(mk.no, { rect: mk.rect, text: textOf(text) });
		}

		const numbers = [...new Set([...mockMarkers.map((x) => x.no), ...descriptions.keys()])].sort(
			(a, b) => Number(a) - Number(b) || a.localeCompare(b)
		);
		for (const no of numbers) {
			const placed = mockMarkers.filter((x) => x.no === no);
			if (placed.length > 1) diagnostics.push(`목업 마커 ${no}가 ${placed.length}개 (첫 번째 사용)`);
			const marker = placed[0];
			const desc = descriptions.get(no);
			const description = desc === undefined ? null : parseDescription(desc.text);
			const target =
				marker === undefined
					? null
					: resolveTarget(frame, marker, description?.label ?? null, mockupEl, candidates, toScreen, options);
			if (marker === undefined) diagnostics.push(`콜아웃 ${no}: 목업 위 마커가 없음 (설명만 있음)`);
			else if (description === null)
				diagnostics.push(`콜아웃 ${no}: 설명이 없음 (같은 화면의 다른 쪽에 있을 수 있음)`);
			if (marker !== undefined && target === null) diagnostics.push(`콜아웃 ${no}: 가리키는 요소를 찾지 못함`);
			callouts.push({
				no,
				label: description?.label ?? null,
				description,
				markerRect: marker?.rect ?? null,
				descriptionMarkerRect: desc?.rect ?? null,
				target
			});
		}
	}

	return {
		frameId: frame.id,
		frameName: frame.name,
		pageName: frame.pageName,
		screenId: main?.screenId ?? null,
		title: main?.title ?? null,
		parents,
		pageNumber: pageNumber === undefined ? null : textOf(pageNumber).trim(),
		modified,
		entryConditions,
		defaultFocus: /Default\s*Focus\s*[:：]\s*([^)\n]+)/i.exec(entryConditions.join('\n'))?.[1]?.trim() ?? null,
		mockup,
		callouts,
		notes,
		audioGuidance,
		versions,
		offFrameNotes,
		diagnostics
	};
}
