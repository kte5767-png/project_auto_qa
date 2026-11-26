import { EXPORT_FORMAT, EXPORT_VERSION } from '@auto-qa/figma/format';
import type { ExportedFrame, FigmaExport } from '@auto-qa/figma/format';
import { pageOf, serializeNode } from './serialize';
import type { SerializeContext } from './serialize';

/**
 * Figma 안에서 실행되는 플러그인 본체 (샌드박스). 선택한 프레임(없으면 현재 페이지의 최상위 프레임)을
 * 노드 트리 + PNG로 모아 UI로 넘긴다. 파일 저장은 UI(iframe)가 한다. 네트워크는 쓰지 않는다 (manifest).
 */

const PLUGIN_VERSION = '0.1.1';
const EXPORTABLE = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION', 'GROUP']);

interface ExportRequest {
	type: 'export';
	scale: number;
	includeImages: boolean;
}

function targets(): SceneNode[] {
	const selected = figma.currentPage.selection.filter((n) => EXPORTABLE.has(n.type));
	if (selected.length > 0) return [...selected];
	return figma.currentPage.children.filter((n) => EXPORTABLE.has(n.type));
}

function postSelection(): void {
	const list = targets();
	figma.ui.postMessage({
		type: 'selection',
		fromSelection: figma.currentPage.selection.length > 0,
		page: figma.currentPage.name,
		frames: list.map((n) => ({ id: n.id, name: n.name, width: Math.round(n.width), height: Math.round(n.height) }))
	});
}

async function runExport(request: ExportRequest): Promise<void> {
	const list = targets();
	const ctx: SerializeContext = { mixed: figma.mixed, warnings: [] };
	const frames: ExportedFrame[] = [];
	const images: { index: number; bytes: Uint8Array; scale: number; width: number; height: number }[] = [];
	for (let i = 0; i < list.length; i++) {
		const target = list[i];
		if (target === undefined) continue;
		figma.ui.postMessage({ type: 'progress', done: i, total: list.length, name: target.name });
		const page = pageOf(target);
		frames.push({ pageId: page.id, pageName: page.name, node: await serializeNode(target, ctx), image: null });
		if (request.includeImages) {
			try {
				const bytes = await target.exportAsync({
					format: 'PNG',
					constraint: { type: 'SCALE', value: request.scale }
				});
				images.push({
					index: i,
					bytes,
					scale: request.scale,
					width: Math.round(target.width * request.scale),
					height: Math.round(target.height * request.scale)
				});
			} catch (error) {
				ctx.warnings.push(`${target.id} "${target.name}": PNG를 만들지 못함 (${String(error)})`);
			}
		}
	}
	const data: FigmaExport = {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		plugin: { version: PLUGIN_VERSION },
		file: { name: figma.root.name, key: typeof figma.fileKey === 'string' ? figma.fileKey : null },
		frames,
		warnings: ctx.warnings
	};
	// PNG는 바이트로 넘기고, base64 변환과 JSON 조립은 UI에서 한다
	figma.ui.postMessage({ type: 'result', data, images });
}

figma.showUI(__html__, { width: 360, height: 440, themeColors: true });
postSelection();
figma.on('selectionchange', postSelection);
figma.on('currentpagechange', postSelection);
figma.ui.onmessage = (message: ExportRequest | { type: 'close' }) => {
	if (message.type === 'close') {
		figma.closePlugin();
		return;
	}
	runExport(message).catch((error: unknown) => {
		figma.ui.postMessage({ type: 'error', message: String(error) });
	});
};
