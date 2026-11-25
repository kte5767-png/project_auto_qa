/**
 * P0-6 실기기(webOS) 연결 스파이크.
 * TV와 같은 네트워크의 PC에서, 프로젝트 루트의 .env(WEBOS_HOST 등)를 채운 뒤 실행한다. 자세한 순서는 README.md.
 *
 *   pnpm spike:device doctor                      연결 진단 (ares·포트·디버거·엔진 버전)
 *   pnpm spike:device setup                       ares 장치 등록 + 개발자 모드 키 받기 (passphrase는 직접 입력)
 *   pnpm spike:device pair                        SSAP 페어링 (TV 화면에서 허용)
 *   pnpm spike:device info                        모델·webOS·엔진 버전 기록
 *   pnpm spike:device sample-ipk                  샘플 앱 ipk 만들기
 *   pnpm spike:device install <ipk>               ipk 설치
 *   pnpm spike:device launch | close              앱 실행·종료 (--params "{'focus':'class'}")
 *   pnpm spike:device keys "RIGHT*3 DOWN OK BACK" 키 입력 + 키 도착·포커스 확인
 *   pnpm spike:device focus [--sample spotlight|class] [--keys …] [--reset relaunch|reload]
 *                                                 완료 기준 측정: 방향키 20회 포커스 식별 + 단계별 캡처
 *   pnpm spike:device devmode                     개발자 모드 남은 시간 (실험적)
 *
 * 공통 옵션: --app <앱 ID> (WEBOS_APP_ID 대신)
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseKeySequence } from '@auto-qa/core';
import type { RemoteKey } from '@auto-qa/core';
import {
	AresCli,
	DeviceStore,
	SsapClient,
	WebOsDriver,
	checkDevModeSession,
	chromiumMajor,
	deviceConfigFromEnv,
	inspectorVersion,
	listTargets,
	probePort,
	readDevModeToken,
	requireAppId
} from '@auto-qa/device-webos';
import type { SsapManifest, WebOsDeviceConfig } from '@auto-qa/device-webos';
import { collectFocusState, readActiveElement, readEnactSpotlight } from '@auto-qa/focus';
import type { FocusAdapterId } from '@auto-qa/focus';
import { SAMPLE_APP_ID, buildWebosApp } from '@auto-qa/sample-tv-app/build-webos';
import { sampleTruthScript } from '@auto-qa/sample-tv-app/truth';
import type { SampleTruth } from '@auto-qa/sample-tv-app/truth';
import { DEFAULT_MEASURE_KEYS, renderFocusReport, runFocusMeasurement, summarize } from '@auto-qa/spike-shared';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');
/** pnpm 스크립트는 패키지 폴더에서 돌므로, 사용자가 입력한 상대 경로는 원래 위치 기준으로 푼다 */
const USER_CWD = process.env['INIT_CWD'] ?? process.cwd();
const MIN_CHROMIUM = 68;
const ok = (text: string): void => console.log(`  ✓ ${text}`);
const bad = (text: string): void => console.log(`  ✗ ${text}`);
const info = (text: string): void => console.log(`    ${text}`);

function loadConfig(app: string | undefined): WebOsDeviceConfig {
	const envFile = join(ROOT, '.env');
	if (existsSync(envFile)) process.loadEnvFile(envFile);
	const env = { ...process.env };
	if (app !== undefined) env['WEBOS_APP_ID'] = app;
	return deviceConfigFromEnv(env);
}

async function loadManifest(config: WebOsDeviceConfig): Promise<SsapManifest | undefined> {
	if (config.ssapManifestFile === null) return undefined;
	return JSON.parse(await readFile(resolve(ROOT, config.ssapManifestFile), 'utf8')) as SsapManifest;
}

function stamp(): string {
	const d = new Date();
	const p = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function doctor(config: WebOsDeviceConfig, ares: AresCli, store: DeviceStore): Promise<void> {
	console.log(
		`\n[설정] 장치 ${config.name} / TV ${config.host} / 앱 ${config.appId ?? '(없음)'} / 키 입력 ${config.keyMode}`
	);

	console.log('\n[ares CLI]');
	const version = await ares.version();
	if (version === null) {
		bad('ares CLI가 없습니다 → npm install -g @webos-tools/cli');
	} else {
		ok(`설치됨 (${version})`);
		const devices = await ares.listDevices().catch(() => []);
		const entry = devices.find((d) => d.name === config.name);
		if (entry === undefined) bad(`장치 "${config.name}"이 등록되지 않았습니다 → pnpm spike:device setup`);
		else if (entry.host !== config.host)
			bad(`장치 "${config.name}"의 IP(${entry.host ?? '?'})가 WEBOS_HOST와 다릅니다 → setup 다시 실행`);
		else ok(`장치 등록됨 (${entry.user ?? '?'}@${entry.host}:${entry.port ?? '?'})`);
	}

	console.log('\n[포트]');
	const ports: [string, number, string][] = [
		['개발자 모드 SSH (ares)', config.sshPort, 'Developer Mode 앱에서 Dev Mode Status를 켜 주세요 (TV 재부팅)'],
		['SSAP 보안 (리모컨 입력)', config.ssapSecurePort, ''],
		['SSAP 일반 (리모컨 입력)', config.ssapPlainPort, ''],
		[
			'앱 디버거 (Inspector)',
			config.inspectorPort,
			'개발자 모드가 켜져 있고, 개발자 모드로 설치한 앱이 실행 중이어야 합니다'
		]
	];
	const open: Record<number, boolean> = {};
	for (const [label, port, hint] of ports) {
		const result = await probePort(config.host, port);
		open[port] = result.open;
		if (result.open) ok(`${label} ${port} 열림 (${result.ms}ms)`);
		else {
			bad(`${label} ${port} 닫힘 (${result.error})`);
			if (hint !== '') info(hint);
		}
	}
	if (open[config.ssapSecurePort] !== true && open[config.ssapPlainPort] !== true) {
		info(
			'TV 설정에서 "LG Connect Apps"(모델에 따라 "모바일 TV 켜기"·"외부 장치 연결") 항목을 켜 주세요. 그래도 안 되면 WEBOS_KEY_MODE=cdp로 진행할 수 있습니다.'
		);
	}

	console.log('\n[앱 디버거]');
	try {
		const targets = await listTargets(config.host, config.inspectorPort);
		const pages = targets.filter((t) => t.type === 'page');
		ok(`디버깅 대상 ${pages.length}개`);
		for (const t of pages) info(`- ${t.title || '(제목 없음)'}  ${t.url}`);
		if (
			config.appId !== null &&
			!pages.some((t) => t.url.includes(config.appId ?? '') || t.title.includes(config.appId ?? ''))
		) {
			bad(`검수 앱(${config.appId})이 목록에 없습니다 → pnpm spike:device launch`);
		}
		const version = await inspectorVersion(config.host, config.inspectorPort);
		const major = chromiumMajor(version?.['Browser'] ?? version?.['User-Agent']);
		if (major === null)
			info('엔진 버전을 /json/version에서 얻지 못했습니다 (keys·focus 실행 시 User-Agent로 확인)');
		else if (major < MIN_CHROMIUM)
			bad(`엔진 Chromium ${major}: 지원 범위(webOS 5.x, Chromium ${MIN_CHROMIUM} 이상) 밖입니다`);
		else ok(`엔진 Chromium ${major}`);
	} catch (error) {
		bad((error as Error).message);
	}

	console.log('\n[SSAP 페어링]');
	const record = await store.load(config.name);
	if (record?.ssapClientKey !== null && record?.ssapClientKey !== undefined)
		ok(`페어링 키 저장됨 (${record.pairedAt ?? ''})`);
	else bad('페어링 전입니다 → pnpm spike:device pair');

	if (version !== null) {
		console.log('\n[장치 정보]');
		try {
			const sys = await ares.systemInfo();
			for (const [k, v] of Object.entries(sys)) info(`${k}: ${v}`);
			await store.update(config.name, config.host, {
				...(sys['modelName'] === undefined ? {} : { modelName: sys['modelName'] }),
				...(sys['sdkVersion'] === undefined ? {} : { sdkVersion: sys['sdkVersion'] }),
				...(sys['firmwareVersion'] === undefined ? {} : { firmwareVersion: sys['firmwareVersion'] }),
				checkedAt: new Date().toISOString()
			});
		} catch (error) {
			bad((error as Error).message);
		}
	}
}

async function pair(config: WebOsDeviceConfig, store: DeviceStore): Promise<void> {
	const record = await store.load(config.name);
	const client = await SsapClient.connect(config.host, {
		securePort: config.ssapSecurePort,
		plainPort: config.ssapPlainPort
	});
	try {
		ok(`SSAP 연결 (${client.url})`);
		const key = await client.register(record?.ssapClientKey ?? null, await loadManifest(config), {
			onPrompt: () => console.log('  → TV 화면에 뜬 연결 요청에서 "허용"을 눌러 주세요 (60초 안에)')
		});
		await store.update(config.name, config.host, { ssapClientKey: key, pairedAt: new Date().toISOString() });
		ok('페어링 완료 (키는 .data/devices에 저장, 커밋되지 않음)');
		const pointer = await client.openPointerSocket();
		ok('리모컨 입력 소켓 열림');
		pointer.close();
	} finally {
		client.close();
	}
}

async function connectDriver(config: WebOsDeviceConfig, store: DeviceStore): Promise<WebOsDriver> {
	const record = await store.load(config.name);
	const driver = await WebOsDriver.connect({
		config,
		clientKey: record?.ssapClientKey ?? null,
		...(config.keyMode === 'ssap' ? { manifest: await loadManifest(config) } : {}),
		onPairingPrompt: () => console.log('  → TV 화면에 뜬 연결 요청에서 "허용"을 눌러 주세요'),
		onClientKey: async (key) => {
			await store.update(config.name, config.host, { ssapClientKey: key, pairedAt: new Date().toISOString() });
		}
	});
	await store.update(config.name, config.host, { ...(driver.engine === null ? {} : { engine: driver.engine }) });
	return driver;
}

async function ensureRunning(ares: AresCli, appId: string, params?: Record<string, string>): Promise<void> {
	let running: string[];
	try {
		running = await ares.running();
	} catch (error) {
		console.log(`  (ares로 실행 여부를 확인하지 못해 실행 중이라고 보고 계속합니다: ${(error as Error).message})`);
		return;
	}
	if (!running.includes(appId)) {
		console.log(`  앱 실행: ${appId}`);
		await ares.launch(appId, params);
	}
}

function describeFocus(el: { spotlightId: string | null; id: string | null; tag: string } | null): string {
	if (el === null) return '없음';
	if (el.spotlightId !== null) return el.spotlightId;
	if (el.id !== null) return `#${el.id}`;
	return el.tag;
}

async function keys(
	config: WebOsDeviceConfig,
	ares: AresCli,
	store: DeviceStore,
	sequence: RemoteKey[]
): Promise<void> {
	const appId = requireAppId(config);
	await ensureRunning(ares, appId);
	const driver = await connectDriver(config, store);
	try {
		ok(
			`연결: ${driver.target.title || driver.target.url} / ${driver.engine ?? '엔진 미확인'} / 키 입력 ${config.keyMode}`
		);
		for (const key of sequence) {
			const press = await driver.press(key);
			const stable = await driver.waitForStable();
			const state = await collectFocusState(driver);
			const focus = readEnactSpotlight(state).element ?? readActiveElement(state).element;
			const arrived =
				press.delivered === null
					? '도착 확인 불가(시스템 키)'
					: press.delivered
						? `도착 ${press.latencyMs}ms`
						: '도착 안 함';
			console.log(
				`  ${key.padEnd(5)} ${arrived}, 안정화 ${stable.waitedMs}ms${stable.stable ? '' : '(시간 초과)'} → 포커스 ${describeFocus(focus)} ${focus?.text === undefined ? '' : `"${focus.text}"`}`
			);
		}
	} finally {
		await driver.close();
	}
}

async function focus(
	config: WebOsDeviceConfig,
	ares: AresCli,
	store: DeviceStore,
	options: { keys: RemoteKey[]; sample: 'spotlight' | 'class' | null; reset: 'relaunch' | 'reload'; out: string }
): Promise<void> {
	const effective: WebOsDeviceConfig = options.sample === null ? config : { ...config, appId: SAMPLE_APP_ID };
	const appId = requireAppId(effective);
	const params = options.sample === null ? undefined : { focus: options.sample, defects: 'none' };
	const search = options.sample === null ? null : `?focus=${options.sample}&defects=none`;
	const record = await store.load(config.name);

	if (options.reset === 'relaunch') {
		await ares.close(appId).catch(() => undefined);
		await ares.launch(appId, params);
	} else {
		await ensureRunning(ares, appId, params);
	}
	const driver = await connectDriver(effective, store);
	const errors: string[] = [];
	await driver.collectExceptions(errors);
	const outDir = resolve(USER_CWD, options.out, `${config.name}-${stamp()}`);
	await mkdir(outDir, { recursive: true });
	const name = options.sample === null ? appId : `sample-${options.sample}`;
	console.log(`\n[${name}] ${driver.engine ?? '엔진 미확인'} / 키 입력 ${config.keyMode} / 초기화 ${options.reset}`);

	const reset = async (): Promise<void> => {
		if (options.reset === 'relaunch') {
			await ares.close(appId).catch(() => undefined);
			await ares.launch(appId, params);
			await driver.reattach();
			await driver.collectExceptions(errors);
		} else {
			await driver.reloadApp(search);
		}
		const ready = await driver.waitForReady();
		if (!ready.ready) console.log('  (앱 로드 완료를 확인하지 못했습니다)');
	};

	const expected: { adapter: FocusAdapterId; selector?: string } | null =
		options.sample === null
			? null
			: options.sample === 'class'
				? { adapter: 'selector', selector: '.focused' }
				: { adapter: 'enact-spotlight' };
	try {
		const result = await runFocusMeasurement(driver, {
			name,
			description: `${config.host} ${appId}`,
			meta: {
				장치: config.name,
				모델: record?.modelName ?? '(doctor/info로 확인)',
				'webOS SDK': record?.sdkVersion ?? '-',
				펌웨어: record?.firmwareVersion ?? '-',
				엔진: driver.engine ?? '미확인',
				'키 입력': config.keyMode === 'ssap' ? 'SSAP 포인터 소켓 (실제 리모컨 경로)' : 'CDP 키 이벤트',
				'시작 상태 초기화': options.reset === 'relaunch' ? '앱 재실행 (ares)' : '페이지 다시 열기',
				측정: new Date().toISOString()
			},
			keys: options.keys,
			outDir,
			reset,
			press: async (key) => {
				const r = await driver.press(key);
				return { delivered: r.delivered, latencyMs: r.latencyMs };
			},
			readTruth: options.sample === null ? null : () => driver.evaluate<SampleTruth>(sampleTruthScript()),
			expected,
			onStep: (step) => {
				const top = step.readings[0];
				process.stdout.write(
					`  #${String(step.index).padStart(2, '0')} ${step.key.padEnd(5)} ${top?.element?.spotlightId ?? top?.element?.tag ?? '-'}\n`
				);
			}
		});
		result.meta['콘솔 예외'] =
			errors.length === 0 ? '없음' : `${errors.length}건: ${errors.slice(0, 3).join(' | ')}`;
		console.log('');
		for (const line of summarize(result)) console.log(`  ${line}`);

		const top = result.candidates[0]?.adapter;
		const acc = top === undefined ? undefined : result.accuracy[top];
		console.log('\n[완료 기준] 방향키 20회 포커스 식별 ≥ 95%, 단계별 캡처');
		if (acc !== undefined) {
			const rate = acc.hits / acc.total;
			(rate >= 0.95 ? ok : bad)(`1순위 어댑터(${top}) 정확도 ${Math.round(rate * 100)}% (정답 대비)`);
			if (rate < 0.95) process.exitCode = 1;
		} else {
			info('정답이 없는 앱입니다. 리포트에서 단계마다 실제 포커스와 1순위 상자를 비교해 "틀림"에 표시해 주세요.');
		}
		ok(`캡처 ${result.steps.length}장`);
		if (errors.length > 0) bad(`콘솔 예외 ${errors.length}건 (리포트 참고)`);

		await writeFile(join(outDir, 'results.json'), JSON.stringify(result, null, 2));
		await writeFile(join(outDir, 'report.html'), renderFocusReport('P0-6 실기기 포커스 판별', [result]));
		console.log(`\n리포트: ${join(outDir, 'report.html')}`);
	} finally {
		await driver.close();
	}
}

async function devmode(config: WebOsDeviceConfig, ares: AresCli, store: DeviceStore): Promise<void> {
	console.log(
		'  (실험적) TV의 세션 토큰으로 LG 개발자 사이트에 남은 시간을 조회합니다. 토큰 외 정보는 보내지 않습니다.'
	);
	const token = await readDevModeToken(ares);
	const session = await checkDevModeSession(token);
	const hours = Math.floor(session.remainingMs / 3_600_000);
	(hours >= 48 ? ok : bad)(`개발자 모드 남은 시간 ${session.remainingText} (약 ${hours}시간)`);
	if (hours < 48) info('만료되면 설치한 앱이 삭제됩니다. TV의 Developer Mode 앱에서 연장해 주세요.');
	await store.update(config.name, config.host, {
		devModeRemaining: session.remainingText,
		checkedAt: new Date().toISOString()
	});
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			app: { type: 'string' },
			keys: { type: 'string', default: DEFAULT_MEASURE_KEYS },
			sample: { type: 'string' },
			reset: { type: 'string', default: 'relaunch' },
			params: { type: 'string' },
			out: { type: 'string', default: join(HERE, 'out') }
		}
	});
	const [command, ...rest] = positionals;
	if (command === undefined) {
		console.log(
			'명령: doctor | setup | pair | info | sample-ipk | install <ipk> | launch | close | keys "<키>" | focus | devmode (README.md 참고)'
		);
		return;
	}
	const config = loadConfig(values.app);
	const ares = new AresCli(config.name);
	const store = new DeviceStore(join(ROOT, '.data', 'devices'));

	switch (command) {
		case 'doctor':
			await doctor(config, ares, store);
			break;
		case 'setup': {
			const devices = await ares.listDevices().catch(() => []);
			if (!devices.some((d) => d.name === config.name && d.host === config.host)) {
				await ares.addDevice(config.host, config.sshPort);
				ok(`ares 장치 등록: ${config.name} → ${config.host}:${config.sshPort}`);
			} else ok('이미 등록된 장치입니다');
			console.log('  → TV의 Developer Mode 앱 화면에 나온 Passphrase를 입력해 주세요 (저장하지 않습니다)');
			if (await ares.getKey()) ok('개발자 모드 키 받기 완료');
			else bad('키 받기 실패: Developer Mode 앱의 Key Server가 켜져 있는지 확인해 주세요');
			break;
		}
		case 'pair':
			await pair(config, store);
			break;
		case 'info': {
			const sys = await ares.systemInfo();
			for (const [k, v] of Object.entries(sys)) info(`${k}: ${v}`);
			const version = await inspectorVersion(config.host, config.inspectorPort);
			info(`엔진: ${version?.['Browser'] ?? '미확인 (앱 실행 후 다시 시도)'}`);
			await store.update(config.name, config.host, {
				...(sys['modelName'] === undefined ? {} : { modelName: sys['modelName'] }),
				...(sys['sdkVersion'] === undefined ? {} : { sdkVersion: sys['sdkVersion'] }),
				...(sys['firmwareVersion'] === undefined ? {} : { firmwareVersion: sys['firmwareVersion'] }),
				...(version?.['Browser'] === undefined ? {} : { engine: version['Browser'] }),
				checkedAt: new Date().toISOString()
			});
			break;
		}
		case 'sample-ipk': {
			const appDir = await buildWebosApp();
			ok(`샘플 앱 빌드: ${appDir}`);
			const outDir = resolve(USER_CWD, values.out, 'ipk');
			await mkdir(outDir, { recursive: true });
			const ipk = await ares.packageApp(appDir, outDir);
			ok(`ipk: ${ipk}`);
			info(`다음: pnpm spike:device install "${ipk}"  →  pnpm spike:device focus --sample spotlight`);
			break;
		}
		case 'install': {
			const ipk = rest[0];
			if (ipk === undefined) throw new Error('ipk 경로를 넣어 주세요: pnpm spike:device install <파일.ipk>');
			await ares.install(resolve(USER_CWD, ipk));
			ok('설치 완료');
			break;
		}
		case 'launch': {
			const params =
				values.params === undefined
					? undefined
					: (JSON.parse(values.params.replace(/'/g, '"')) as Record<string, string>);
			await ares.launch(requireAppId(config), params);
			ok('실행');
			break;
		}
		case 'close':
			await ares.close(requireAppId(config));
			ok('종료');
			break;
		case 'keys':
			await keys(config, ares, store, parseKeySequence(rest.join(' ') || 'RIGHT DOWN LEFT UP'));
			break;
		case 'focus': {
			const sample = values.sample ?? null;
			if (sample !== null && sample !== 'spotlight' && sample !== 'class')
				throw new Error('--sample은 spotlight 또는 class입니다');
			if (values.reset !== 'relaunch' && values.reset !== 'reload')
				throw new Error('--reset은 relaunch 또는 reload입니다');
			await focus(config, ares, store, {
				keys: parseKeySequence(values.keys),
				sample,
				reset: values.reset,
				out: values.out
			});
			break;
		}
		case 'devmode':
			await devmode(config, ares, store);
			break;
		default:
			throw new Error(`알 수 없는 명령: ${command}`);
	}
}

try {
	await main();
} catch (error) {
	console.error(`\n✗ ${(error as Error).message}`);
	process.exitCode = 1;
}
