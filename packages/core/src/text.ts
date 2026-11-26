import { pageExpression } from './pageScript';

/**
 * 글자 입력 (D-043 ①). 검색어처럼 TC·진입 경로가 글자를 넣어야 하는 단계에 쓴다.
 * TV에서는 플랫폼 키보드(VKB)가 열린 상태에서 키보드 서비스로 글자를 넣고, 브라우저 시뮬레이터에서는
 * 입력 이벤트로 넣는다. 어느 쪽이든 글자는 지금 DOM 포커스가 있는 입력란에 들어간다
 * (플랫폼 키보드가 열려도 앱의 포커스는 입력란에 남는다, D-013).
 */
export interface TypeTextOptions {
	/** 입력란의 기존 글자를 지우고 넣는다. false면 커서 위치에 덧붙인다 */
	replace: boolean;
	/** 넣은 뒤 키보드의 확인(Enter)을 보낸다 (검색 실행 등) */
	submit: boolean;
	/** 넣은 글자가 입력란 값에 반영될 때까지 기다리는 최대 시간 (ms). 고정 대기가 아니라 값이 바뀌면 바로 끝난다 */
	timeoutMs: number;
}

export const DEFAULT_TYPE_TEXT_OPTIONS: TypeTextOptions = { replace: false, submit: false, timeoutMs: 2000 };

export interface TypeTextResult {
	/** 넣은 뒤(확인을 보내기 전) 입력란의 값. 앱이 글자 수를 자르거나 공백을 지우면 그 결과가 보인다 */
	value: string;
}

export class TextInputError extends Error {
	override name = 'TextInputError';
	constructor(
		readonly driverKind: 'webos' | 'browser',
		detail: string
	) {
		super(`${driverKind} 드라이버에서 글자를 넣지 못했습니다: ${detail}`);
	}
}

/** 지금 DOM 포커스가 있는 입력란의 상태 */
export interface TextFieldState {
	/** 글자를 받을 수 있는 입력란인가 (input·textarea·contenteditable, 읽기 전용·비활성 아님) */
	editable: boolean;
	/** 포커스된 요소의 태그 (없으면 빈 문자열) */
	tag: string;
	value: string;
}

/**
 * read: 읽기만 / select: 전체 선택(다음 입력이 바꿔 씀) / end: 커서를 끝으로(키보드 서비스가 뒤에서부터 지울 때) /
 * clear: 전체 선택 후 지움(입력 이벤트가 나도록 편집 명령으로)
 */
export type TextFieldMode = 'read' | 'select' | 'end' | 'clear';

/* 페이지 함수 — ES2017만 (개발지침: webOS 5.x = Chromium 68) */
function textFieldInPage(mode: TextFieldMode): TextFieldState {
	const SELECTABLE = ['text', 'search', 'url', 'tel', 'password'];
	const TYPED = SELECTABLE.concat(['email', 'number']);
	const el = document.activeElement as HTMLElement | null;
	if (el === null || el === document.body || el === document.documentElement) {
		return { editable: false, tag: '', value: '' };
	}
	const tag = el.tagName.toLowerCase();
	if (tag === 'input' || tag === 'textarea') {
		const input = el as HTMLInputElement;
		const type = tag === 'textarea' ? 'text' : (input.getAttribute('type') || 'text').toLowerCase();
		const editable = !input.readOnly && !input.disabled && TYPED.indexOf(type) >= 0;
		if (editable && SELECTABLE.indexOf(type) >= 0) {
			if (mode === 'select' || mode === 'clear') input.select();
			if (mode === 'end') input.setSelectionRange(input.value.length, input.value.length);
			// 지우기도 입력 이벤트가 나야 앱(React 등) 상태가 따라온다 → 값 대입이 아니라 편집 명령으로
			if (mode === 'clear' && input.value !== '') document.execCommand('delete');
		}
		return { editable, tag, value: input.value };
	}
	if (el.isContentEditable) {
		if (mode !== 'read') {
			const range = document.createRange();
			range.selectNodeContents(el);
			if (mode === 'end') range.collapse(false);
			const selection = window.getSelection();
			if (selection !== null) {
				selection.removeAllRanges();
				selection.addRange(range);
			}
			if (mode === 'clear' && (el.textContent || '') !== '') document.execCommand('delete');
		}
		return { editable: true, tag, value: el.textContent || '' };
	}
	return { editable: false, tag, value: '' };
}

/* 페이지 함수 — 입력란 값이 from과 달라질 때까지 기다린다 (최대 timeoutMs). ES2017만 */
function textChangeInPage(arg: {
	from: string;
	timeoutMs: number;
	pollMs: number;
}): Promise<TextFieldState & { changed: boolean }> {
	const read = (): TextFieldState => {
		const el = document.activeElement as HTMLElement | null;
		if (el === null) return { editable: false, tag: '', value: '' };
		const tag = el.tagName.toLowerCase();
		if (tag === 'input' || tag === 'textarea') {
			return { editable: true, tag, value: (el as HTMLInputElement).value };
		}
		if (el.isContentEditable) return { editable: true, tag, value: el.textContent || '' };
		return { editable: false, tag, value: '' };
	};
	return new Promise((resolve) => {
		const start = Date.now();
		const tick = (): void => {
			const state = read();
			const changed = state.value !== arg.from;
			if (changed || Date.now() - start >= arg.timeoutMs) {
				resolve({ editable: state.editable, tag: state.tag, value: state.value, changed });
				return;
			}
			setTimeout(tick, arg.pollMs);
		};
		tick();
	});
}

/** 포커스된 입력란을 확인하고(필요하면 선택·커서 이동·지우기) 상태를 돌려주는 페이지 스크립트 */
export function textFieldScript(mode: TextFieldMode = 'read'): string {
	return pageExpression(textFieldInPage, mode);
}

/** 입력란 값이 from에서 바뀔 때까지 기다리는 페이지 스크립트 (값이 바뀌면 바로 끝남) */
export function textChangeScript(from: string, timeoutMs: number, pollMs = 30): string {
	return pageExpression(textChangeInPage, { from, timeoutMs, pollMs });
}

/** 넣은 글자가 반영되지 않았는가 (같은 글자로 바꿔 쓴 경우·빈 글자는 제외) */
export function textNotApplied(before: string, after: { changed: boolean }, text: string, replace: boolean): boolean {
	if (after.changed) return false;
	if (replace) return before !== text;
	return text !== '';
}
