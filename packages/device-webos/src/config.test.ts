import { describe, expect, it } from 'vitest';
import { DeviceConfigError, deviceConfigFromEnv, isValidAppId, isValidHost, requireAppId } from './config';

describe('deviceConfigFromEnv', () => {
	it('필수값만 있으면 기본값을 채운다', () => {
		const config = deviceConfigFromEnv({ WEBOS_HOST: '192.168.0.10' });
		expect(config).toEqual({
			name: 'tv',
			host: '192.168.0.10',
			appId: null,
			sshPort: 9922,
			inspectorPort: 9998,
			ssapSecurePort: 3001,
			ssapPlainPort: 3000,
			keyMode: 'ssap',
			ssapManifestFile: null
		});
	});

	it('값을 바꿀 수 있다', () => {
		const config = deviceConfigFromEnv({
			WEBOS_HOST: 'living-tv.local',
			WEBOS_DEVICE: 'tv2',
			WEBOS_APP_ID: 'com.lg.app.travelplus',
			WEBOS_KEY_MODE: 'cdp',
			WEBOS_INSPECTOR_PORT: '9222'
		});
		expect(config.name).toBe('tv2');
		expect(config.appId).toBe('com.lg.app.travelplus');
		expect(config.keyMode).toBe('cdp');
		expect(config.inspectorPort).toBe(9222);
	});

	it('TV IP가 없거나 형식이 틀리면 알려 준다', () => {
		expect(() => deviceConfigFromEnv({})).toThrow(DeviceConfigError);
		expect(() => deviceConfigFromEnv({ WEBOS_HOST: '10.0.0.1; rm -rf /' })).toThrow(/형식/);
		expect(() => deviceConfigFromEnv({ WEBOS_HOST: '300.1.1.1' })).toThrow(/형식/);
	});

	it('키 모드·포트·장치 이름·앱 ID를 검사한다', () => {
		const base = { WEBOS_HOST: '10.0.0.1' };
		expect(() => deviceConfigFromEnv({ ...base, WEBOS_KEY_MODE: 'mouse' })).toThrow(/ssap 또는 cdp/);
		expect(() => deviceConfigFromEnv({ ...base, WEBOS_INSPECTOR_PORT: '70000' })).toThrow(/65535/);
		expect(() => deviceConfigFromEnv({ ...base, WEBOS_DEVICE: 'tv 1' })).toThrow(/WEBOS_DEVICE/);
		expect(() => deviceConfigFromEnv({ ...base, WEBOS_APP_ID: 'Bad App' })).toThrow(/WEBOS_APP_ID/);
	});
});

describe('검사 함수', () => {
	it('호스트', () => {
		expect(isValidHost('192.168.1.20')).toBe(true);
		expect(isValidHost('tv.example.com')).toBe(true);
		expect(isValidHost('tv&calc')).toBe(false);
		expect(isValidHost('')).toBe(false);
	});

	it('앱 ID', () => {
		expect(isValidAppId('com.autoqa.sampletvapp')).toBe(true);
		expect(isValidAppId('com.autoqa.app"x')).toBe(false);
	});

	it('requireAppId', () => {
		expect(() => requireAppId(deviceConfigFromEnv({ WEBOS_HOST: '10.0.0.1' }))).toThrow(/WEBOS_APP_ID/);
	});
});
