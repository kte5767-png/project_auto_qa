import { PAGE_SCRIPT_ECMA_VERSION, UnsupportedKeyError } from '@auto-qa/core';
import { parse } from 'acorn';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceConfigFromEnv } from './config';
import type { KeyMode } from './config';
import { WebOsDriver } from './driver';
import { closedPort, startFakeInspector, startFakeSsap } from './testing/fakeTv';
import type { FakeInspector, FakeSsap } from './testing/fakeTv';

const APP_ID = 'com.autoqa.sampletvapp';
let inspector: FakeInspector | null = null;
let ssap: FakeSsap | null = null;
let driver: WebOsDriver | null = null;

afterEach(async () => {
	await driver?.close();
	await inspector?.close();
	await ssap?.close();
	driver = null;
	inspector = null;
	ssap = null;
});

/** 가짜 페이지: 키 도착 확인 스크립트에 "받았음"으로 답하고, 평가한 식을 기록한다 */
function fakePage(expressions: string[], delivered = true) {
	return (expression: string): unknown => {
		expressions.push(expression);
		if (expression.includes('installKeyProbeInPage')) return 4;
		if (expression.includes('waitKeyInPage')) return { delivered, latencyMs: 12, keyCode: 40 };
		if (expression.includes('stableInPage')) return { stable: true, waitedMs: 130, mode: 'legacy' };
		return null;
	};
}

async function config(keyMode: KeyMode) {
	return deviceConfigFromEnv({
		WEBOS_HOST: '127.0.0.1',
		WEBOS_APP_ID: APP_ID,
		WEBOS_KEY_MODE: keyMode,
		WEBOS_INSPECTOR_PORT: String(inspector?.port ?? 1),
		WEBOS_SSAP_PORT: String(await closedPort()),
		WEBOS_SSAP_PLAIN_PORT: String(ssap?.port ?? (await closedPort()))
	});
}

describe('WebOsDriver (가짜 TV)', () => {
	it('SSAP 모드: 페어링 키를 저장하고, 버튼을 보낸 뒤 앱 도착을 확인한다', async () => {
		const expressions: string[] = [];
		inspector = await startFakeInspector({ evaluate: fakePage(expressions) });
		ssap = await startFakeSsap({ issuedClientKey: 'paired-key' });
		const saved: string[] = [];
		let prompted = false;
		driver = await WebOsDriver.connect({
			config: await config('ssap'),
			onPairingPrompt: () => {
				prompted = true;
			},
			onClientKey: (key) => {
				saved.push(key);
			}
		});
		expect(prompted).toBe(true);
		expect(saved).toEqual(['paired-key']);
		expect(driver.engine).toBe('Chrome/68.0.3440.106');
		expect(driver.chromium).toBe(68);

		const result = await driver.press('OK');
		expect(result).toEqual({ key: 'OK', via: 'ssap', delivered: true, latencyMs: 12, keyCode: 40 });
		await expect.poll(() => ssap?.buttons).toEqual(['ENTER']);

		const home = await driver.press('HOME');
		expect(home.delivered).toBeNull();
		await expect.poll(() => ssap?.buttons).toEqual(['ENTER', 'HOME']);

		const stable = await driver.waitForStable();
		expect(stable.mode).toBe('legacy');
		// TV로 보낸 스크립트는 모두 구형 엔진 문법
		for (const expression of expressions) {
			expect(() => parse(expression, { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
		}
	});

	it('CDP 모드: 키 이벤트를 페이지에 넣고, HOME은 보낼 수 없다고 알린다', async () => {
		const expressions: string[] = [];
		inspector = await startFakeInspector({ evaluate: fakePage(expressions) });
		driver = await WebOsDriver.connect({ config: await config('cdp') });
		await driver.press('DOWN');
		expect(inspector.methods.filter((m) => m === 'Input.dispatchKeyEvent')).toHaveLength(2);
		await expect(driver.press('HOME')).rejects.toBeInstanceOf(UnsupportedKeyError);
	});

	it('키가 앱에 도착하지 않으면 delivered=false로 기록한다', async () => {
		inspector = await startFakeInspector({ evaluate: fakePage([], false) });
		driver = await WebOsDriver.connect({ config: await config('cdp') });
		expect((await driver.press('LEFT')).delivered).toBe(false);
	});

	it('페이지 다시 열기: 새 문서가 될 때까지 기다린다', async () => {
		let navigated = false;
		inspector = await startFakeInspector({
			evaluate: (expression) => {
				if (expression.includes('navigateInPage')) {
					navigated = true;
					return true;
				}
				if (expression.includes('isNewDocumentInPage')) return navigated;
				return null;
			}
		});
		driver = await WebOsDriver.connect({ config: await config('cdp') });
		await driver.reloadApp('?focus=class');
		expect(navigated).toBe(true);
	});

	it('앱 페이지가 목록에 없으면 현재 목록을 보여 주며 실패한다', async () => {
		inspector = await startFakeInspector({
			targets: [{ id: 'h', title: 'Home', url: 'file:///usr/palm/applications/com.webos.app.home/index.html' }]
		});
		await expect(WebOsDriver.connect({ config: await config('cdp'), targetTimeoutMs: 700 })).rejects.toThrow(
			/com\.webos\.app\.home/
		);
	});
});
