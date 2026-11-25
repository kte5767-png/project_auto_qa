import { chromium } from 'playwright-core';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { cdpKeyEvents } from './keys';
import type { KeyDef } from './keys';

export interface LaunchOptions {
	/** 브라우저 실행 파일 경로. 없으면 CHROME_PATH 환경 변수 → 설치된 Chrome → Playwright Chromium 순으로 찾는다. */
	executablePath?: string;
	headless?: boolean;
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
	const headless = options.headless ?? true;
	const executablePath = options.executablePath ?? process.env['CHROME_PATH'];
	if (executablePath !== undefined && executablePath !== '') {
		return chromium.launch({ executablePath, headless });
	}
	try {
		return await chromium.launch({ channel: 'chrome', headless });
	} catch {
		return chromium.launch({ headless });
	}
}

/** CDP로 리모컨 키 한 번(keydown + keyup)을 보낸다. 마우스 이벤트는 만들지 않는다. */
export async function pressRemoteKey(cdp: CDPSession, def: KeyDef): Promise<void> {
	for (const event of cdpKeyEvents(def)) {
		await cdp.send('Input.dispatchKeyEvent', event);
	}
}

export interface StableOptions {
	/** DOM 변경·애니메이션이 이 시간 동안 없으면 안정 상태로 본다 */
	quietMs: number;
	/** 최대 대기 시간. 넘으면 stable=false로 끝낸다 */
	timeoutMs: number;
}

export const DEFAULT_STABLE_OPTIONS: StableOptions = { quietMs: 120, timeoutMs: 3000 };

export interface StableResult {
	stable: boolean;
	waitedMs: number;
}

/**
 * 안정화 대기 (설계 7.6). 고정 시간 대신 DOM 변경과 실행 중인 유한 애니메이션이
 * quietMs 동안 없을 때까지 기다린다. 무한 반복 애니메이션(로딩 스피너 등)은 무시한다.
 */
export async function waitForStable(
	page: Page,
	options: StableOptions = DEFAULT_STABLE_OPTIONS
): Promise<StableResult> {
	// tsx·esbuild의 keepNames가 함수 소스에 넣는 __name 호출이 브라우저에서 깨지지 않도록 대비
	await page.evaluate('globalThis.__name ??= (fn) => fn');
	return page.evaluate(
		(opts) =>
			new Promise<{ stable: boolean; waitedMs: number }>((resolve) => {
				const start = performance.now();
				let lastChange = start;
				const observer = new MutationObserver(() => {
					lastChange = performance.now();
				});
				observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
				const finish = (stable: boolean): void => {
					observer.disconnect();
					resolve({ stable, waitedMs: Math.round(performance.now() - start) });
				};
				const tick = (): void => {
					const now = performance.now();
					const animating = document.getAnimations().some((a) => {
						const iterations = a.effect?.getTiming().iterations;
						return a.playState === 'running' && iterations !== Infinity;
					});
					if (animating) lastChange = now;
					if (now - lastChange >= opts.quietMs) {
						finish(true);
					} else if (now - start >= opts.timeoutMs) {
						finish(false);
					} else {
						requestAnimationFrame(tick);
					}
				};
				requestAnimationFrame(tick);
			}),
		options
	);
}
