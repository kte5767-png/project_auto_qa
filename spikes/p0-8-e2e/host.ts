/**
 * 앱을 여는 곳 (D-020·D-027): 브라우저 시뮬레이터 또는 실제 webOS TV. TC 실행(tc.ts)은 이 인터페이스만 보고
 * 어느 쪽에서 도는지 모른다. "처음 상태로 열기"의 뜻은 같다: 앞 단계가 남긴 저장 상태(최근 검색어 등) 없이 시작.
 * - 브라우저: 새 컨텍스트로 연다 (저장 상태도 새로)
 * - TV: 앱 저장소(localStorage·sessionStorage)를 지우고 앱 페이지를 다시 연다 (서버에 저장된 상태는 남는다)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserDriver } from '@auto-qa/browser';
import type { launchBrowser } from '@auto-qa/browser';
import type { Driver } from '@auto-qa/core';
import { AresCli, DeviceStore, WebOsDriver, deviceConfigFromEnv, requireAppId } from '@auto-qa/device-webos';
import type { WebOsDeviceConfig } from '@auto-qa/device-webos';

export type LiveView = (onFrame: (jpeg: Uint8Array) => void) => Promise<() => Promise<void>>;

export interface HostedApp {
	driver: Driver;
	/** 실시간 화면 (판정과 무관). 없으면 null */
	liveView: LiveView | null;
	/** 이 앱을 닫는다 (브라우저: 컨텍스트, TV: 연결은 두고 아무것도 하지 않음) */
	close(): Promise<void>;
}

export interface AppHost {
	readonly kind: 'browser' | 'webos';
	/** 화면에 보일 이름 (주소 또는 TV) */
	readonly label: string;
	/** 앱을 처음 상태로 연다 */
	launch(): Promise<HostedApp>;
	close(): Promise<void>;
}

export class BrowserHost implements AppHost {
	readonly kind = 'browser';

	constructor(
		private readonly browser: Awaited<ReturnType<typeof launchBrowser>>,
		private readonly url: string
	) {}

	get label(): string {
		return this.url;
	}

	async launch(): Promise<HostedApp> {
		const driver = await BrowserDriver.open(this.browser, this.url);
		return {
			driver,
			liveView: (onFrame) => driver.liveView(onFrame),
			close: () => driver.close()
		};
	}

	close(): Promise<void> {
		return this.browser.close();
	}
}

export interface WebOsHostOptions {
	/** 저장소 루트 (.env와 .data/devices가 있는 곳) */
	root: string;
	/** 앱 ID (없으면 .env의 WEBOS_APP_ID) */
	appId?: string;
	/** TV에 페어링 요청이 떴을 때 */
	onPairingPrompt?: () => void;
}

/**
 * 실제 TV(또는 가짜 TV): .env의 WEBOS_* 설정으로 연결한다. 앱이 꺼져 있으면 ares로 실행하고, SSAP 페어링 키는
 * .data/devices에만 둔다 (CLAUDE.md 보안). 개발자 모드 passphrase는 여기서 쓰지 않는다 (spike:device setup)
 */
export class WebOsHost implements AppHost {
	readonly kind = 'webos';
	private launched = false;

	private constructor(
		readonly config: WebOsDeviceConfig,
		private readonly driver: WebOsDriver
	) {}

	get label(): string {
		return `TV ${this.config.name} (${this.config.host}) ${this.config.appId ?? ''}`.trim();
	}

	static loadConfig(root: string, appId?: string): WebOsDeviceConfig {
		const envFile = join(root, '.env');
		if (existsSync(envFile)) process.loadEnvFile(envFile);
		const env = { ...process.env };
		if (appId !== undefined) env['WEBOS_APP_ID'] = appId;
		return deviceConfigFromEnv(env);
	}

	static async connect(options: WebOsHostOptions): Promise<WebOsHost> {
		const config = WebOsHost.loadConfig(options.root, options.appId);
		const appId = requireAppId(config);
		const ares = new AresCli(config.name);
		// 앱이 꺼져 있으면 켠다 (ares로 확인하지 못하면 켜져 있다고 보고 디버거 연결로 확인한다)
		const running = await ares.running().catch(() => null);
		if (running !== null && !running.includes(appId)) await ares.launch(appId);
		const store = new DeviceStore(join(options.root, '.data', 'devices'));
		const record = await store.load(config.name);
		const driver = await WebOsDriver.connect({
			config,
			clientKey: record?.ssapClientKey ?? null,
			...(options.onPairingPrompt === undefined ? {} : { onPairingPrompt: options.onPairingPrompt }),
			onClientKey: async (key) => {
				await store.update(config.name, config.host, {
					ssapClientKey: key,
					pairedAt: new Date().toISOString()
				});
			}
		});
		return new WebOsHost(config, driver);
	}

	async launch(): Promise<HostedApp> {
		const { driver } = this;
		// 처음 연결한 직후에도 저장소를 지우고 다시 열어, 브라우저 시뮬레이터의 새 컨텍스트와 같은 상태에서 시작한다
		await driver.clearAppStorage().catch(() => undefined);
		await driver.reloadApp();
		await driver.waitForReady();
		this.launched = true;
		return {
			driver,
			liveView: (onFrame) => driver.liveView(onFrame),
			close: () => Promise.resolve()
		};
	}

	/** 앱을 연 적이 있는가 (진단용) */
	get opened(): boolean {
		return this.launched;
	}

	close(): Promise<void> {
		return this.driver.close();
	}
}
