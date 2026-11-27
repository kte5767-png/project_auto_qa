import {
	DEFAULT_STABLE_OPTIONS,
	DEFAULT_TYPE_TEXT_OPTIONS,
	TextInputError,
	UnsupportedKeyError,
	WEBOS_KEY_MAP,
	keyboardEnterEvents,
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

export interface LiveViewOptions {
	/** 프레임 크기 (앱 화면을 이 크기 안으로 줄여 받는다) */
	width: number;
	height: number;
	/** JPEG 품질 0~100 */
	quality: number;
}

export const DEFAULT_LIVE_VIEW_OPTIONS: LiveViewOptions = { width: 960, height: 540, quality: 60 };

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
	 * 앱의 키 처리(공간 탐색 등)를 건드리지 않는다. 확인은 키보드의 Enter(글자 "\r"가 붙은 키, keypress가 생김)로
	 * 보낸다 — TV 키보드 서비스의 확인(sendEnterKey)과 같은 역할. 리모컨 OK(글자 없는 키)로는 검색을 확정하지 않는 앱이 있다.
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
		if (o.submit) for (const event of keyboardEnterEvents()) await this.cdp.send('Input.dispatchKeyEvent', event);
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

	/**
	 * 실시간 화면 (사용자 UI 미리보기용, 판정과 무관): 화면이 다시 그려질 때마다 JPEG 프레임을 받는다.
	 * 브라우저가 그린 화면을 보내 주는 방식(CDP screencast)이라 앱 DOM을 바꾸지 않는다
	 * (screenshot은 입력란 커서를 숨기려 DOM을 잠깐 바꾼다) → 안정화 대기·판정에 영향이 없다.
	 * Playwright의 page.screencast는 창 배율(--force-device-scale-factor)을 바꾸면 프레임이 오지 않아 CDP를 직접 쓴다.
	 * 돌려준 함수로 멈춘다 (페이지를 닫으면 저절로 멈춘다)
	 */
	async liveView(
		onFrame: (jpeg: Uint8Array) => void,
		options: Partial<LiveViewOptions> = {}
	): Promise<() => Promise<void>> {
		const o = { ...DEFAULT_LIVE_VIEW_OPTIONS, ...options };
		const session = await this.page.context().newCDPSession(this.page);
		const handler = (frame: { data: string; sessionId: number }): void => {
			void session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
			onFrame(new Uint8Array(Buffer.from(frame.data, 'base64')));
		};
		session.on('Page.screencastFrame', handler);
		await session.send('Page.startScreencast', {
			format: 'jpeg',
			quality: o.quality,
			maxWidth: o.width,
			maxHeight: o.height
		});
		return async () => {
			session.off('Page.screencastFrame', handler);
			if (this.page.isClosed()) return;
			await session.send('Page.stopScreencast').catch(() => undefined);
			await session.detach().catch(() => undefined);
		};
	}

	/** 같은 페이지를 다시 연다 (시작 상태 초기화) */
	async reload(): Promise<void> {
		await this.page.reload();
	}

	async close(): Promise<void> {
		await this.page.close();
	}
}
