import spawn from 'cross-spawn';

export interface CommandResult {
	/** 종료 코드. 시간 초과·실행 실패면 null */
	code: number | null;
	stdout: string;
	stderr: string;
	/** 실행 파일을 찾지 못함 (ENOENT) */
	notFound: boolean;
	timedOut: boolean;
}

export interface CommandOptions {
	timeoutMs?: number;
	/** 사람 입력이 필요한 명령(예: passphrase)은 터미널 입출력을 그대로 연결한다 */
	interactive?: boolean;
}

export type CommandRunner = (
	command: string,
	args: readonly string[],
	options?: CommandOptions
) => Promise<CommandResult>;

/**
 * 외부 명령 실행. Windows의 `.cmd` 실행 파일(ares-*.cmd)도 찾고, 인자를 셸 해석 없이 넘긴다 (cross-spawn).
 * 인자에는 검사한 값(IP, 앱 ID, 경로)만 넣는다.
 */
export const runCommand: CommandRunner = (command, args, options = {}) =>
	new Promise((resolve) => {
		const timeoutMs = options.timeoutMs ?? 60_000;
		const child = spawn(command, [...args], {
			stdio: options.interactive === true ? 'inherit' : ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		});
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let settled = false;
		child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		const done = (result: CommandResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		child.on('error', (error: NodeJS.ErrnoException) => {
			done({ code: null, stdout, stderr: stderr || error.message, notFound: error.code === 'ENOENT', timedOut });
		});
		child.on('close', (code) => {
			done({ code: timedOut ? null : code, stdout, stderr, notFound: false, timedOut });
		});
	});
