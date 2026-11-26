import { EXPORT_FORMAT, EXPORT_VERSION } from '@auto-qa/figma/format';
import type { ExportedFrame, FigmaExport } from '@auto-qa/figma/format';
import { planBatches } from './batch';
import type { Batch } from './batch';
import { pageOf, serializeNode } from './serialize';
import type { SerializeContext } from './serialize';

/**
 * Figma 안에서 실행되는 플러그인 본체 (샌드박스). 선택한 프레임(없으면 현재 페이지의 최상위 프레임)을
 * 노드 트리 + PNG로 모아 UI로 넘긴다. 파일 저장은 UI(iframe)가 한다. 네트워크는 쓰지 않는다 (manifest).
 *
 * 0.2.0: 프레임이 많으면(예: GUI 355개) 한 번에 모으다 Figma가 멈춘다 → N개씩 묶어 파일 하나씩 저장하고,
 * UI가 저장을 마쳤다고 알려야 다음 묶음을 만든다. 프레임 사이에 한 번씩 쉬어 Figma가 응답 없음으로 끊지 않게 한다.
 */

const PLUGIN_VERSION = '0.2.0';
const EXPORTABLE = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION', 'GROUP']);

interface ExportRequest {
	type: 'export';
	scale: number;
	includeImages: boolean;
	/** 한 파일에 담을 프레임 수 (0 = 전부 한 파일) */
	batchSize: number;
	/** 시작 번호 (1부터, 중간에 멈춘 뒤 이어서) */
	start: number;
}

type UiMessage = ExportRequest | { type: 'close' } | { type: 'part-saved' } | { type: 'cancel' };

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

/** UI가 묶음 파일을 저장했다는 답을 기다린다 (메모리를 묶음 하나 크기로 묶어 둔다) */
let partSaved: (() => void) | null = null;
let cancelled = false;
const waitSaved = (): Promise<void> =>
	new Promise((resolve) => {
		partSaved = resolve;
	});
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function exportBatch(
	list: readonly SceneNode[],
	batch: Batch,
	request: ExportRequest,
	exportedAt: string
): Promise<void> {
	const ctx: SerializeContext = { mixed: figma.mixed, warnings: [] };
	const frames: ExportedFrame[] = [];
	const images: { index: number; bytes: Uint8Array; scale: number; width: number; height: number }[] = [];
	for (let i = batch.from; i < batch.to && !cancelled; i++) {
		const target = list[i];
		if (target === undefined) continue;
		figma.ui.postMessage({
			type: 'progress',
			done: i,
			total: list.length,
			name: target.name,
			part: batch.part,
			parts: batch.parts
		});
		const page = pageOf(target);
		frames.push({ pageId: page.id, pageName: page.name, node: await serializeNode(target, ctx), image: null });
		if (request.includeImages) {
			try {
				const bytes = await target.exportAsync({
					format: 'PNG',
					constraint: { type: 'SCALE', value: request.scale }
				});
				images.push({
					index: frames.length - 1,
					bytes,
					scale: request.scale,
					width: Math.round(target.width * request.scale),
					height: Math.round(target.height * request.scale)
				});
			} catch (error) {
				ctx.warnings.push(`${target.id} "${target.name}": PNG를 만들지 못함 (${String(error)})`);
			}
		}
		await breathe();
	}
	const data: FigmaExport = {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt,
		plugin: { version: PLUGIN_VERSION },
		file: { name: figma.root.name, key: typeof figma.fileKey === 'string' ? figma.fileKey : null },
		frames,
		warnings: ctx.warnings
	};
	// PNG는 바이트로 넘기고, base64 변환과 JSON 조립은 UI에서 한다
	const saved = waitSaved();
	figma.ui.postMessage({ type: 'result', data, images, batch, next: batch.to + 1, total: list.length });
	await saved;
}

async function runExport(request: ExportRequest): Promise<void> {
	cancelled = false;
	const list = targets();
	const batches = planBatches(list.length, request.batchSize, request.start);
	const exportedAt = new Date().toISOString();
	for (const batch of batches) {
		if (cancelled) break;
		await exportBatch(list, batch, request, exportedAt);
	}
	figma.ui.postMessage({ type: 'done', cancelled, files: batches.length });
}

figma.showUI(__html__, { width: 380, height: 520, themeColors: true });
postSelection();
figma.on('selectionchange', postSelection);
figma.on('currentpagechange', postSelection);
figma.ui.onmessage = (message: UiMessage) => {
	if (message.type === 'close') {
		figma.closePlugin();
		return;
	}
	if (message.type === 'part-saved') {
		const resolve = partSaved;
		partSaved = null;
		resolve?.();
		return;
	}
	if (message.type === 'cancel') {
		cancelled = true;
		return;
	}
	runExport(message).catch((error: unknown) => {
		figma.ui.postMessage({ type: 'error', message: String(error) });
	});
};
