import { PAGE_SCRIPT_ECMA_VERSION, TextInputError, UnsupportedKeyError } from '@auto-qa/core';
import { parse } from 'acorn';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceConfigFromEnv } from './config';
import type { KeyMode } from './config';
import { WebOsDriver } from './driver';
import { SsapError } from './ssap';
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

/** 가짜 입력란: 글자 입력 페이지 스크립트에 이 값으로 답한다 */
interface FakeField {
	value: string;
	editable: boolean;
	selected: boolean;
}

function fieldPage(field: FakeField, expressions: string[]) {
	const base = fakePage(expressions);
	return (expression: string): unknown => {
		const arg = /\)\(([^()]*)\);\}\)\(\)$/.exec(expression)?.[1];
		if (expression.includes('textFieldInPage')) {
			expressions.push(expression);
			const mode = JSON.parse(arg ?? '"read"') as string;
			if (mode === 'select') field.selected = true;
			if (mode === 'clear') field.value = '';
			return { editable: field.editable, tag: field.editable ? 'input' : '', value: field.value };
		}
		if (expression.includes('textChangeInPage')) {
			expressions.push(expression);
			const from = (JSON.parse(arg ?? '{}') as { from: string }).from;
			return { editable: true, tag: 'input', value: field.value, changed: field.value !== from };
		}
		return base(expression);
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

	it('글자 입력(SSAP): 키보드 서비스로 지우고 넣고 확인을 보낸다, 페어링은 CONTROL_INPUT_TEXT 권한을 요청한다', async () => {
		const expressions: string[] = [];
		const field: FakeField = { value: 'old', editable: true, selected: false };
		inspector = await startFakeInspector({ evaluate: fieldPage(field, expressions) });
		ssap = await startFakeSsap({
			onIme: (method, payload) => {
				if (method === 'deleteCharacters') field.value = field.value.slice(0, -Number(payload['count']));
				if (method === 'insertText') field.value += String(payload['text']);
			}
		});
		driver = await WebOsDriver.connect({ config: await config('ssap') });
		const manifest = ssap.registrations[0]?.['manifest'] as { permissions: string[] };
		expect(manifest.permissions).toContain('CONTROL_INPUT_TEXT');

		const result = await driver.typeText('bali', { replace: true, submit: true });
		expect(result).toEqual({ value: 'bali' });
		expect(ssap.ime).toEqual(['deleteCharacters 3', 'insertText bali', 'sendEnterKey']);
		for (const expression of expressions) {
			expect(() => parse(expression, { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
		}
	});

	it('글자 입력: 입력란에 포커스가 없거나 글자가 반영되지 않으면 TextInputError', async () => {
		const field: FakeField = { value: '', editable: false, selected: false };
		inspector = await startFakeInspector({ evaluate: fieldPage(field, []) });
		ssap = await startFakeSsap();
		driver = await WebOsDriver.connect({ config: await config('ssap') });
		await expect(driver.typeText('bali')).rejects.toThrow(/포커스된 입력란이 없음/);
		field.editable = true;
		const error = await driver.typeText('bali').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TextInputError);
		expect(String(error)).toContain('CONTROL_INPUT_TEXT');
	});

	it('글자 입력: 키보드 서비스 권한이 없으면 SSAP 오류', async () => {
		inspector = await startFakeInspector({
			evaluate: fieldPage({ value: '', editable: true, selected: false }, [])
		});
		ssap = await startFakeSsap({ denyIme: true });
		driver = await WebOsDriver.connect({ config: await config('ssap') });
		await expect(driver.typeText('bali')).rejects.toBeInstanceOf(SsapError);
	});

	it('글자 입력(CDP): 선택한 뒤 Input.insertText로 바꿔 쓰고 확인은 OK 키로 보낸다', async () => {
		const field: FakeField = { value: 'old', editable: true, selected: false };
		inspector = await startFakeInspector({
			evaluate: fieldPage(field, []),
			onMethod: (method, params) => {
				if (method === 'Input.insertText') {
					field.value = (field.selected ? '' : field.value) + String(params['text']);
					field.selected = false;
				}
				return undefined;
			}
		});
		driver = await WebOsDriver.connect({ config: await config('cdp') });
		expect(await driver.typeText('tokyo', { replace: true, submit: true })).toEqual({ value: 'tokyo' });
		const sent = inspector.methods.filter((m) => m.startsWith('Input.'));
		expect(sent).toEqual(['Input.insertText', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent']);
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

	it('실시간 화면: 화면 전송을 시작하고 받은 프레임을 넘긴 뒤 받았다고 알리고, 멈추면 전송을 끝낸다', async () => {
		inspector = await startFakeInspector({ evaluate: () => null });
		driver = await WebOsDriver.connect({ config: await config('cdp') });
		const frames: string[] = [];
		const stop = await driver.liveView((jpeg) => frames.push(Buffer.from(jpeg).toString()));
		await expect.poll(() => frames).toEqual(['fake-frame']);
		await expect.poll(() => inspector?.methods.includes('Page.screencastFrameAck')).toBe(true);
		await stop();
		expect(inspector.methods).toContain('Page.stopScreencast');
	});

	it('앱 저장 상태 지우기: localStorage·sessionStorage를 지우는 ES2017 페이지 스크립트', async () => {
		const expressions: string[] = [];
		inspector = await startFakeInspector({
			evaluate: (expression) => {
				expressions.push(expression);
				return expression.includes('clearStorageInPage') ? { local: true, session: true } : null;
			}
		});
		driver = await WebOsDriver.connect({ config: await config('cdp') });
		expect(await driver.clearAppStorage()).toEqual({ local: true, session: true });
		const script = expressions.find((e) => e.includes('clearStorageInPage')) ?? '';
		expect(() => parse(script, { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
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
