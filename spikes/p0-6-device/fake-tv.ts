/**
 * 가짜 TV: 실제 TV 없이 P0-6 스파이크 흐름을 확인하기 위한 도구 (개발·CI용).
 * - 앱 디버거: 원격 디버깅 포트를 연 Chrome이 TV 역할 (샘플 앱 webOS 빌드를 file://로 연다)
 * - SSAP: 등록·포인터 소켓을 흉내 내고, 받은 버튼을 Chrome 페이지 키 이벤트로 넘긴다
 *
 *   pnpm --filter @auto-qa/spike-p0-6-device fake-tv
 *   (다른 터미널) WEBOS_HOST=127.0.0.1 WEBOS_INSPECTOR_PORT=9998 WEBOS_SSAP_PORT=1 WEBOS_SSAP_PLAIN_PORT=3000 \
 *                pnpm spike:device focus --sample spotlight --reset reload
 * 옵션: --mode spotlight|class, --legacy-engine (document.getAnimations가 없는 구형 엔진 흉내)
 */
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { launchBrowser, pressRemoteKey } from '@auto-qa/browser';
import { WEBOS_KEY_MAP } from '@auto-qa/core';
import type { RemoteKey } from '@auto-qa/core';
import { SSAP_BUTTONS } from '@auto-qa/device-webos';
import { startFakeSsap } from '@auto-qa/device-webos/testing';
import { SAMPLE_APP_ID, buildWebosApp } from '@auto-qa/sample-tv-app/build-webos';

const BUTTON_TO_KEY = Object.fromEntries(Object.entries(SSAP_BUTTONS).map(([key, button]) => [button, key])) as Record<
	string,
	RemoteKey
>;

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			'inspector-port': { type: 'string', default: '9998' },
			'ssap-port': { type: 'string', default: '3000' },
			mode: { type: 'string', default: 'spotlight' },
			/** 구형 엔진 흉내: document.getAnimations 제거 (Chromium 84 미만) */
			'legacy-engine': { type: 'boolean', default: false }
		}
	});
	// 앱 ID가 경로에 들어가도록 TV와 비슷한 폴더 이름으로 복사한다
	const appDir = join(await mkdtemp(join(tmpdir(), 'fake-tv-')), SAMPLE_APP_ID);
	await cp(await buildWebosApp(), appDir, { recursive: true });

	const browser = await launchBrowser({
		args: [`--remote-debugging-port=${values['inspector-port']}`, '--remote-debugging-address=127.0.0.1']
	});
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
	const cdp = await page.context().newCDPSession(page);
	if (values['legacy-engine']) {
		await page.addInitScript(() => {
			Reflect.deleteProperty(Document.prototype, 'getAnimations');
		});
	}
	await page.goto(`file://${appDir}/index.html?focus=${values.mode}&defects=none`);

	const ssap = await startFakeSsap({
		port: Number(values['ssap-port']),
		onButton: (button) => {
			const key = BUTTON_TO_KEY[button];
			const def = key === undefined ? null : WEBOS_KEY_MAP[key];
			// HOME은 시스템 키라 페이지에 전달되지 않는다 (실제 TV와 같음)
			if (def !== null) void pressRemoteKey(cdp, def);
		}
	});

	console.log('가짜 TV 실행 중 (Ctrl+C로 종료)');
	console.log(
		`  앱 디버거 127.0.0.1:${values['inspector-port']} / SSAP ws 127.0.0.1:${ssap.port} / 앱 ${SAMPLE_APP_ID}`
	);
	console.log(
		`  WEBOS_HOST=127.0.0.1 WEBOS_INSPECTOR_PORT=${values['inspector-port']} WEBOS_SSAP_PORT=1 WEBOS_SSAP_PLAIN_PORT=${ssap.port} pnpm spike:device focus --sample ${values.mode} --reset reload`
	);
	const stop = async (): Promise<void> => {
		await ssap.close();
		await browser.close();
		process.exit(0);
	};
	process.on('SIGINT', () => void stop());
	process.on('SIGTERM', () => void stop());
}

await main();
