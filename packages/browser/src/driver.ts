import { DEFAULT_STABLE_OPTIONS, UnsupportedKeyError, WEBOS_KEY_MAP } from '@auto-qa/core';
import type { Driver, KeyMap, RemoteKey, ScreenshotOptions, StableOptions, StableResult } from '@auto-qa/core';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { pressRemoteKey, waitForStable } from './session';

export interface BrowserDriverOptions {
	/** 리모컨 키 → 페이지 키 이벤트 매핑. 기본: webOS */
	keyMap?: KeyMap;
	viewport?: { width: number; height: number };
}

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
		// 앱이 뜨기 전에 창 포커스를 확정한다 (늦게 오는 창 focus 이벤트가 앱의 시작 포커스를 바꾸지 않도록)
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
