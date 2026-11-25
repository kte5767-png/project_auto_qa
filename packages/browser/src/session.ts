import { DEFAULT_STABLE_OPTIONS, cdpKeyEvents, stableWaitScript } from '@auto-qa/core';
import type { KeyDef, StableOptions, StableResult } from '@auto-qa/core';
import { chromium } from 'playwright-core';
import type { Browser, CDPSession, Page } from 'playwright-core';

export interface LaunchOptions {
	/** 브라우저 실행 파일 경로. 없으면 CHROME_PATH 환경 변수 → 설치된 Chrome → Playwright Chromium 순으로 찾는다. */
	executablePath?: string;
	headless?: boolean;
	/** 추가 실행 인자 (예: 원격 디버깅 포트) */
	args?: string[];
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
	const headless = options.headless ?? true;
	const args = options.args ?? [];
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
