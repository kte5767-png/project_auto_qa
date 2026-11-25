import { isValidAppId } from './config';
import { runCommand } from './process';
import type { CommandResult, CommandRunner } from './process';

/**
 * webOS CLI(ares) 래퍼 (D-023). 앱 설치·실행·종료, 장치 정보.
 * ares 설치: `npm install -g @webos-tools/cli`
 */

export class AresError extends Error {
	override name = 'AresError';
	constructor(
		message: string,
		readonly result: CommandResult
	) {
		super(message);
	}
}

export interface AresDeviceEntry {
	name: string;
	host: string | null;
	port: string | null;
	user: string | null;
	profile: string | null;
}

/** `key: value` 형식 줄을 객체로 (ares-device --system-info 출력) */
export function parseKeyValueLines(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*([A-Za-z][\w .-]*?)\s*:\s*(.*?)\s*$/.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined && !match[1].startsWith('[')) {
			result[match[1]] = match[2];
		}
	}
	return result;
}

/** `ares-setup-device --listfull` JSON 출력 해석. 형식이 다르면 빈 목록 */
export function parseDeviceListFull(text: string): AresDeviceEntry[] {
	const start = text.indexOf('[');
	if (start < 0) return [];
	let data: unknown;
	try {
		data = JSON.parse(text.slice(start));
	} catch {
		return [];
	}
	if (!Array.isArray(data)) return [];
	const str = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);
	return data.flatMap((item: unknown) => {
		if (item === null || typeof item !== 'object') return [];
		const entry = item as Record<string, unknown>;
		const name = str(entry['name']);
		if (name === null) return [];
		const info = (entry['deviceinfo'] ?? {}) as Record<string, unknown>;
		return [
			{
				name,
				host: str(info['ip'] ?? info['host']),
				port: str(info['port']),
				user: str(info['user'] ?? info['username']),
				profile: str(entry['profile'])
			}
		];
	});
}

/** `ares-launch --running` 출력에서 앱 ID 목록 */
export function parseRunningApps(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim().split(/\s+/)[0] ?? '')
		.filter((token) => isValidAppId(token) && token.includes('.'));
}

/** ares-launch --params 형식: 작은따옴표 JSON (CLI 문서 예시와 같은 형태) */
export function formatLaunchParams(params: Record<string, string | number | boolean>): string {
	for (const [key, value] of Object.entries(params)) {
		if (!/^[A-Za-z0-9_]+$/.test(key) || /['"\\]/.test(String(value))) {
			throw new Error(`실행 인자에 쓸 수 없는 문자가 있습니다: ${key}`);
		}
	}
	return JSON.stringify(params).replace(/"/g, "'");
}

function summarize(result: CommandResult): string {
	const text = `${result.stderr}\n${result.stdout}`.trim().split(/\r?\n/).slice(-3).join(' / ');
	if (result.notFound) return 'ares CLI를 찾지 못했습니다. `npm install -g @webos-tools/cli`로 설치해 주세요.';
	if (result.timedOut) return '시간 초과';
	return text === '' ? `종료 코드 ${String(result.code)}` : text;
}

export class AresCli {
	constructor(
		readonly device: string,
		private readonly run: CommandRunner = runCommand
	) {}

	private async exec(command: string, args: string[], timeoutMs = 60_000): Promise<CommandResult> {
		const result = await this.run(command, args, { timeoutMs });
		if (result.code !== 0) {
			throw new AresError(`${command} 실패: ${summarize(result)}`, result);
		}
		return result;
	}

	/** 설치 여부 확인. 설치되지 않았으면 null */
	async version(): Promise<string | null> {
		const result = await this.run('ares-setup-device', ['--version'], { timeoutMs: 20_000 });
		if (result.notFound || result.code !== 0) return null;
		return result.stdout.trim().split(/\r?\n/)[0] ?? '';
	}

	async listDevices(): Promise<AresDeviceEntry[]> {
		const result = await this.exec('ares-setup-device', ['--listfull'], 20_000);
		return parseDeviceListFull(result.stdout);
	}

	/** 장치 등록 (사용자 prisoner, SSH 포트 9922) */
	async addDevice(host: string, sshPort: number): Promise<void> {
		await this.exec('ares-setup-device', [
			'--add',
			this.device,
			'-i',
			`host=${host}`,
			'-i',
			`port=${sshPort}`,
			'-i',
			'username=prisoner'
		]);
	}

	/** 개발자 모드 키 받기. TV 화면의 passphrase를 사람이 직접 입력한다 (저장하지 않음) */
	async getKey(): Promise<boolean> {
		const result = await this.run('ares-novacom', ['--device', this.device, '--getkey'], {
			interactive: true,
			timeoutMs: 180_000
		});
		return result.code === 0;
	}

	async systemInfo(): Promise<Record<string, string>> {
		const result = await this.exec('ares-device', ['--device', this.device, '--system-info'], 30_000);
		return parseKeyValueLines(result.stdout);
	}

	async install(ipkPath: string): Promise<void> {
		await this.exec('ares-install', ['--device', this.device, ipkPath], 300_000);
	}

	async launch(appId: string, params?: Record<string, string | number | boolean>): Promise<void> {
		if (!isValidAppId(appId)) throw new Error(`앱 ID 형식이 올바르지 않습니다: ${appId}`);
		const args = ['--device', this.device, appId];
		if (params !== undefined) args.push('--params', formatLaunchParams(params));
		await this.exec('ares-launch', args, 60_000);
	}

	async close(appId: string): Promise<void> {
		if (!isValidAppId(appId)) throw new Error(`앱 ID 형식이 올바르지 않습니다: ${appId}`);
		await this.exec('ares-launch', ['--device', this.device, '--close', appId], 60_000);
	}

	async running(): Promise<string[]> {
		const result = await this.exec('ares-launch', ['--device', this.device, '--running'], 30_000);
		return parseRunningApps(result.stdout);
	}

	/** TV에서 명령 실행 (개발자 모드 제한 셸). 고정 명령만 넘긴다 */
	async runOnDevice(command: string): Promise<string> {
		const result = await this.exec('ares-novacom', ['--device', this.device, '--run', command], 30_000);
		return result.stdout;
	}

	/** 앱 폴더 → ipk */
	async packageApp(appDir: string, outDir: string): Promise<string> {
		const result = await this.exec('ares-package', [appDir, '-o', outDir], 300_000);
		const match = /([^\s"']+\.ipk)/.exec(result.stdout);
		return match?.[1] ?? outDir;
	}
}
