import type { FigmaExport } from '@auto-qa/figma/format';
import { exportFileName } from './batch';
import type { Batch } from './batch';

/**
 * 플러그인 UI (iframe). 본체가 보낸 노드 트리와 PNG 바이트를 JSON 파일로 만들어 내려받게 한다.
 * 프레임이 많으면 본체가 N개씩 묶어 보내고, 여기서 한 파일씩 저장한 뒤 "저장함"을 돌려보내야 다음 묶음이 온다.
 * 외부로 아무것도 보내지 않는다.
 */

interface SelectionMessage {
	type: 'selection';
	fromSelection: boolean;
	page: string;
	frames: { id: string; name: string; width: number; height: number }[];
}
interface ResultMessage {
	type: 'result';
	data: FigmaExport;
	images: { index: number; bytes: Uint8Array; scale: number; width: number; height: number }[];
	batch: Batch;
	/** 다음 묶음의 시작 번호 (1부터) */
	next: number;
	total: number;
}
type Message =
	| SelectionMessage
	| ResultMessage
	| { type: 'progress'; done: number; total: number; name: string; part: number; parts: number }
	| { type: 'done'; cancelled: boolean; files: number }
	| { type: 'error'; message: string };

const $ = <T extends HTMLElement>(id: string): T => {
	const el = document.getElementById(id);
	if (el === null) throw new Error(`#${id} 없음`);
	return el as T;
};

export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

export function fileNameFor(data: FigmaExport, batch: Batch | null = null): string {
	return exportFileName(data.file.name, data.exportedAt, batch);
}

function download(data: FigmaExport, batch: Batch): void {
	const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileNameFor(data, batch);
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function init(): void {
	const list = $<HTMLUListElement>('frames');
	const summary = $<HTMLParagraphElement>('summary');
	const status = $<HTMLParagraphElement>('status');
	const button = $<HTMLButtonElement>('export');
	const scale = $<HTMLSelectElement>('scale');
	const images = $<HTMLInputElement>('images');
	const batchSize = $<HTMLSelectElement>('batch');
	const start = $<HTMLInputElement>('start');
	const cancel = $<HTMLButtonElement>('cancel');
	const auto = $<HTMLInputElement>('auto');
	const savePart = $<HTMLButtonElement>('save-part');
	let saved = 0;
	let warnings = 0;
	let nextStart = 1;

	button.onclick = () => {
		button.disabled = true;
		cancel.disabled = false;
		saved = 0;
		warnings = 0;
		nextStart = Math.max(1, Number(start.value) || 1);
		status.textContent = '내보내는 중…';
		parent.postMessage(
			{
				pluginMessage: {
					type: 'export',
					scale: Number(scale.value),
					includeImages: images.checked,
					batchSize: Number(batchSize.value),
					start: nextStart
				}
			},
			'*'
		);
	};
	cancel.onclick = () => {
		cancel.disabled = true;
		status.textContent = '지금 묶음까지 저장하고 멈춥니다…';
		parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
	};

	window.onmessage = (event: MessageEvent<{ pluginMessage?: Message }>) => {
		const message = event.data.pluginMessage;
		if (message === undefined) return;
		if (message.type === 'selection') {
			summary.textContent = message.fromSelection
				? `선택한 프레임 ${message.frames.length}개`
				: `선택이 없어 "${message.page}" 페이지의 최상위 프레임 ${message.frames.length}개`;
			list.replaceChildren(
				...message.frames.map((f) => {
					const li = document.createElement('li');
					li.textContent = `${f.name} (${f.width}×${f.height})`;
					return li;
				})
			);
			button.disabled = message.frames.length === 0;
		} else if (message.type === 'progress') {
			const part = message.parts > 1 ? ` (파일 ${message.part}/${message.parts})` : '';
			status.textContent = `${message.done + 1}/${message.total}${part} ${message.name}`;
		} else if (message.type === 'result') {
			for (const img of message.images) {
				const frame = message.data.frames[img.index];
				if (frame !== undefined) {
					frame.image = { data: toBase64(img.bytes), scale: img.scale, width: img.width, height: img.height };
				}
			}
			const result = message;
			const finish = (): void => {
				download(result.data, result.batch);
				saved++;
				warnings += result.data.warnings.length;
				nextStart = result.next;
				// 이 묶음을 저장했으니 다음 묶음을 만들어도 된다 (중간에 멈추면 이 번호부터 다시)
				start.value = String(result.next <= result.total ? result.next : 1);
				savePart.hidden = true;
				parent.postMessage({ pluginMessage: { type: 'part-saved' } }, '*');
			};
			if (auto.checked || result.batch.parts <= 1) finish();
			else {
				// 자동 내려받기가 막히는 환경: 파일마다 눌러서 저장 (사용자 클릭으로 내려받기)
				savePart.textContent = `파일 ${result.batch.part}/${result.batch.parts} 저장`;
				savePart.hidden = false;
				savePart.onclick = finish;
			}
		} else if (message.type === 'done') {
			const warn = warnings > 0 ? `, 경고 ${warnings}건 (파일 안 warnings)` : '';
			status.textContent = message.cancelled
				? `멈춤: 파일 ${saved}개 저장. 이어서 하려면 시작 번호 ${nextStart}로 다시 내보내기${warn}`
				: `완료: 파일 ${saved}개${warn}`;
			button.disabled = false;
			cancel.disabled = true;
		} else {
			status.textContent = `오류: ${message.message} — 저장된 파일 ${saved}개, 이어서 하려면 시작 번호 ${nextStart}로 다시 내보내기`;
			button.disabled = false;
			cancel.disabled = true;
		}
	};
}

if (typeof document !== 'undefined') init();
