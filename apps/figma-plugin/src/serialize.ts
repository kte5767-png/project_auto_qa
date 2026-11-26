import type {
	Box,
	ExportedEffect,
	ExportedNode,
	ExportedPaint,
	ExportedReaction,
	ExportedText,
	Rgba,
	TextSegment
} from '@auto-qa/figma/format';

/**
 * Figma 노드 → 내보내기 노드. 값은 가공하지 않고 옮긴다 (판단은 @auto-qa/figma 정규화가 한다).
 * Figma API는 버전마다 필드가 늘거나 바뀌므로, 필드는 있는지 확인하며 읽고 없으면 기본값을 쓴다.
 * `figma` 전역 없이 테스트할 수 있도록 figma.mixed 기호를 인자로 받는다.
 */

type Loose = Record<string, unknown>;

export interface SerializeContext {
	/** figma.mixed */
	mixed: symbol;
	warnings: string[];
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function box(v: unknown): Box | null {
	if (typeof v !== 'object' || v === null) return null;
	const b = v as Loose;
	return { x: num(b.x), y: num(b.y), width: num(b.width), height: num(b.height) };
}

function rgba(v: unknown, alpha?: number): Rgba {
	const c = (typeof v === 'object' && v !== null ? v : {}) as Loose;
	return { r: num(c.r), g: num(c.g), b: num(c.b), a: alpha ?? num(c.a, 1) };
}

export function paint(p: unknown): ExportedPaint {
	const v = p as Loose;
	const type = str(v.type, 'UNKNOWN');
	const base = { visible: v.visible !== false, opacity: num(v.opacity, 1) };
	if (type === 'SOLID') return { type: 'SOLID', ...base, color: rgba(v.color, 1) };
	if (type.startsWith('GRADIENT_')) {
		const stops = Array.isArray(v.gradientStops) ? (v.gradientStops as Loose[]) : [];
		return {
			type: type as 'GRADIENT_LINEAR',
			...base,
			stops: stops.map((s) => ({ position: num(s.position), color: rgba(s.color) }))
		};
	}
	if (type === 'IMAGE' || type === 'VIDEO') return { type, ...base, scaleMode: str(v.scaleMode, 'FILL') };
	return { type, ...base };
}

function paints(v: unknown): ExportedPaint[] {
	return Array.isArray(v) ? v.map(paint) : [];
}

function effects(v: unknown): ExportedEffect[] {
	if (!Array.isArray(v)) return [];
	return (v as Loose[]).map((e) => {
		const out: ExportedEffect = { type: str(e.type), visible: e.visible !== false, radius: num(e.radius) };
		if (e.color !== undefined) out.color = rgba(e.color);
		if (e.offset !== undefined) {
			const o = e.offset as Loose;
			out.offset = { x: num(o.x), y: num(o.y) };
		}
		if (e.spread !== undefined) out.spread = num(e.spread);
		return out;
	});
}

function cornerRadius(n: Loose, ctx: SerializeContext): ExportedNode['cornerRadius'] {
	if (!('cornerRadius' in n)) return null;
	if (n.cornerRadius !== ctx.mixed) {
		const r = num(n.cornerRadius);
		return [r, r, r, r];
	}
	return [num(n.topLeftRadius), num(n.topRightRadius), num(n.bottomRightRadius), num(n.bottomLeftRadius)];
}

/** 읽을 속성. Figma는 일부 속성(예: 오류가 있는 컴포넌트 세트의 componentProperties)을 읽을 때 예외를 낸다 */
const FIELDS = [
	'id',
	'name',
	'type',
	'visible',
	'opacity',
	'absoluteBoundingBox',
	'absoluteRenderBounds',
	'rotation',
	'clipsContent',
	'fills',
	'strokes',
	'strokeWeight',
	'strokeAlign',
	'cornerRadius',
	'topLeftRadius',
	'topRightRadius',
	'bottomRightRadius',
	'bottomLeftRadius',
	'effects',
	'layoutMode',
	'itemSpacing',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'primaryAxisAlignItems',
	'counterAxisAlignItems',
	'characters',
	'textAlignHorizontal',
	'textAlignVertical',
	'textAutoResize',
	'textTruncation',
	'maxLines',
	'reactions',
	'componentProperties',
	'children'
] as const;

function errorText(error: unknown): string {
	return String(error).replace(/^Error:\s*/, '');
}

/** 속성을 하나씩 읽어 복사한다. 읽다 예외가 나면 그 속성만 빼고 경고를 남긴다 */
export function snapshot(node: Loose, ctx: SerializeContext): Loose {
	const out: Loose = {};
	const label = (): string => `${str(out.id, '?')} "${str(out.name)}"`;
	for (const key of FIELDS) {
		try {
			if (!(key in node)) continue;
			out[key] = node[key];
		} catch (error) {
			ctx.warnings.push(`${label()}: ${key}를 읽지 못해 비워 둠 (${errorText(error)})`);
		}
	}
	return out;
}

function text(n: Loose, original: Loose, ctx: SerializeContext): ExportedText | null {
	if (n.type !== 'TEXT') return null;
	let segments: TextSegment[] = [];
	const getSegments = original.getStyledTextSegments;
	if (typeof getSegments === 'function') {
		try {
			const raw = getSegments.call(original, [
				'fontName',
				'fontSize',
				'fontWeight',
				'lineHeight',
				'letterSpacing',
				'textDecoration',
				'textCase',
				'fills'
			]) as Loose[];
			segments = raw.map((s) => {
				const font = (s.fontName ?? {}) as Loose;
				const lh = (s.lineHeight ?? {}) as Loose;
				const ls = (s.letterSpacing ?? {}) as Loose;
				const lineHeight: TextSegment['lineHeight'] =
					lh.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: str(lh.unit, 'AUTO'), value: num(lh.value) };
				return {
					start: num(s.start),
					end: num(s.end),
					fontFamily: str(font.family),
					fontStyle: str(font.style),
					fontWeight: num(s.fontWeight, 400),
					fontSize: num(s.fontSize),
					lineHeight,
					letterSpacing: { unit: str(ls.unit, 'PIXELS'), value: num(ls.value) },
					textDecoration: str(s.textDecoration, 'NONE'),
					textCase: str(s.textCase, 'ORIGINAL'),
					fills: paints(s.fills)
				};
			});
		} catch (error) {
			ctx.warnings.push(`${str(n.id)} "${str(n.name)}": 글자 스타일을 읽지 못함 (${errorText(error)})`);
		}
	}
	return {
		characters: str(n.characters),
		segments,
		alignHorizontal: str(n.textAlignHorizontal, 'LEFT'),
		alignVertical: str(n.textAlignVertical, 'TOP'),
		autoResize: str(n.textAutoResize, 'NONE'),
		truncation: str(n.textTruncation, 'DISABLED'),
		maxLines: typeof n.maxLines === 'number' ? n.maxLines : null
	};
}

function layout(n: Loose): ExportedNode['layout'] {
	if (typeof n.layoutMode !== 'string' || n.layoutMode === 'NONE') return null;
	return {
		mode: n.layoutMode,
		itemSpacing: num(n.itemSpacing),
		padding: [num(n.paddingTop), num(n.paddingRight), num(n.paddingBottom), num(n.paddingLeft)],
		primaryAxisAlign: str(n.primaryAxisAlignItems),
		counterAxisAlign: str(n.counterAxisAlignItems)
	};
}

function reactions(n: Loose): ExportedReaction[] {
	if (!Array.isArray(n.reactions)) return [];
	const out: ExportedReaction[] = [];
	for (const r of n.reactions as Loose[]) {
		const trigger = str((r.trigger as Loose | null)?.type, 'NONE');
		const actions = Array.isArray(r.actions) ? (r.actions as Loose[]) : r.action ? [r.action as Loose] : [];
		for (const a of actions) {
			out.push({
				trigger,
				action: str(a.type),
				destinationId: typeof a.destinationId === 'string' ? a.destinationId : null,
				navigation: typeof a.navigation === 'string' ? a.navigation : null
			});
		}
	}
	return out;
}

async function component(n: Loose, original: Loose, ctx: SerializeContext): Promise<ExportedNode['component']> {
	if (n.type !== 'INSTANCE') return null;
	let name = str(n.name);
	let setName: string | null = null;
	try {
		const getMain = original.getMainComponentAsync;
		const main = typeof getMain === 'function' ? ((await getMain.call(original)) as Loose | null) : null;
		if (main !== null) {
			name = str(main.name, name);
			const parent = main.parent as Loose | null | undefined;
			if (parent?.type === 'COMPONENT_SET') setName = str(parent.name);
		}
	} catch (error) {
		ctx.warnings.push(`${str(n.id)} "${str(n.name)}": 메인 컴포넌트를 읽지 못함 (${errorText(error)})`);
	}
	const properties: Record<string, string | boolean> = {};
	const props = (n.componentProperties ?? {}) as Record<string, Loose | null>;
	for (const [key, value] of Object.entries(props)) {
		const v = value?.value;
		// 변형이 아닌 속성 이름에는 "#숫자:숫자"가 붙는다
		if (typeof v === 'string' || typeof v === 'boolean') properties[key.replace(/#[\d:]+$/, '')] = v;
	}
	return { name, setName, properties };
}

/**
 * 노드 하나와 자손을 옮긴다. 읽지 못한 속성은 경고를 남기고 기본값으로 채운다.
 * 한 노드에서 예상하지 못한 오류가 나도 전체 내보내기는 멈추지 않는다.
 */
export async function serializeNode(node: unknown, ctx: SerializeContext): Promise<ExportedNode> {
	const original = node as Loose;
	const n = snapshot(original, ctx);
	try {
		return await serializeFields(n, original, ctx);
	} catch (error) {
		ctx.warnings.push(
			`${str(n.id, '?')} "${str(n.name)}": 노드를 읽지 못해 자손 없이 기본값으로 둠 (${errorText(error)})`
		);
		return {
			id: str(n.id),
			name: str(n.name),
			type: str(n.type),
			visible: n.visible !== false,
			opacity: num(n.opacity, 1),
			box: box(n.absoluteBoundingBox),
			renderBox: null,
			rotation: 0,
			clipsContent: false,
			fills: [],
			strokes: [],
			strokeWeight: null,
			strokeAlign: null,
			cornerRadius: null,
			effects: [],
			layout: null,
			component: null,
			text: null,
			reactions: [],
			children: []
		};
	}
}

async function serializeFields(n: Loose, original: Loose, ctx: SerializeContext): Promise<ExportedNode> {
	const children: ExportedNode[] = [];
	if (Array.isArray(n.children)) {
		for (const child of n.children) children.push(await serializeNode(child, ctx));
	}
	const strokeWeight =
		n.strokeWeight === ctx.mixed ? 'mixed' : typeof n.strokeWeight === 'number' ? n.strokeWeight : null;
	return {
		id: str(n.id),
		name: str(n.name),
		type: str(n.type),
		visible: n.visible !== false,
		opacity: num(n.opacity, 1),
		box: box(n.absoluteBoundingBox),
		renderBox: box(n.absoluteRenderBounds),
		rotation: num(n.rotation),
		clipsContent: n.clipsContent === true,
		// 글자 칠이 구간마다 다르면 mixed — 글자 색은 구간(segments)에서 읽는다
		fills: n.fills === ctx.mixed ? [] : paints(n.fills),
		strokes: paints(n.strokes),
		strokeWeight,
		strokeAlign: typeof n.strokeAlign === 'string' ? n.strokeAlign : null,
		cornerRadius: cornerRadius(n, ctx),
		effects: effects(n.effects),
		layout: layout(n),
		component: await component(n, original, ctx),
		text: text(n, original, ctx),
		reactions: reactions(n),
		children
	};
}

/** 노드가 속한 페이지 */
export function pageOf(node: unknown): { id: string; name: string } {
	let cur = node as Loose | null | undefined;
	while (cur !== null && cur !== undefined) {
		if (cur.type === 'PAGE') return { id: str(cur.id), name: str(cur.name) };
		cur = cur.parent as Loose | null | undefined;
	}
	return { id: '', name: '' };
}
