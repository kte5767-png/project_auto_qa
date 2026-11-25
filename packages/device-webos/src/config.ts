/**
 * webOS 장치 설정. 에이전트 PC의 `.env`(또는 환경 변수)에서 읽는다.
 * 개발자 모드 passphrase는 여기에 두지 않는다 (ares-novacom --getkey 실행 시 사람이 직접 입력).
 */

export type KeyMode = 'ssap' | 'cdp';

export interface WebOsDeviceConfig {
	/** ares-setup-device에 등록한 장치 이름 */
	name: string;
	/** TV IP 또는 호스트 이름 */
	host: string;
	/** 검수할 앱 ID (appinfo.json의 id). 연결 확인만 할 때는 없어도 된다 */
	appId: string | null;
	/** 개발자 모드 SSH 포트 (ares) */
	sshPort: number;
	/** 개발자 모드 앱 디버거(Web Inspector) 포트 */
	inspectorPort: number;
	/** SSAP 포트: 보안(wss) 먼저, 실패하면 일반(ws) */
	ssapSecurePort: number;
	ssapPlainPort: number;
	/**
	 * 리모컨 입력 경로.
	 * ssap: 실제 리모컨과 같은 시스템 경로 (Back·Home 시스템 동작까지 검증, 기본)
	 * cdp: Inspector로 페이지에 키 이벤트를 직접 넣음 (SSAP를 못 쓸 때의 대안. HOME 불가)
	 */
	keyMode: KeyMode;
	/** SSAP 등록 manifest JSON 파일 경로 (기본 manifest로 권한이 부족할 때만) */
	ssapManifestFile: string | null;
}

export class DeviceConfigError extends Error {
	override name = 'DeviceConfigError';
}

const HOST_PATTERN =
	/^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)$/;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const APP_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,127}$/;

export function isValidHost(host: string): boolean {
	if (!HOST_PATTERN.test(host)) return false;
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host.split('.').every((p) => Number(p) <= 255);
	return true;
}

export function isValidAppId(appId: string): boolean {
	return APP_ID_PATTERN.test(appId);
}

function port(env: Record<string, string | undefined>, key: string, fallback: number): number {
	const raw = env[key];
	if (raw === undefined || raw.trim() === '') return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		throw new DeviceConfigError(`${key}는 1~65535 사이의 정수여야 합니다: ${raw}`);
	}
	return value;
}

/**
 * 환경 변수에서 장치 설정을 읽는다.
 * WEBOS_HOST(필수), WEBOS_DEVICE(기본 tv), WEBOS_APP_ID, WEBOS_KEY_MODE(ssap|cdp),
 * WEBOS_SSH_PORT(9922), WEBOS_INSPECTOR_PORT(9998), WEBOS_SSAP_PORT(3001), WEBOS_SSAP_PLAIN_PORT(3000), WEBOS_SSAP_MANIFEST
 */
export function deviceConfigFromEnv(env: Record<string, string | undefined>): WebOsDeviceConfig {
	const host = (env['WEBOS_HOST'] ?? '').trim();
	if (host === '') {
		throw new DeviceConfigError('WEBOS_HOST(TV IP)가 없습니다. .env에 WEBOS_HOST=192.168.0.10 처럼 넣어 주세요.');
	}
	if (!isValidHost(host)) throw new DeviceConfigError(`WEBOS_HOST 형식이 올바르지 않습니다: ${host}`);

	const name = (env['WEBOS_DEVICE'] ?? 'tv').trim() || 'tv';
	if (!NAME_PATTERN.test(name)) {
		throw new DeviceConfigError(`WEBOS_DEVICE는 영문·숫자·-·_만 쓸 수 있습니다: ${name}`);
	}

	const appIdRaw = (env['WEBOS_APP_ID'] ?? '').trim();
	if (appIdRaw !== '' && !isValidAppId(appIdRaw)) {
		throw new DeviceConfigError(`WEBOS_APP_ID 형식이 올바르지 않습니다: ${appIdRaw}`);
	}

	const keyModeRaw = (env['WEBOS_KEY_MODE'] ?? 'ssap').trim() || 'ssap';
	if (keyModeRaw !== 'ssap' && keyModeRaw !== 'cdp') {
		throw new DeviceConfigError(`WEBOS_KEY_MODE는 ssap 또는 cdp입니다: ${keyModeRaw}`);
	}

	const manifest = (env['WEBOS_SSAP_MANIFEST'] ?? '').trim();
	return {
		name,
		host,
		appId: appIdRaw === '' ? null : appIdRaw,
		sshPort: port(env, 'WEBOS_SSH_PORT', 9922),
		inspectorPort: port(env, 'WEBOS_INSPECTOR_PORT', 9998),
		ssapSecurePort: port(env, 'WEBOS_SSAP_PORT', 3001),
		ssapPlainPort: port(env, 'WEBOS_SSAP_PLAIN_PORT', 3000),
		keyMode: keyModeRaw,
		ssapManifestFile: manifest === '' ? null : manifest
	};
}

export function requireAppId(config: WebOsDeviceConfig): string {
	if (config.appId === null) {
		throw new DeviceConfigError('WEBOS_APP_ID(검수할 앱 ID)가 없습니다. .env에 넣거나 --app으로 지정해 주세요.');
	}
	return config.appId;
}
