import {
	DEFAULT_STABLE_OPTIONS,
	DEFAULT_TYPE_TEXT_OPTIONS,
	TextInputError,
	UnsupportedKeyError,
	WEBOS_KEY_MAP,
	cdpKeyEvents,
	pageExpression,
	stableWaitScript,
	textChangeScript,
	textFieldScript,
	textNotApplied
} from '@auto-qa/core';
import type {
	Driver,
	RemoteKey,
	ScreenshotOptions,
	StableOptions,
	StableResult,
	TextFieldState,
	TypeTextOptions,
	TypeTextResult
} from '@auto-qa/core';
import type { KeyMode, WebOsDeviceConfig } from './config';
import {
	CdpConnection,
	InspectorError,
	chromiumMajor,
	inspectorVersion,
	listTargets,
	normalizeDebuggerUrl,
	pickAppTarget
} from './inspector';
import type { InspectorTarget } from './inspector';
import { SSAP_BUTTONS, keyProbeInstallScript, keyProbeWaitScript } from './keys';
import { DEFAULT_SSAP_MANIFEST, IME_URI, SsapClient } from './ssap';
import type { PointerSocket, SsapManifest } from './ssap';

export interface KeyPressResult {
	key: RemoteKey;
	via: KeyMode;
	/** 앱이 keydown을 받았는지. HOME처럼 시스템이 처리하는 키는 확인할 수 없어 null */
	delivered: boolean | null;
	/** 보낸 뒤 앱에 도착하기까지 (ms) */
	latencyMs: number;
	/** 앱이 받은 keyCode (도착했을 때) */
	keyCode: number;
}

export interface WebOsDriverOptions {
	config: WebOsDeviceConfig;
	/** 페어링 후 저장된 SSAP client-key. 없으면 TV에 허용 창이 뜬다 */
	clientKey?: string | null;
	manifest?: SsapManifest;
	onPairingPrompt?: () => void;
	/** 새 client-key를 받았을 때 (저장용) */
	onClientKey?: (key: string) => void | Promise<void>;
	/** 키가 앱에 도착하기를 기다리는 최대 시간 (ms) */
	keyDeliveryTimeoutMs?: number;
	/** 앱 페이지가 디버거 목록에 나타나기를 기다리는 최대 시간 (ms) */
	targetTimeoutMs?: number;
}

/** 앱 문서 로드가 끝날 때까지 기다리는 페이지 스크립트 (ES2017) */
function readyInPage(timeoutMs: number): Promise<{ ready: boolean; waitedMs: number }> {
	return new Promise((resolve) => {
		const start = performance.now();
		const tick = (): void => {
			const elapsed = performance.now() - start;
			const ready =
				document.readyState === 'complete' && document.body !== null && document.body.children.length > 0;
			if (ready || elapsed >= timeoutMs) resolve({ ready: ready, waitedMs: Math.round(elapsed) });
			else setTimeout(tick, 20);
		};
		tick();
	});
}

interface NavigateArg {
	token: string;
	/** null이면 그대로 새로 고침, 문자열이면 쿼리 문자열을 바꿔 연다 (예: "?focus=class") */
	search: string | null;
}

/** 현재 문서에 표식을 남기고 다음 틱에 페이지를 다시 연다 (ES2017) */
function navigateInPage(arg: NavigateArg): boolean {
	(window as unknown as { __autoQaNavToken?: string }).__autoQaNavToken = arg.token;
	setTimeout(() => {
		if (arg.search === null) location.reload();
		else location.replace(`${location.protocol}//${location.host}${location.pathname}${arg.search}`);
	}, 0);
	return true;
}

/** 앱 저장 상태(localStorage·sessionStorage)를 지운다. 막힌 저장소는 건너뛴다 (ES2017) */
function clearStorageInPage(): { local: boolean; session: boolean } {
	const out = { local: false, session: false };
	try {
		window.localStorage.clear();
		out.local = true;
	} catch (e) {
		// ES2017: catch 바인딩을 생략할 수 없다 (막힌 저장소면 지우지 못한 것으로 둔다)
		out.local = e === undefined;
	}
	try {
		window.sessionStorage.clear();
		out.session = true;
	} catch (e) {
		out.session = e === undefined;
	}
	return out;
}

export interface DeviceLiveViewOptions {
	/** JPEG 품질 (0~100) */
	quality: number;
	width: number;
	height: number;
}

export const DEFAULT_DEVICE_LIVE_VIEW_OPTIONS: DeviceLiveViewOptions = { quality: 60, width: 960, height: 540 };

/** 표식이 없는(새) 문서이고 로드가 끝났는지 */
function isNewDocumentInPage(token: string): boolean {
	const w = window as unknown as { __autoQaNavToken?: string };
	return w.__autoQaNavToken !== token && document.readyState === 'complete';
}

/** 앱 페이지가 디버거 목록에 나타날 때까지 기다린다 (앱 실행 직후) */
export async function waitForAppTarget(
	config: WebOsDeviceConfig,
	timeoutMs: number
): Promise<{ target: InspectorTarget; all: InspectorTarget[] }> {
	const deadline = Date.now() + timeoutMs;
	let last: InspectorTarget[] = [];
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		try {
			last = await listTargets(config.host, config.inspectorPort, { timeoutMs: 3000 });
			const target = pickAppTarget(last, config.appId);
			if (target !== null) return { target, all: last };
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	if (last.length === 0 && lastError !== null) throw lastError;
	const titles = last.map((t) => `${t.title || '(제목 없음)'} ${t.url}`).join(' | ');
	throw new InspectorError(
		`앱 디버거 목록에서 ${config.appId ?? '검수 앱'} 페이지를 찾지 못했습니다. 앱이 실행 중인지 확인해 주세요. 현재 목록: ${titles || '비어 있음'}`
	);
}

/**
 * webOS 실기기 드라이버 (D-023). 화면 내부는 Inspector(CDP), 리모컨은 SSAP 포인터 소켓(기본) 또는 CDP 키 이벤트.
 */
export class WebOsDriver implements Driver {
	readonly kind = 'webos' as const;
	/** 마지막 키 입력 결과 (리포트용) */
	lastPress: KeyPressResult | null = null;

	private constructor(
		readonly config: WebOsDeviceConfig,
		private cdp: CdpConnection,
		private ssap: SsapClient | null,
		private pointer: PointerSocket | null,
		readonly target: InspectorTarget,
		/** 엔진 표기 (예: Chrome/79.0.3945.79) */
		readonly engine: string | null,
		private readonly keyDeliveryTimeoutMs: number
	) {}

	/** Chromium 주 버전 (예: 79) */
	get chromium(): number | null {
		return chromiumMajor(this.engine ?? undefined);
	}

	static async connect(options: WebOsDriverOptions): Promise<WebOsDriver> {
		const { config } = options;
		const { target } = await waitForAppTarget(config, options.targetTimeoutMs ?? 15_000);
		const cdp = await CdpConnection.connect(normalizeDebuggerUrl(target, config.host, config.inspectorPort));
		let engine = (await inspectorVersion(config.host, config.inspectorPort))?.['Browser'] ?? null;
		if (engine === null) {
			const ua = await cdp.evaluate<string>('navigator.userAgent').catch(() => null);
			engine = /Chrom(?:e|ium)\/[\d.]+/.exec(ua ?? '')?.[0] ?? null;
		}

		let ssap: SsapClient | null = null;
		let pointer: PointerSocket | null = null;
		if (config.keyMode === 'ssap') {
			try {
				ssap = await SsapClient.connect(config.host, {
					securePort: config.ssapSecurePort,
					plainPort: config.ssapPlainPort
				});
				const key = await ssap.register(options.clientKey ?? null, options.manifest ?? DEFAULT_SSAP_MANIFEST, {
					...(options.onPairingPrompt === undefined ? {} : { onPrompt: options.onPairingPrompt })
				});
				if (key !== options.clientKey) await options.onClientKey?.(key);
				pointer = await ssap.openPointerSocket();
			} catch (error) {
				ssap?.close();
				cdp.close();
				throw error;
			}
		}
		return new WebOsDriver(config, cdp, ssap, pointer, target, engine, options.keyDeliveryTimeoutMs ?? 1500);
	}

	/** 키를 보내고 앱 도착을 확인한다 (고정 대기 없음) */
	async press(key: RemoteKey): Promise<KeyPressResult> {
		const before = await this.cdp.evaluate<number>(keyProbeInstallScript());
		const via = this.config.keyMode;
		if (via === 'ssap') {
			if (this.pointer === null) throw new InspectorError('SSAP 포인터 소켓이 없습니다.');
			await this.pointer.button(SSAP_BUTTONS[key]);
		} else {
			const def = WEBOS_KEY_MAP[key];
			if (def === null) {
				throw new UnsupportedKeyError(
					key,
					this.kind,
					'CDP 키 모드에서는 시스템 키를 보낼 수 없습니다 (WEBOS_KEY_MODE=ssap 사용)'
				);
			}
			for (const event of cdpKeyEvents(def)) await this.cdp.send('Input.dispatchKeyEvent', { ...event });
		}
		let result: KeyPressResult;
		if (key === 'HOME') {
			result = { key, via, delivered: null, latencyMs: 0, keyCode: 0 };
		} else {
			const wait = await this.cdp.evaluate<{ delivered: boolean; latencyMs: number; keyCode: number }>(
				keyProbeWaitScript(before, this.keyDeliveryTimeoutMs)
			);
			result = { key, via, ...wait };
		}
		this.lastPress = result;
		return result;
	}

	async pressKey(key: RemoteKey): Promise<void> {
		await this.press(key);
	}

	/**
	 * 글자 입력. SSAP 모드는 플랫폼 키보드 서비스(IME)로 넣는다 — 실제 사용자가 VKB로 치는 것과 같은 경로라
	 * 앱 입력란이 키보드를 연 상태(OK로 편집 시작)여야 한다. 바꿔 쓰기는 커서를 끝으로 옮긴 뒤 글자 수만큼 지운다.
	 * CDP 키 모드는 `Input.insertText`(키보드 서비스를 거치지 않음)로 넣고 확인은 OK 키로 보낸다.
	 */
	async typeText(text: string, options: Partial<TypeTextOptions> = {}): Promise<TypeTextResult> {
		const o = { ...DEFAULT_TYPE_TEXT_OPTIONS, ...options };
		const ime = this.ssap;
		const before = await this.cdp.evaluate<TextFieldState>(textFieldScript('read'));
		if (!before.editable) {
			throw new TextInputError(
				this.kind,
				before.tag === '' ? '포커스된 입력란이 없음' : `포커스된 요소(${before.tag})가 글자를 받지 않음`
			);
		}
		if (ime !== null) {
			if (o.replace && before.value !== '') {
				await this.cdp.evaluate(textFieldScript('end'));
				await ime.request(IME_URI.deleteCharacters, { count: before.value.length });
			}
			if (text !== '') await ime.request(IME_URI.insertText, { text, replace: false });
		} else {
			if (o.replace) await this.cdp.evaluate(textFieldScript(text === '' ? 'clear' : 'select'));
			if (text !== '') await this.cdp.send('Input.insertText', { text });
		}
		const after = await this.cdp.evaluate<TextFieldState & { changed: boolean }>(
			textChangeScript(before.value, o.timeoutMs),
			o.timeoutMs + 10_000
		);
		if (textNotApplied(before.value, after, text, o.replace)) {
			throw new TextInputError(
				this.kind,
				ime === null
					? '넣은 글자가 입력란에 반영되지 않음'
					: '넣은 글자가 입력란에 반영되지 않음 (입력란에서 OK로 키보드를 열었는지, 페어링 권한 CONTROL_INPUT_TEXT 확인)'
			);
		}
		if (o.submit) {
			if (ime !== null) await ime.request(IME_URI.sendEnterKey);
			else await this.press('OK');
		}
		return { value: after.value };
	}

	evaluate<T>(expression: string): Promise<T> {
		return this.cdp.evaluate<T>(expression);
	}

	waitForStable(options: StableOptions = DEFAULT_STABLE_OPTIONS): Promise<StableResult> {
		return this.cdp.evaluate<StableResult>(stableWaitScript(options), options.timeoutMs + 10_000);
	}

	/** 앱 문서 로드 완료까지 대기 */
	waitForReady(timeoutMs = 15_000): Promise<{ ready: boolean; waitedMs: number }> {
		return this.cdp.evaluate(pageExpression(readyInPage, timeoutMs), timeoutMs + 5000);
	}

	screenshot(options: ScreenshotOptions = { type: 'png' }): Promise<Uint8Array> {
		return this.cdp.captureScreenshot(options.type, options.quality);
	}

	/**
	 * 실시간 화면 (CDP 화면 전송, 판정과 무관): 프레임마다 JPEG를 넘기고, 멈추는 함수를 돌려준다.
	 * 디버거 연결이 바뀌면(reattach) 끊기므로 다시 부른다
	 */
	async liveView(
		onFrame: (jpeg: Uint8Array) => void,
		options: Partial<DeviceLiveViewOptions> = {}
	): Promise<() => Promise<void>> {
		const o = { ...DEFAULT_DEVICE_LIVE_VIEW_OPTIONS, ...options };
		const cdp = this.cdp;
		const handler = (params: Record<string, unknown>): void => {
			void cdp.send('Page.screencastFrameAck', { sessionId: params['sessionId'] }).catch(() => undefined);
			const data = params['data'];
			if (typeof data === 'string') onFrame(new Uint8Array(Buffer.from(data, 'base64')));
		};
		cdp.on('Page.screencastFrame', handler);
		await cdp.send('Page.startScreencast', {
			format: 'jpeg',
			quality: o.quality,
			maxWidth: o.width,
			maxHeight: o.height
		});
		return async () => {
			cdp.off('Page.screencastFrame', handler);
			if (!cdp.isClosed) await cdp.send('Page.stopScreencast').catch(() => undefined);
		};
	}

	/**
	 * 앱 저장 상태(localStorage·sessionStorage)를 지운다. 브라우저 시뮬레이터의 "새 컨텍스트"에 해당하는 TV 쪽 초기화다.
	 * 지운 뒤 reloadApp으로 다시 열면 앞 단계가 남긴 최근 검색어 같은 상태가 없어진다 (서버에 저장된 상태는 남는다)
	 */
	clearAppStorage(): Promise<{ local: boolean; session: boolean }> {
		return this.cdp.evaluate(pageExpression(clearStorageInPage, null));
	}

	/** 앱을 다시 실행한 뒤 디버거 연결만 새로 맺는다 (SSAP 연결은 유지) */
	async reattach(timeoutMs = 15_000): Promise<void> {
		this.cdp.close();
		const { target } = await waitForAppTarget(this.config, timeoutMs);
		this.cdp = await CdpConnection.connect(
			normalizeDebuggerUrl(target, this.config.host, this.config.inspectorPort)
		);
	}

	/**
	 * 앱 페이지를 다시 연다 (앱 재실행보다 빠른 시작 상태 초기화). search를 주면 쿼리 문자열을 바꿔 연다.
	 * 새 문서가 로드될 때까지 기다린다 (고정 대기 없음). 이동 중 디버거 연결이 끊기면 다시 붙는다.
	 */
	async reloadApp(search: string | null = null, timeoutMs = 15_000): Promise<void> {
		const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
		await this.cdp.evaluate(pageExpression(navigateInPage, { token, search }));
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			try {
				if (this.cdp.isClosed) await this.reattach(Math.max(1000, deadline - Date.now()));
				if (await this.cdp.evaluate<boolean>(pageExpression(isNewDocumentInPage, token), 5000)) return;
			} catch {
				// 이동 중에는 평가가 실패하거나 연결이 잠시 끊길 수 있다
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new InspectorError('앱 페이지 다시 열기 시간 초과');
	}

	/** 콘솔 예외를 모은다 (Runtime.enable 이후의 예외) */
	async collectExceptions(sink: string[]): Promise<void> {
		this.cdp.on('Runtime.exceptionThrown', (params) => {
			const details = params['exceptionDetails'] as
				{ text?: string; exception?: { description?: string } } | undefined;
			sink.push(details?.exception?.description ?? details?.text ?? '알 수 없는 예외');
		});
		await this.cdp.send('Runtime.enable');
	}

	async close(): Promise<void> {
		this.pointer?.close();
		this.ssap?.close();
		this.cdp.close();
	}
}
