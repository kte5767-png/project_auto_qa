import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { LogBuffer, markStopped, pickRunId, runIdAt, sseFrame } from './stream';

/**
 * 로컬 API (Vite 개발 서버 안): TC 실행 스크립트(spikes/p0-8-e2e/tc.ts)를 띄우고, 그 실행이 남긴 파일
 * (progress.json·result.json·단계 캡처·실시간 화면)을 화면에 건넨다. 외부 서비스로 아무것도 보내지 않는다.
 * 검수 중 화면은 /api/stream(SSE)으로 진행·로그·실시간 화면이 바뀌는 즉시 받는다.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const SPIKE = join(ROOT, 'spikes/p0-8-e2e');
const OUT = join(SPIKE, 'out');
const SETTINGS = join(OUT, 'web-settings.json');
const PROGRESS = 'progress.json';
const LIVE_FRAME = 'live.jpg';

/** 실시간 전달 설정 (판정과 무관) */
const STREAM = {
	/** 실행 로그를 기억하는 줄 수 */
	logLines: 400,
	/** 진행 파일·실시간 화면이 바뀌었는지 보는 간격 (화면을 보는 사람이 있을 때만) */
	watchMs: 150,
	/** 실행 폴더 목록을 다시 읽는 간격 (명령줄로 시작한 실행 찾기) */
	listMs: 1000,
	/** 연결이 끊기지 않게 보내는 빈 신호 간격 */
	heartbeatMs: 15_000
};

interface Live {
	child: ChildProcess;
	runId: string;
	startedAt: string;
	log: LogBuffer;
	exitCode: number | null;
	stopped: boolean;
	args: RunRequest;
}

export interface RunRequest {
	tc: string;
	profile: string;
	spec: string;
	url: string;
	headed: boolean;
	overwrite: boolean;
}

let live: Live | null = null;

function send(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify(body));
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch {
		return null;
	}
}

async function body<T>(req: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

/** 실행 폴더 이름만 허용 (경로 밖으로 나가지 않게) */
function runDir(id: string): string | null {
	return /^tc-[\w-]+$/.test(id) ? join(OUT, id) : null;
}

/** 진행 파일을 쓰는 순간에 읽어 깨져 보이면 직전에 읽은 것을 쓴다 (목록에서 실행이 잠깐 사라지지 않게) */
const lastProgress = new Map<string, Record<string, unknown>>();

async function readProgress(id: string): Promise<Record<string, unknown> | null> {
	const path = join(OUT, id, PROGRESS);
	if (!existsSync(path)) return null;
	const p = await readJson<Record<string, unknown>>(path);
	if (p !== null) lastProgress.set(id, p);
	return p ?? lastProgress.get(id) ?? null;
}

async function runInfo(id: string): Promise<unknown> {
	const dir = join(OUT, id);
	const progress = await readProgress(id);
	if (progress !== null) return { id, ...progress };
	const result = await readJson<Record<string, unknown>>(join(dir, 'result.json'));
	if (result === null) return null;
	const created = (await stat(dir)).mtime.toISOString();
	return { id, ...result, startedAt: created, updatedAt: created, finished: true, current: null, planned: null };
}

async function runNames(): Promise<string[]> {
	if (!existsSync(OUT)) return [];
	return (await readdir(OUT)).filter((n) => n.startsWith('tc-'));
}

async function listRuns(): Promise<unknown[]> {
	const names = (await runNames()).sort().reverse();
	const runs = await Promise.all(names.map((n) => runInfo(n)));
	return runs.filter((r) => r !== null);
}

function liveState(): unknown {
	return {
		running: live !== null && live.exitCode === null,
		exitCode: live?.exitCode ?? null,
		startedAt: live?.startedAt ?? null,
		runId: live?.runId ?? null,
		stopped: live?.stopped ?? false
	};
}

// ── 실시간 전달 (SSE) ──────────────────────────────────

const clients = new Set<ServerResponse>();

function broadcast(event: string, data: unknown): void {
	const frame = sseFrame(event, data);
	for (const res of clients) res.write(frame);
}

/** 지금 보는 실행과 그 파일들의 마지막 상태 (바뀐 것만 보낸다) */
const watched: { id: string | null; progress: string | null; frame: string | null } = {
	id: null,
	progress: null,
	frame: null
};
let names: { at: number; list: string[] } = { at: 0, list: [] };
let watchTimer: ReturnType<typeof setInterval> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function currentRunId(): Promise<string | null> {
	const own = live === null ? null : { runId: live.runId, running: live.exitCode === null };
	if (own?.running === true) return own.runId;
	if (Date.now() - names.at > STREAM.listMs) names = { at: Date.now(), list: await runNames() };
	return pickRunId(own, names.list);
}

/** 파일이 바뀌었는지 보는 표 (시각·크기). 없으면 null */
async function fileMark(path: string): Promise<string | null> {
	try {
		const s = await stat(path);
		return `${s.mtimeMs}-${s.size}`;
	} catch {
		return null;
	}
}

async function sendRun(res: ServerResponse | null, id: string): Promise<void> {
	const out = (event: string, data: unknown): void => {
		if (res === null) broadcast(event, data);
		else res.write(sseFrame(event, data));
	};
	const progress = await readProgress(id);
	if (progress !== null) out('progress', { id, ...progress });
	const frame = await fileMark(join(OUT, id, LIVE_FRAME));
	if (frame !== null) out('frame', { id, v: frame });
}

async function tick(): Promise<void> {
	if (ticking) return;
	ticking = true;
	try {
		const id = await currentRunId();
		if (id !== watched.id) {
			watched.id = id;
			watched.progress = null;
			watched.frame = null;
			broadcast('run', { id });
		}
		if (id === null) return;
		const dir = join(OUT, id);
		const p = await fileMark(join(dir, PROGRESS));
		if (p !== null && p !== watched.progress) {
			const progress = await readJson<Record<string, unknown>>(join(dir, PROGRESS));
			if (progress !== null) {
				lastProgress.set(id, progress);
				watched.progress = p;
				broadcast('progress', { id, ...progress });
			}
		}
		const f = await fileMark(join(dir, LIVE_FRAME));
		if (f !== null && f !== watched.frame) {
			watched.frame = f;
			broadcast('frame', { id, v: f });
		}
	} catch {
		// 다음 확인에서 다시
	} finally {
		ticking = false;
	}
}

function watch(): void {
	if (watchTimer !== null) return;
	watchTimer = setInterval(() => void tick(), STREAM.watchMs);
	heartbeat = setInterval(() => {
		for (const res of clients) res.write(': ping\n\n');
	}, STREAM.heartbeatMs);
}

function unwatch(): void {
	if (clients.size > 0) return;
	if (watchTimer !== null) clearInterval(watchTimer);
	if (heartbeat !== null) clearInterval(heartbeat);
	watchTimer = null;
	heartbeat = null;
}

async function openStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
	res.statusCode = 200;
	res.setHeader('content-type', 'text/event-stream; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.setHeader('connection', 'keep-alive');
	res.setHeader('x-accel-buffering', 'no');
	res.flushHeaders();
	res.write('retry: 1000\n\n');
	res.write(sseFrame('live', liveState()));
	res.write(sseFrame('log', { reset: true, lines: live?.log.lines ?? [], seq: live?.log.seq ?? 0 }));
	const id = await currentRunId();
	res.write(sseFrame('run', { id }));
	if (id !== null) await sendRun(res, id);
	clients.add(res);
	watch();
	req.on('close', () => {
		clients.delete(res);
		unwatch();
	});
}

// ── 실행 ──────────────────────────────────────────────

/** 검수 프로세스와 그 아래(브라우저 포함)를 함께 끝낸다. Windows는 셸(cmd) 아래 node가 남으므로 taskkill로 묶어서 */
function killTree(child: ChildProcess): void {
	if (child.pid === undefined || child.exitCode !== null) return;
	if (process.platform === 'win32') {
		spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
		return;
	}
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {
		child.kill('SIGTERM');
	}
}

function startRun(args: RunRequest): Live {
	const runId = runIdAt(new Date());
	const cli = [
		'tsx',
		'tc.ts',
		args.tc,
		'--profile',
		resolve(ROOT, args.profile),
		'--spec',
		resolve(ROOT, args.spec),
		'--run',
		runId
	];
	if (args.url.trim() !== '') cli.push('--url', args.url.trim());
	if (args.headed) cli.push('--headed');
	if (args.overwrite) cli.push('--overwrite');
	// Windows에서 pnpm·npx는 .cmd라 셸로 띄운다. 인자는 따옴표로 감싼다.
	// Windows 밖에서는 프로세스 묶음을 따로 만들어 중지할 때 아래 프로세스까지 끝낸다
	const quoted = cli.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
	const child = spawn('npx', quoted, {
		cwd: SPIKE,
		shell: true,
		env: process.env,
		detached: process.platform !== 'win32'
	});
	const state: Live = {
		child,
		runId,
		startedAt: new Date().toISOString(),
		log: new LogBuffer(STREAM.logLines),
		exitCode: null,
		stopped: false,
		args
	};
	const push = (chunk: Buffer): void => {
		const lines = state.log.push(chunk.toString('utf8'));
		if (lines.length > 0) broadcast('log', { lines, seq: state.log.seq });
	};
	child.stdout?.on('data', push);
	child.stderr?.on('data', push);
	child.on('close', (code) => {
		const rest = state.log.end();
		if (rest.length > 0) broadcast('log', { lines: rest, seq: state.log.seq });
		state.exitCode = code ?? -1;
		void (async () => {
			// 중지·오류로 단계 도중에 끝났으면 진행 파일을 끝난 상태로 (계속 '진행 중'으로 보이지 않게)
			const path = join(OUT, runId, PROGRESS);
			const progress = await readJson<Record<string, unknown>>(path);
			const fixed = progress === null ? null : markStopped(progress, state.exitCode ?? -1);
			if (fixed !== null) await writeFile(path, `${JSON.stringify(fixed)}\n`).catch(() => undefined);
			broadcast('live', liveState());
			await tick();
		})();
	});
	return state;
}

export function autoQaApi(): Plugin {
	return {
		name: 'auto-qa-api',
		configureServer(server) {
			// 개발 서버를 끄면 검수 프로세스도 함께 (Windows 밖에서는 따로 묶어 띄웠으므로)
			process.once('exit', () => {
				if (live !== null && live.exitCode === null) killTree(live.child);
			});
			server.middlewares.use(async (req, res, next) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				if (!url.pathname.startsWith('/api/')) {
					next();
					return;
				}
				try {
					const parts = url.pathname.split('/').filter(Boolean).slice(1);
					if (req.method === 'GET' && parts[0] === 'stream') {
						await openStream(req, res);
						return;
					}
					if (req.method === 'GET' && parts[0] === 'settings') {
						const saved = await readJson<Partial<RunRequest>>(SETTINGS);
						send(res, 200, {
							tc: '',
							profile: 'spikes/p0-8-e2e/profile.local.json',
							spec: 'spikes/p0-8-e2e/spec',
							url: '',
							headed: true,
							overwrite: false,
							...saved
						});
						return;
					}
					if (req.method === 'GET' && parts[0] === 'check') {
						// 경로가 이 PC에 있는지 (파일 내용은 읽지 않음)
						const path = url.searchParams.get('path') ?? '';
						send(res, 200, { exists: path !== '' && existsSync(resolve(ROOT, path)) });
						return;
					}
					if (req.method === 'GET' && parts[0] === 'ping') {
						const target = url.searchParams.get('url') ?? '';
						const started = Date.now();
						try {
							const r = await fetch(target, { signal: AbortSignal.timeout(4000) });
							send(res, 200, { ok: r.ok, status: r.status, ms: Date.now() - started });
						} catch (e) {
							send(res, 200, { ok: false, status: 0, ms: Date.now() - started, error: String(e) });
						}
						return;
					}
					if (req.method === 'GET' && parts[0] === 'live') {
						send(res, 200, { ...(liveState() as object), log: live?.log.lines ?? [] });
						return;
					}
					if (req.method === 'POST' && parts[0] === 'run') {
						if (live !== null && live.exitCode === null) {
							send(res, 409, { error: '이미 실행 중인 검수가 있습니다' });
							return;
						}
						const args = await body<RunRequest>(req);
						if (!existsSync(args.tc)) {
							send(res, 400, { error: `TC 파일이 없습니다: ${args.tc}` });
							return;
						}
						// 처음 실행하는 PC에는 out 폴더가 아직 없다
						await mkdir(OUT, { recursive: true });
						await writeFile(SETTINGS, JSON.stringify(args, null, '\t'));
						live = startRun(args);
						broadcast('live', liveState());
						broadcast('log', { reset: true, lines: [], seq: 0 });
						void tick();
						send(res, 200, { startedAt: live.startedAt, runId: live.runId });
						return;
					}
					if (req.method === 'POST' && parts[0] === 'stop') {
						const running = live !== null && live.exitCode === null;
						if (live !== null && running) {
							live.stopped = true;
							killTree(live.child);
							broadcast('live', liveState());
						}
						send(res, 200, { stopped: running });
						return;
					}
					if (req.method === 'GET' && parts[0] === 'runs' && parts.length === 1) {
						send(res, 200, await listRuns());
						return;
					}
					const dir = runDir(parts[1] ?? '');
					if (parts[0] === 'runs' && dir !== null) {
						if (req.method === 'GET' && parts.length === 2) {
							const info = await runInfo(basename(dir));
							if (info === null) send(res, 404, { error: '없는 실행' });
							else
								send(res, 200, {
									...(info as object),
									decisions: (await readJson(join(dir, 'decisions.json'))) ?? {}
								});
							return;
						}
						if (req.method === 'GET' && parts[2] === 'file' && parts[3] !== undefined) {
							const file = join(dir, basename(decodeURIComponent(parts[3])));
							const type = { '.png': 'image/png', '.jpg': 'image/jpeg' }[extname(file).toLowerCase()];
							if (type === undefined || !existsSync(file)) {
								send(res, 404, { error: '없는 파일' });
								return;
							}
							res.setHeader('content-type', type);
							res.setHeader('cache-control', 'no-store');
							res.end(await readFile(file));
							return;
						}
						if (req.method === 'GET' && parts[2] === 'tc') {
							const info = await readJson<{ tcPath?: string }>(join(dir, PROGRESS));
							const tcPath = info?.tcPath;
							if (tcPath === undefined || !existsSync(tcPath)) {
								send(res, 404, { error: 'TC 파일 위치를 알 수 없습니다' });
								return;
							}
							res.setHeader(
								'content-type',
								'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
							);
							res.setHeader(
								'content-disposition',
								`attachment; filename*=UTF-8''${encodeURIComponent(basename(tcPath))}`
							);
							res.end(await readFile(tcPath));
							return;
						}
						if (req.method === 'POST' && parts[2] === 'decisions') {
							// 확인 필요 항목에 사람이 내린 확정 (리포트용, TC 파일은 바꾸지 않음)
							await writeFile(join(dir, 'decisions.json'), JSON.stringify(await body(req), null, '\t'));
							send(res, 200, { saved: true });
							return;
						}
					}
					send(res, 404, { error: '없는 API' });
				} catch (e) {
					if (!res.headersSent) send(res, 500, { error: String(e) });
					else res.end();
				}
			});
		}
	};
}
