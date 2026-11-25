/**
 * defects.json(정답 목록)이 실제 앱 동작과 맞는지 검증한다.
 * 두 포커스 방식(spotlight, class) 각각에서
 *  1) 결함이 없을 때 시작 포커스와 콘솔 에러가 없는지
 *  2) 결함마다 reproKeys를 눌렀을 때 결함 없는 상태와 관찰 결과가 달라지는지
 *  3) focus·flow 결함은 결함이 없을 때 baselineFocus에 포커스가 있는지
 * 를 확인한다.
 *
 * 실행: pnpm sample:verify
 * 로컬 Chrome을 쓰려면 CHROME_PATH 환경 변수를 지정한다.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stableWaitScript } from '@auto-qa/core';
import type { StableResult } from '@auto-qa/core';
import { chromium } from 'playwright-core';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { build, preview } from 'vite';
import type { DefectSpec, DefectsFile, RemoteKey } from '../src/defects.ts';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODES = ['spotlight', 'class'] as const;
type Mode = (typeof MODES)[number];

const KEYS: Record<RemoteKey, { code: number; key: string }> = {
	UP: { code: 38, key: 'ArrowUp' },
	DOWN: { code: 40, key: 'ArrowDown' },
	LEFT: { code: 37, key: 'ArrowLeft' },
	RIGHT: { code: 39, key: 'ArrowRight' },
	OK: { code: 13, key: 'Enter' },
	BACK: { code: 461, key: 'GoBack' }
};

interface Observation {
	screen: string | null;
	focused: string | null;
	target: Record<string, unknown> | null;
}

interface Session {
	page: Page;
	cdp: CDPSession;
	consoleErrors: string[];
}

const failures: string[] = [];
const warnings: string[] = [];

function fail(message: string): void {
	failures.push(message);
	console.log(`  ✗ ${message}`);
}

/** 고정 프레임 수 대신 안정화 대기 (실기기·시뮬레이터와 같은 스크립트, 설계 7.6). 느린 CI에서도 포커스 복원까지 기다린다 */
async function settle(page: Page): Promise<void> {
	const result = await page.evaluate<StableResult>(stableWaitScript());
	if (!result.stable) console.log(`  (안정화 시간 초과 ${result.waitedMs}ms)`);
}

async function open(browser: Browser, baseUrl: string, mode: Mode, defects: string): Promise<Session> {
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
	const consoleErrors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
	});
	page.on('pageerror', (err) => consoleErrors.push(err.message));
	// 창 포커스를 항상 "포커스됨"으로 고정한다. 창 blur/focus 이벤트가 오면 Enact Spotlight가 현재 포커스를 풀거나
	// 다른 요소로 옮겨 시작 상태(thumb-1)가 흔들린다 (CI에서 간헐 불일치의 원인).
	const focusCdp = await page.context().newCDPSession(page);
	await focusCdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
	await page.bringToFront();
	// tsx(esbuild keepNames)가 page.evaluate 함수 소스에 넣는 __name 호출 대비 (검증 도구 전용)
	await page.addInitScript('globalThis.__name = globalThis.__name || function (f) { return f; };');
	await page.goto(`${baseUrl}?focus=${mode}&defects=${defects}`);
	await page.waitForSelector('[data-testid="screen-home"]');
	await settle(page);
	const cdp = await page.context().newCDPSession(page);
	return { page, cdp, consoleErrors };
}

async function press(session: Session, key: RemoteKey): Promise<void> {
	const { code, key: name } = KEYS[key];
	const base = { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: name };
	await session.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
	await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
	await settle(session.page);
}

async function observe(page: Page, mode: Mode, target: string): Promise<Observation> {
	return page.evaluate(
		({ mode, target }) => {
			const screen = document.querySelector('[data-testid^="screen-"]')?.getAttribute('data-testid') ?? null;
			const focusedEl =
				mode === 'spotlight'
					? (document.activeElement?.closest('[data-sample-nav]') ?? null)
					: document.querySelector('.nav-item.focused');
			const focused = focusedEl?.getAttribute('data-testid') ?? null;
			const t = document.querySelector<HTMLElement>(`[data-testid="${target}"]`);
			if (t === null) return { screen, focused, target: null };
			const cs = getComputedStyle(t);
			const after = getComputedStyle(t, '::after');
			const r = t.getBoundingClientRect();
			const round = (v: number): number => Math.round(v * 100) / 100;
			return {
				screen,
				focused,
				target: {
					rect: [round(r.x), round(r.y), round(r.width), round(r.height)],
					fontSize: cs.fontSize,
					color: cs.color,
					background: cs.backgroundColor,
					text: t.textContent,
					placeholder: t.getAttribute('placeholder'),
					navigable: t.hasAttribute('data-sample-nav'),
					afterBorder: `${after.display} ${after.borderTopWidth}`,
					overflowing: t.scrollHeight > t.clientHeight || t.scrollWidth > t.clientWidth
				}
			};
		},
		{ mode, target }
	);
}

interface RunResult {
	observation: Observation;
	/** 키마다 포커스 위치 (불일치 진단용) */
	trace: string;
}

async function run(
	browser: Browser,
	baseUrl: string,
	mode: Mode,
	defect: DefectSpec,
	defects: string
): Promise<RunResult> {
	const session = await open(browser, baseUrl, mode, defects);
	const steps: string[] = [`START→${(await observe(session.page, mode, defect.target)).focused ?? '없음'}`];
	for (const key of defect.reproKeys) {
		await press(session, key);
		steps.push(`${key}→${(await observe(session.page, mode, defect.target)).focused ?? '없음'}`);
	}
	const observation = await observe(session.page, mode, defect.target);
	await session.page.close();
	return { observation, trace: steps.join(' ') };
}

function check(mode: Mode, defect: DefectSpec, baseline: Observation, withDefect: Observation): string[] {
	const problems: string[] = [];
	if (baseline.focused === null) problems.push(`${mode} ${defect.id}: 결함이 없는데 포커스가 없음`);
	if (defect.baselineFocus !== undefined && baseline.focused !== defect.baselineFocus) {
		problems.push(`${mode} ${defect.id}: 결함 없을 때 포커스 ${baseline.focused}, 기대 ${defect.baselineFocus}`);
	}
	if (JSON.stringify(baseline) === JSON.stringify(withDefect)) {
		problems.push(`${mode} ${defect.id}: 결함을 켜도 관찰 결과가 같음 (재현 안 됨)`);
	}
	return problems;
}

async function main(): Promise<void> {
	const file = JSON.parse(await readFile(new URL('../defects.json', import.meta.url), 'utf8')) as DefectsFile;

	await build({ root: APP_ROOT, logLevel: 'warn' });
	const server = await preview({ root: APP_ROOT, logLevel: 'warn', preview: { port: 4174, strictPort: false } });
	const baseUrl = server.resolvedUrls?.local[0];
	if (baseUrl === undefined) throw new Error('preview 서버 주소를 얻지 못했습니다.');

	const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'] || undefined, headless: true });
	try {
		for (const mode of MODES) {
			console.log(`\n[${mode}]`);

			const clean = await open(browser, baseUrl, mode, 'none');
			const start = await observe(clean.page, mode, 'app');
			if (start.focused !== 'thumb-1') fail(`${mode}: 시작 포커스가 thumb-1이 아님 (${start.focused})`);
			if (clean.consoleErrors.length > 0)
				fail(`${mode}: 결함 없음 상태 콘솔 에러 ${clean.consoleErrors.join(' | ')}`);
			await clean.page.close();

			const all = await open(browser, baseUrl, mode, 'all');
			if (all.consoleErrors.length > 0)
				fail(`${mode}: 결함 전체 상태 콘솔 에러 ${all.consoleErrors.join(' | ')}`);
			await all.page.close();

			for (const defect of file.defects) {
				const attempt = async () => {
					const baseline = await run(browser, baseUrl, mode, defect, 'none');
					const withDefect = await run(browser, baseUrl, mode, defect, defect.id);
					return {
						baseline,
						withDefect,
						problems: check(mode, defect, baseline.observation, withDefect.observation)
					};
				};
				const first = await attempt();
				if (first.problems.length === 0) {
					console.log(`  ✓ ${defect.id} ${defect.summary}`);
					continue;
				}
				// 한 번 더 확인한다. 다시 맞으면 정답 목록 문제가 아니라 실행 환경의 타이밍 문제로 보고 경고만 남긴다.
				const second = await attempt();
				const detail = `기준 [${first.baseline.trace}] / 결함 [${first.withDefect.trace}]`;
				if (second.problems.length === 0) {
					const message = `${mode} ${defect.id}: 첫 시도 불일치, 재시도 통과 — ${first.problems.join('; ')} — ${detail}`;
					warnings.push(message);
					console.log(`  ⚠ ${message}`);
					if (process.env['GITHUB_ACTIONS'] === 'true')
						console.log(`::warning title=sample:verify 불안정::${message}`);
				} else {
					for (const problem of second.problems) fail(problem);
					console.log(`    첫 시도: ${detail}`);
					console.log(`    재시도: 기준 [${second.baseline.trace}] / 결함 [${second.withDefect.trace}]`);
				}
			}
		}
	} finally {
		await browser.close();
		server.httpServer.close();
	}

	if (failures.length > 0) {
		console.log(`\n실패 ${failures.length}건`);
		process.exit(1);
	}
	if (warnings.length > 0) console.log(`\n경고 ${warnings.length}건 (재시도 통과, 위 추적 참고)`);
	console.log('\n모든 정답 결함이 두 포커스 방식에서 재현됩니다.');
}

await main();
