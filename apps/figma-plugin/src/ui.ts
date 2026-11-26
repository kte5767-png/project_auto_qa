import type { FigmaExport } from '@auto-qa/figma/format';

/**
 * 플러그인 UI (iframe). 본체가 보낸 노드 트리와 PNG 바이트를 JSON 한 파일로 만들어 내려받게 한다.
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
}
type Message =
	| SelectionMessage
	| ResultMessage
	| { type: 'progress'; done: number; total: number; name: string }
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

export function fileNameFor(data: FigmaExport): string {
	const safe = data.file.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'figma';
	const stamp = data.exportedAt.replace(/[-:]/g, '').slice(0, 15);
	return `${safe}-auto-qa-${stamp}.json`;
}

function download(data: FigmaExport): void {
	const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileNameFor(data);
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

	button.onclick = () => {
		button.disabled = true;
		status.textContent = '내보내는 중…';
		parent.postMessage(
			{ pluginMessage: { type: 'export', scale: Number(scale.value), includeImages: images.checked } },
			'*'
		);
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
			status.textContent = `${message.done + 1}/${message.total} ${message.name}`;
		} else if (message.type === 'result') {
			for (const img of message.images) {
				const frame = message.data.frames[img.index];
				if (frame !== undefined) {
					frame.image = { data: toBase64(img.bytes), scale: img.scale, width: img.width, height: img.height };
				}
			}
			download(message.data);
			const warn = message.data.warnings.length;
			status.textContent = `완료: 프레임 ${message.data.frames.length}개${warn > 0 ? `, 경고 ${warn}건 (파일 안 warnings)` : ''}`;
			button.disabled = false;
		} else {
			status.textContent = `오류: ${message.message}`;
			button.disabled = false;
		}
	};
}

if (typeof document !== 'undefined') init();
