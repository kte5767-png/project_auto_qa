import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * 로컬 API (Vite 개발 서버 안): TC 실행 스크립트(spikes/p0-8-e2e/tc.ts)를 띄우고, 그 실행이 남긴 파일
 * (progress.json·result.json·단계 캡처)을 화면에 건넨다. 외부 서비스로 아무것도 보내지 않는다.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const SPIKE = join(ROOT, 'spikes/p0-8-e2e');
const OUT = join(SPIKE, 'out');
const SETTINGS = join(OUT, 'web-settings.json');
const LOG_LINES = 400;

interface Live {
	child: ChildProcess;
	startedAt: string;
	log: string[];
	exitCode: number | null;
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

async function runInfo(id: string): Promise<unknown> {
	const dir = join(OUT, id);
	const progress = await readJson<Record<string, unknown>>(join(dir, 'progress.json'));
	if (progress !== null) return { id, ...progress };
	const result = await readJson<Record<string, unknown>>(join(dir, 'result.json'));
	if (result === null) return null;
	const created = (await stat(dir)).mtime.toISOString();
	return { id, ...result, startedAt: created, updatedAt: created, finished: true, current: null, planned: null };
}

async function listRuns(): Promise<unknown[]> {
	if (!existsSync(OUT)) return [];
	const names = (await readdir(OUT))
		.filter((n) => n.startsWith('tc-'))
		.sort()
		.reverse();
	const runs = await Promise.all(names.map((n) => runInfo(n)));
	return runs.filter((r) => r !== null);
}

function startRun(args: RunRequest): Live {
	const cli = ['tsx', 'tc.ts', args.tc, '--profile', resolve(ROOT, args.profile), '--spec', resolve(ROOT, args.spec)];
	if (args.url.trim() !== '') cli.push('--url', args.url.trim());
	if (args.headed) cli.push('--headed');
	if (args.overwrite) cli.push('--overwrite');
	// Windows에서 pnpm·npx는 .cmd라 셸로 띄운다. 인자는 따옴표로 감싼다
	const quoted = cli.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
	const child = spawn('npx', quoted, { cwd: SPIKE, shell: true, env: process.env });
	const state: Live = { child, startedAt: new Date().toISOString(), log: [], exitCode: null, args };
	const push = (chunk: Buffer): void => {
		for (const line of chunk.toString('utf8').split(/\r?\n/)) {
			if (line.trim() === '') continue;
			state.log.push(line);
			if (state.log.length > LOG_LINES) state.log.shift();
		}
	};
	child.stdout?.on('data', push);
	child.stderr?.on('data', push);
	child.on('close', (code) => {
		state.exitCode = code ?? -1;
	});
	return state;
}

export function autoQaApi(): Plugin {
	return {
		name: 'auto-qa-api',
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				if (!url.pathname.startsWith('/api/')) {
					next();
					return;
				}
				try {
					const parts = url.pathname.split('/').filter(Boolean).slice(1);
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
						send(res, 200, {
							running: live !== null && live.exitCode === null,
							exitCode: live?.exitCode ?? null,
							startedAt: live?.startedAt ?? null,
							log: live?.log ?? []
						});
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
						await writeFile(SETTINGS, JSON.stringify(args, null, '\t'));
						live = startRun(args);
						send(res, 200, { startedAt: live.startedAt });
						return;
					}
					if (req.method === 'POST' && parts[0] === 'stop') {
						live?.child.kill();
						send(res, 200, { stopped: live !== null });
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
							if (!/\.png$/i.test(file) || !existsSync(file)) {
								send(res, 404, { error: '없는 파일' });
								return;
							}
							res.setHeader('content-type', 'image/png');
							res.setHeader('cache-control', 'no-store');
							res.end(await readFile(file));
							return;
						}
						if (req.method === 'GET' && parts[2] === 'tc') {
							const info = await readJson<{ tcPath?: string }>(join(dir, 'progress.json'));
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
					send(res, 500, { error: String(e) });
				}
			});
		}
	};
}
