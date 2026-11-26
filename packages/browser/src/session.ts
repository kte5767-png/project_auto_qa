import { DEFAULT_STABLE_OPTIONS, cdpKeyEvents, stableWaitScript } from '@auto-qa/core';
import type { KeyDef, StableOptions, StableResult } from '@auto-qa/core';
import { chromium } from 'playwright-core';
import type { Browser, CDPSession, Page } from 'playwright-core';
import type { ScreenInfo } from './window';

export interface LaunchOptions {
	/** 브라우저 실행 파일 경로. 없으면 CHROME_PATH 환경 변수 → 설치된 Chrome → Playwright Chromium 순으로 찾는다. */
	executablePath?: string;
	headless?: boolean;
	/** 추가 실행 인자 (예: 원격 디버깅 포트) */
	args?: string[];
	/**
	 * 창을 그리는 배율 (headed에서 1920×1080 화면이 모니터에 다 보이게, `fitWindowScale`).
	 * 페이지 레이아웃·캡처 크기는 바꾸지 않는다
	 */
	windowScale?: number;
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
	const headless = options.headless ?? true;
	const args = [...(options.args ?? [])];
	if (options.windowScale !== undefined) {
		args.push(`--force-device-scale-factor=${options.windowScale}`, '--window-position=0,0');
	}
	const executablePath = options.executablePath ?? process.env['CHROME_PATH'];
	if (executablePath !== undefined && executablePath !== '') {
		return chromium.launch({ executablePath, headless, args });
	}
	try {
		return await chromium.launch({ channel: 'chrome', headless, args });
	} catch {
		return chromium.launch({ headless, args });
	}
}

/** CDP로 리모컨 키 한 번(keydown + keyup)을 보낸다. 마우스 이벤트는 만들지 않는다. */
export async function pressRemoteKey(cdp: CDPSession, def: KeyDef): Promise<void> {
	for (const event of cdpKeyEvents(def)) {
		await cdp.send('Input.dispatchKeyEvent', event);
	}
}

/** 안정화 대기 (설계 7.6). 실제 대기 로직은 실기기와 같은 페이지 스크립트(`@auto-qa/core`)를 쓴다. */
export async function waitForStable(
	page: Page,
	options: StableOptions = DEFAULT_STABLE_OPTIONS
): Promise<StableResult> {
	return page.evaluate<StableResult>(stableWaitScript(options));
}

/** headed 창이 놓일 모니터 크기·시스템 배율을 읽는다 (창을 잠깐 띄웠다 닫음) */
export async function probeScreen(options: LaunchOptions = {}): Promise<ScreenInfo> {
	const browser = await launchBrowser({ ...options, headless: false, windowScale: undefined });
	try {
		const page = await browser.newPage({ viewport: null });
		return await page.evaluate(() => ({
			availWidth: window.screen.availWidth,
			availHeight: window.screen.availHeight,
			dpr: window.devicePixelRatio
		}));
	} finally {
		await browser.close();
	}
}
