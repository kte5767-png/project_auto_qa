import { describe, expect, it } from 'vitest';
import {
	AresCli,
	AresError,
	formatLaunchParams,
	parseDeviceListFull,
	parseKeyValueLines,
	parseRunningApps
} from './ares';
import type { CommandOptions, CommandResult } from './process';

interface Call {
	command: string;
	args: readonly string[];
	options: CommandOptions | undefined;
}

function fakeRunner(result: Partial<CommandResult> = {}) {
	const calls: Call[] = [];
	const runner = (command: string, args: readonly string[], options?: CommandOptions) => {
		calls.push({ command, args, options });
		return Promise.resolve({
			code: 0,
			stdout: '',
			stderr: '',
			notFound: false,
			timedOut: false,
			...result
		});
	};
	return { calls, runner };
}

describe('출력 해석', () => {
	it('system-info의 key: value 줄', () => {
		const text =
			'[Info] Set target device : tv\nmodelName: WEBOS4.0\nsdkVersion: 04.00.00\nfirmwareVersion : 04.00.00\n';
		expect(parseKeyValueLines(text)).toEqual({
			modelName: 'WEBOS4.0',
			sdkVersion: '04.00.00',
			firmwareVersion: '04.00.00'
		});
	});

	it('--listfull JSON', () => {
		const text = `[
  {"profile":"tv","name":"tv","deviceinfo":{"ip":"10.123.45.67","port":"9922","user":"prisoner"},"connection":["ssh"]},
  {"profile":"tv","name":"emulator","deviceinfo":{"ip":"127.0.0.1","port":"6622","user":"developer"}}
]`;
		expect(parseDeviceListFull(text)).toEqual([
			{ name: 'tv', host: '10.123.45.67', port: '9922', user: 'prisoner', profile: 'tv' },
			{ name: 'emulator', host: '127.0.0.1', port: '6622', user: 'developer', profile: 'tv' }
		]);
		expect(parseDeviceListFull('no devices')).toEqual([]);
		expect(parseDeviceListFull('[oops')).toEqual([]);
	});

	it('--running 목록', () => {
		expect(parseRunningApps('com.webos.app.home\ncom.autoqa.sampletvapp - 1234\n\n')).toEqual([
			'com.webos.app.home',
			'com.autoqa.sampletvapp'
		]);
	});

	it('실행 인자는 작은따옴표 JSON, 위험한 문자는 거부', () => {
		expect(formatLaunchParams({ focus: 'class', back: 461 })).toBe("{'focus':'class','back':461}");
		expect(() => formatLaunchParams({ focus: "x'y" })).toThrow();
		expect(() => formatLaunchParams({ 'a b': 'x' })).toThrow();
	});
});

describe('AresCli', () => {
	it('장치 이름을 붙여 명령을 만든다', async () => {
		const { calls, runner } = fakeRunner();
		const ares = new AresCli('tv', runner);
		await ares.addDevice('192.168.0.10', 9922);
		await ares.install('C:\\apps\\sample.ipk');
		await ares.launch('com.autoqa.sampletvapp', { focus: 'class' });
		await ares.close('com.autoqa.sampletvapp');
		expect(calls.map((c) => [c.command, ...c.args])).toEqual([
			[
				'ares-setup-device',
				'--add',
				'tv',
				'-i',
				'host=192.168.0.10',
				'-i',
				'port=9922',
				'-i',
				'username=prisoner'
			],
			['ares-install', '--device', 'tv', 'C:\\apps\\sample.ipk'],
			['ares-launch', '--device', 'tv', 'com.autoqa.sampletvapp', '--params', "{'focus':'class'}"],
			['ares-launch', '--device', 'tv', '--close', 'com.autoqa.sampletvapp']
		]);
	});

	it('passphrase 입력은 사람에게 넘긴다 (interactive)', async () => {
		const { calls, runner } = fakeRunner();
		await new AresCli('tv', runner).getKey();
		expect(calls[0]?.options?.interactive).toBe(true);
	});

	it('실패하면 마지막 출력과 함께 AresError', async () => {
		const { runner } = fakeRunner({ code: 1, stderr: 'ares-launch ERR! [Tips]: Connection refused' });
		await expect(new AresCli('tv', runner).launch('com.a.b')).rejects.toThrow(/Connection refused/);
		await expect(new AresCli('tv', runner).launch('com.a.b')).rejects.toBeInstanceOf(AresError);
	});

	it('ares가 설치되지 않았으면 version()은 null, 다른 명령은 설치 안내', async () => {
		const { runner } = fakeRunner({ code: null, notFound: true });
		const ares = new AresCli('tv', runner);
		expect(await ares.version()).toBeNull();
		await expect(ares.running()).rejects.toThrow(/@webos-tools\/cli/);
	});

	it('잘못된 앱 ID는 명령을 실행하지 않는다', async () => {
		const { calls, runner } = fakeRunner();
		await expect(new AresCli('tv', runner).launch('com.a; del *')).rejects.toThrow(/앱 ID/);
		expect(calls).toHaveLength(0);
	});
});
