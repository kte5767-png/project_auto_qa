import { Socket } from 'node:net';

/** TCP 포트가 열려 있는지 (연결 진단용). 열려 있으면 연결 시간(ms), 아니면 오류 메시지 */
export function probePort(
	host: string,
	port: number,
	timeoutMs = 2000
): Promise<{ open: true; ms: number } | { open: false; error: string }> {
	return new Promise((resolve) => {
		const socket = new Socket();
		const start = Date.now();
		const done = (result: { open: true; ms: number } | { open: false; error: string }): void => {
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => done({ open: true, ms: Date.now() - start }));
		socket.once('timeout', () => done({ open: false, error: '시간 초과' }));
		socket.once('error', (error: NodeJS.ErrnoException) =>
			done({ open: false, error: error.code ?? error.message })
		);
		socket.connect(port, host);
	});
}
