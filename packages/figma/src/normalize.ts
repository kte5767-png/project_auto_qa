import { area, clipToViewport } from '@auto-qa/core';
import type { Rect, Visibility } from '@auto-qa/core';
import type { ExportedFrame, ExportedNode, ExportedPaint, Rgba } from './exportFormat';
import { meaningfulName } from './names';

/**
 * 프레임 하나를 평평한 요소 목록으로 정규화한다 (설계 7.2, D-011).
 * 요소는 지우지 않고 표시만 한다: 숨김(hidden), 경계 밖(visibility = clipped), 경계에 걸침(partial).
 * 좌표는 프레임 왼쪽 위 기준이다.
 */

export type ElementKind = 'text' | 'image' | 'instance' | 'container' | 'shape' | 'vector';

export interface ColorSummary {
	/** #RRGGBB, 그라디언트면 'gradient' */
	hex: string;
	/** 칠 불투명도 × 색 알파 */
	alpha: number;
}

export interface TextSummary {
	characters: string;
	fontFamily: string;
	fontStyle: string;
	fontWeight: number;
	fontSize: number;
	lineHeight: string;
	letterSpacing: string;
	color: ColorSummary | null;
	/** 글자마다 스타일이 다름 (대표값은 가장 긴 구간) */
	mixed: boolean;
	align: string;
	truncation: string;
	maxLines: number | null;
}

export interface StyleSummary {
	fill: ColorSummary | null;
	stroke: { color: ColorSummary | null; weight: number | 'mixed' | null; align: string | null } | null;
	cornerRadius: [number, number, number, number] | null;
	shadow: boolean;
	/** 조상까지 곱한 불투명도 */
	opacity: number;
}

export interface FigmaElement {
	id: string;
	name: string;
	type: string;
	kind: ElementKind;
	parentId: string | null;
	childIds: string[];
	depth: number;
	/** 같은 부모 안 순서 */
	index: number;
	rect: Rect;
	visibility: Visibility;
	visibleRect: Rect | null;
	visibleRatio: number;
	/** 자신 또는 조상이 숨김이거나 불투명도 0 */
	hidden: boolean;
	/** 숨김의 원인 노드 (자신 또는 조상) */
	hiddenBy: string | null;
	/** 앵커로 쓸 수 있는 이름 (자동 생성·일반명이면 null) */
	anchorName: string | null;
	/** 컴포넌트 인스턴스 안에 있음 (또는 인스턴스 자신) */
	inInstance: boolean;
	component: { name: string; setName: string | null; properties: Record<string, string | boolean> } | null;
	text: TextSummary | null;
	style: StyleSummary;
}

export interface NormalizedFrame {
	id: string;
	name: string;
	pageName: string;
	width: number;
	height: number;
	elements: FigmaElement[];
	/** 요소 id → 순번 */
	index: Map<string, number>;
}

const hex2 = (v: number): string =>
	Math.round(Math.min(1, Math.max(0, v)) * 255)
		.toString(16)
		.padStart(2, '0')
		.toUpperCase();

export function rgbaToHex(c: Rgba): string {
	return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** 보이는 첫 번째 칠 (Figma는 목록 뒤쪽이 위에 그려지므로 맨 위 칠) */
export function topPaint(paints: readonly ExportedPaint[]): ColorSummary | null {
	for (let i = paints.length - 1; i >= 0; i--) {
		const p = paints[i];
		if (p === undefined || !p.visible || p.opacity === 0) continue;
		if (p.type === 'SOLID' && 'color' in p) return { hex: rgbaToHex(p.color), alpha: round(p.color.a * p.opacity) };
		if (p.type.startsWith('GRADIENT')) return { hex: 'gradient', alpha: round(p.opacity) };
		if (p.type === 'IMAGE' || p.type === 'VIDEO') return { hex: 'image', alpha: round(p.opacity) };
	}
	return null;
}

const round = (v: number, digits = 3): number => Math.round(v * 10 ** digits) / 10 ** digits;

function kindOf(node: ExportedNode): ElementKind {
	if (node.type === 'TEXT') return 'text';
	if (node.fills.some((p) => p.visible && (p.type === 'IMAGE' || p.type === 'VIDEO'))) return 'image';
	if (node.type === 'INSTANCE') return 'instance';
	if (['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(node.type)) {
		return node.children.length > 0 ? 'container' : 'shape';
	}
	if (['RECTANGLE', 'ELLIPSE'].includes(node.type)) return 'shape';
	return 'vector';
}

function textSummary(node: ExportedNode): TextSummary | null {
	const t = node.text;
	if (t === null) return null;
	const segments = [...t.segments].sort((a, b) => b.end - b.start - (a.end - a.start));
	const main = segments[0];
	const styleKey = (s: (typeof t.segments)[number]): string =>
		JSON.stringify([s.fontFamily, s.fontStyle, s.fontSize, s.lineHeight, s.letterSpacing, topPaint(s.fills)]);
	const mixed = new Set(t.segments.map(styleKey)).size > 1;
	const unit = (v: { unit: string; value?: number }): string =>
		v.unit === 'AUTO' ? 'auto' : `${round(v.value ?? 0, 2)}${v.unit === 'PERCENT' ? '%' : 'px'}`;
	return {
		characters: t.characters,
		fontFamily: main?.fontFamily ?? '',
		fontStyle: main?.fontStyle ?? '',
		fontWeight: main?.fontWeight ?? 0,
		fontSize: main?.fontSize ?? 0,
		lineHeight: main === undefined ? 'auto' : unit(main.lineHeight),
		letterSpacing: main === undefined ? '0px' : unit(main.letterSpacing),
		color: main === undefined ? null : topPaint(main.fills),
		mixed,
		align: t.alignHorizontal,
		truncation: t.truncation,
		maxLines: t.maxLines
	};
}

/** clip 영역 안에서 보이는 정도 */
function visibilityIn(
	rect: Rect,
	clip: Rect | null
): { visibility: Visibility; visibleRect: Rect | null; ratio: number } {
	if (clip === null || clip.width <= 0 || clip.height <= 0)
		return { visibility: 'clipped', visibleRect: null, ratio: 0 };
	const local = clipToViewport(
		{ x: rect.x - clip.x, y: rect.y - clip.y, width: rect.width, height: rect.height },
		{ width: clip.width, height: clip.height }
	);
	const visibleRect =
		local.visibleRect === null
			? null
			: { ...local.visibleRect, x: local.visibleRect.x + clip.x, y: local.visibleRect.y + clip.y };
	return { visibility: local.visibility, visibleRect, ratio: round(local.visibleRatio) };
}

function intersect(a: Rect, b: Rect): Rect | null {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	return right < x || bottom < y ? null : { x, y, width: right - x, height: bottom - y };
}

export function normalizeFrame(frame: ExportedFrame): NormalizedFrame {
	const root = frame.node;
	const origin = root.box ?? { x: 0, y: 0, width: 0, height: 0 };
	const elements: FigmaElement[] = [];
	const frameRect: Rect = { x: 0, y: 0, width: origin.width, height: origin.height };

	const walk = (
		node: ExportedNode,
		parent: FigmaElement | null,
		index: number,
		depth: number,
		clip: Rect | null,
		opacity: number,
		hiddenBy: string | null,
		inInstance: boolean
	): void => {
		const box = node.box ?? { x: origin.x, y: origin.y, width: 0, height: 0 };
		const rect: Rect = {
			x: round(box.x - origin.x, 2),
			y: round(box.y - origin.y, 2),
			width: round(box.width, 2),
			height: round(box.height, 2)
		};
		const effectiveOpacity = round(opacity * node.opacity);
		const hiddenSource = hiddenBy ?? (!node.visible || node.opacity === 0 ? node.id : null);
		const vis = visibilityIn(rect, clip);
		const text = textSummary(node);
		const instance = inInstance || node.type === 'INSTANCE';
		const element: FigmaElement = {
			id: node.id,
			name: node.name,
			type: node.type,
			kind: kindOf(node),
			parentId: parent?.id ?? null,
			childIds: node.children.map((c) => c.id),
			depth,
			index,
			rect,
			visibility: vis.visibility,
			visibleRect: vis.visibleRect,
			visibleRatio: vis.ratio,
			hidden: hiddenSource !== null,
			hiddenBy: hiddenSource,
			anchorName: meaningfulName(node.name, text?.characters ?? null),
			inInstance: instance,
			component: node.component,
			text,
			style: {
				fill: node.type === 'TEXT' ? null : topPaint(node.fills),
				stroke:
					node.strokes.some((p) => p.visible) && node.strokeWeight !== 0
						? { color: topPaint(node.strokes), weight: node.strokeWeight, align: node.strokeAlign }
						: null,
				cornerRadius: node.cornerRadius,
				shadow: node.effects.some((e) => e.visible && e.type.includes('SHADOW')),
				opacity: effectiveOpacity
			}
		};
		elements.push(element);
		// 자식은 이 노드가 내용을 자르면 이 노드 경계로 더 잘린다 (루트는 프레임 = 화면)
		const childClip = depth === 0 ? frameRect : node.clipsContent && clip !== null ? intersect(clip, rect) : clip;
		node.children.forEach((child, i) =>
			walk(child, element, i, depth + 1, childClip, effectiveOpacity, hiddenSource, instance)
		);
	};
	walk(root, null, 0, 0, frameRect, 1, null, false);

	return {
		id: root.id,
		name: root.name,
		pageName: frame.pageName,
		width: origin.width,
		height: origin.height,
		elements,
		index: new Map(elements.map((e, i) => [e.id, i]))
	};
}

export function elementById(frame: NormalizedFrame, id: string): FigmaElement | undefined {
	const i = frame.index.get(id);
	return i === undefined ? undefined : frame.elements[i];
}

/** 화면에 보이는 요소: 숨김 아님, 경계 밖 아님, 실제 넓이 있음 */
export function isShown(e: FigmaElement): boolean {
	return !e.hidden && e.visibility !== 'clipped' && (area(e.rect) > 0 || e.rect.width > 0 || e.rect.height > 0);
}
