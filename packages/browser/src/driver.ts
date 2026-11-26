import {
	DEFAULT_STABLE_OPTIONS,
	DEFAULT_TYPE_TEXT_OPTIONS,
	TextInputError,
	UnsupportedKeyError,
	WEBOS_KEY_MAP,
	textChangeScript,
	textFieldScript,
	textNotApplied
} from '@auto-qa/core';
import type {
	Driver,
	KeyMap,
	RemoteKey,
	ScreenshotOptions,
	StableOptions,
	StableResult,
	TextFieldState,
	TypeTextOptions,
	TypeTextResult
} from '@auto-qa/core';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { pressRemoteKey, waitForStable } from './session';

export interface BrowserDriverOptions {
	/** 리모컨 키 → 페이지 키 이벤트 매핑. 기본: webOS */
	keyMap?: KeyMap;
	viewport?: { width: number; height: number };
	/**
	 * 마우스 이벤트를 앱에 전달하지 않는다 (기본 true, pointerPolicy = 마우스 이벤트 금지).
	 * 헤드리스 Chrome은 화면 표시·레이아웃 변경 때 합성 마우스 이벤트를 만들고, 공간 탐색 라이브러리(Enact Spotlight 등)는
	 * 이를 받으면 포인터 모드로 바뀌어 리모컨 포커스 이동을 무시한다. TV에서 매직 리모컨 포인터를 숨긴 상태와 같게 만든다.
	 */
	suppressMouse?: boolean;
}

const SUPPRESS_MOUSE_SCRIPT = `['mousemove','mouseover','mouseout','mouseenter','mouseleave','mousedown','mouseup','click','wheel'].forEach(function (type) {
	window.addEventListener(type, function (event) { event.stopImmediatePropagation(); }, true);
});`;

/**
 * 브라우저 시뮬레이터 드라이버 (D-020). 실기기 드라이버와 같은 `Driver` 인터페이스를 구현한다.
 * 키는 CDP로 페이지에 직접 보내므로 시스템 키(HOME 등)는 보낼 수 없다.
 */
export class BrowserDriver implements Driver {
	readonly kind = 'browser' as const;

	private constructor(
		readonly page: Page,
		private readonly cdp: CDPSession,
		private readonly keyMap: KeyMap
	) {}

	static async open(browser: Browser, url: string, options: BrowserDriverOptions = {}): Promise<BrowserDriver> {
		const page = await browser.newPage({
			viewport: options.viewport ?? { width: 1920, height: 1080 },
			deviceScaleFactor: 1
		});
		const cdp = await page.context().newCDPSession(page);
		if (options.suppressMouse !== false) await page.addInitScript(SUPPRESS_MOUSE_SCRIPT);
		await page.bringToFront();
		await page.goto(url);
		return new BrowserDriver(page, cdp, options.keyMap ?? WEBOS_KEY_MAP);
	}

	async pressKey(key: RemoteKey): Promise<void> {
		const def = this.keyMap[key];
		if (def === null) {
			throw new UnsupportedKeyError(
				key,
				this.kind,
				'시스템 키는 시뮬레이터에서 보낼 수 없습니다 (실기기에서 확인)'
			);
		}
		await pressRemoteKey(this.cdp, def);
	}

	/**
	 * 글자 입력: 플랫폼 키보드 대신 입력 이벤트(CDP `Input.insertText`)로 넣는다 — 키 이벤트를 만들지 않으므로
	 * 앱의 키 처리(공간 탐색 등)를 건드리지 않는다. 확인은 리모컨 OK(Enter)로 보낸다.
	 */
	async typeText(text: string, options: Partial<TypeTextOptions> = {}): Promise<TypeTextResult> {
		const o = { ...DEFAULT_TYPE_TEXT_OPTIONS, ...options };
		const before = await this.page.evaluate<TextFieldState>(textFieldScript('read'));
		if (!before.editable) {
			throw new TextInputError(
				this.kind,
				before.tag === '' ? '포커스된 입력란이 없음' : `포커스된 요소(${before.tag})가 글자를 받지 않음`
			);
		}
		if (o.replace) await this.page.evaluate(textFieldScript(text === '' ? 'clear' : 'select'));
		if (text !== '') await this.page.keyboard.insertText(text);
		const after = await this.page.evaluate<TextFieldState & { changed: boolean }>(
			textChangeScript(before.value, o.timeoutMs)
		);
		if (textNotApplied(before.value, after, text, o.replace)) {
			throw new TextInputError(this.kind, '넣은 글자가 입력란에 반영되지 않음');
		}
		if (o.submit) await this.pressKey('OK');
		return { value: after.value };
	}

	evaluate<T>(expression: string): Promise<T> {
		return this.page.evaluate<T>(expression);
	}

	waitForStable(options: StableOptions = DEFAULT_STABLE_OPTIONS): Promise<StableResult> {
		return waitForStable(this.page, options);
	}

	async screenshot(options: ScreenshotOptions = { type: 'png' }): Promise<Uint8Array> {
		const buffer = await this.page.screenshot(
			options.type === 'jpeg' ? { type: 'jpeg', quality: options.quality ?? 70 } : { type: 'png' }
		);
		return new Uint8Array(buffer);
	}

	/** 같은 페이지를 다시 연다 (시작 상태 초기화) */
	async reload(): Promise<void> {
		await this.page.reload();
	}

	async close(): Promise<void> {
		await this.page.close();
	}
}
