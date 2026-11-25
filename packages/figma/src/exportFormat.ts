/**
 * Figma 내보내기 형식 (D-009). 플러그인(apps/figma-plugin)이 이 형식으로 쓰고, 이 패키지가 읽는다.
 * 플러그인은 가공하지 않은 값을 넣고, 판단(숨김·경계 밖 제외, 묶기, 포커스 추정)은 모두 정규화 쪽에서 한다.
 * 그래야 정규화 규칙이 바뀌어도 다시 내보낼 필요가 없다.
 */

export const EXPORT_FORMAT = 'auto-qa-figma-export';
export const EXPORT_VERSION = 1;

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

export type ExportedPaint =
	| { type: 'SOLID'; visible: boolean; opacity: number; color: Rgba }
	| {
			type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
			visible: boolean;
			opacity: number;
			stops: { position: number; color: Rgba }[];
	  }
	| { type: 'IMAGE' | 'VIDEO'; visible: boolean; opacity: number; scaleMode: string }
	| { type: string; visible: boolean; opacity: number };

export interface ExportedEffect {
	type: string;
	visible: boolean;
	radius: number;
	color?: Rgba;
	offset?: { x: number; y: number };
	spread?: number;
}

export interface TextSegment {
	start: number;
	end: number;
	fontFamily: string;
	fontStyle: string;
	fontWeight: number;
	fontSize: number;
	/** unit: PIXELS | PERCENT | AUTO */
	lineHeight: { unit: string; value?: number };
	letterSpacing: { unit: string; value: number };
	textDecoration: string;
	textCase: string;
	fills: ExportedPaint[];
}

export interface ExportedText {
	characters: string;
	segments: TextSegment[];
	alignHorizontal: string;
	alignVertical: string;
	autoResize: string;
	/** DISABLED | ENDING */
	truncation: string;
	maxLines: number | null;
}

export interface ExportedLayout {
	mode: string;
	itemSpacing: number;
	padding: [number, number, number, number];
	primaryAxisAlign: string;
	counterAxisAlign: string;
}

export interface ExportedComponent {
	/** 메인 컴포넌트 이름 (변형이면 "Property=Value" 형식) */
	name: string;
	/** 컴포넌트 세트 이름 (변형일 때) */
	setName: string | null;
	properties: Record<string, string | boolean>;
}

export interface ExportedReaction {
	trigger: string;
	action: string;
	destinationId: string | null;
	navigation: string | null;
}

export interface ExportedNode {
	id: string;
	name: string;
	type: string;
	visible: boolean;
	opacity: number;
	/** absoluteBoundingBox (회전 전 경계) */
	box: Box | null;
	/** absoluteRenderBounds (그림자·테두리·잘림 반영, 안 보이면 null) */
	renderBox: Box | null;
	rotation: number;
	clipsContent: boolean;
	fills: ExportedPaint[];
	strokes: ExportedPaint[];
	/** 'mixed'는 변마다 다름 */
	strokeWeight: number | 'mixed' | null;
	strokeAlign: string | null;
	/** 네 모서리 [좌상, 우상, 우하, 좌하] */
	cornerRadius: [number, number, number, number] | null;
	effects: ExportedEffect[];
	layout: ExportedLayout | null;
	component: ExportedComponent | null;
	text: ExportedText | null;
	reactions: ExportedReaction[];
	children: ExportedNode[];
}

export interface ExportedImage {
	/** PNG base64 */
	data: string;
	scale: number;
	width: number;
	height: number;
}

export interface ExportedFrame {
	pageId: string;
	pageName: string;
	node: ExportedNode;
	image: ExportedImage | null;
}

export interface FigmaExport {
	format: typeof EXPORT_FORMAT;
	version: typeof EXPORT_VERSION;
	exportedAt: string;
	plugin: { version: string };
	file: { name: string; key: string | null };
	frames: ExportedFrame[];
	/** 플러그인이 내보내지 못한 노드와 이유 */
	warnings: string[];
}

export class ExportFormatError extends Error {
	override name = 'ExportFormatError';
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkNode(value: unknown, path: string): void {
	if (!isObject(value)) throw new ExportFormatError(`${path}: 노드가 객체가 아닙니다`);
	for (const key of ['id', 'name', 'type'] as const) {
		if (typeof value[key] !== 'string') throw new ExportFormatError(`${path}.${key}: 문자열이어야 합니다`);
	}
	if (typeof value.visible !== 'boolean') throw new ExportFormatError(`${path}.visible: boolean이어야 합니다`);
	if (!Array.isArray(value.children)) throw new ExportFormatError(`${path}.children: 배열이어야 합니다`);
	value.children.forEach((child, i) => checkNode(child, `${path}.children[${i}]`));
}

/** JSON을 읽어 형식·버전·필수 필드를 확인한다 (깊은 검증은 노드의 필수 필드까지) */
export function parseExport(json: unknown): FigmaExport {
	if (!isObject(json)) throw new ExportFormatError('내보내기 파일이 객체가 아닙니다');
	if (json.format !== EXPORT_FORMAT) {
		throw new ExportFormatError(`형식이 다릅니다: ${String(json.format)} (기대: ${EXPORT_FORMAT})`);
	}
	if (json.version !== EXPORT_VERSION) {
		throw new ExportFormatError(`지원하지 않는 버전입니다: ${String(json.version)} (지원: ${EXPORT_VERSION})`);
	}
	if (!Array.isArray(json.frames)) throw new ExportFormatError('frames가 배열이 아닙니다');
	json.frames.forEach((frame, i) => {
		if (!isObject(frame)) throw new ExportFormatError(`frames[${i}]: 객체가 아닙니다`);
		checkNode(frame.node, `frames[${i}].node`);
	});
	return json as unknown as FigmaExport;
}
