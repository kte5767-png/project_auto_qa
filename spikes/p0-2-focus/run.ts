/**
 * P0-2 포커스 판별 + 프로필 탐지 스파이크.
 *
 * 샘플 앱 (정답 있음):
 *   pnpm spike:focus
 * 실제 앱 (정답 없음 → 어댑터 간 일치율 + 스크린샷 리포트로 사람이 확인):
 *   pnpm spike:focus --url http://localhost:8091
 *
 * 옵션: --keys "RIGHT*4 DOWN*3 …"  --modes spotlight,class  --out <폴더>  --headed
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WEBOS_KEY_MAP, launchBrowser, parseKeySequence, pressRemoteKey, waitForStable } from '@auto-qa/browser';
import type { RemoteKey } from '@auto-qa/browser';
import {
	StyleDiffTracker,
	collectFocusState,
	detectFocusAdapters,
	isAncestor,
	isSelfOrAncestor,
	readActiveElement,
	readEnactSpotlight,
	readSelector
} from '@auto-qa/focus';
import type { FocusAdapterId, FocusCandidate, FocusReading, FocusState } from '@auto-qa/focus';
import type { Browser, Page } from 'playwright-core';
import { build, preview } from 'vite';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE_APP_ROOT = resolve(HERE, '../../fixtures/sample-tv-app');
const DEFAULT_KEYS = 'RIGHT*4 DOWN*3 LEFT*2 DOWN*2 RIGHT*3 UP*3 LEFT*3';
const DETECT_KEYS: RemoteKey[] = ['DOWN', 'RIGHT', 'RIGHT', 'LEFT', 'UP'];
const ADAPTERS: FocusAdapterId[] = ['enact-spotlight', 'active-element', 'selector', 'style-diff'];
const VIEWPORT = { width: 1920, height: 1080 };

interface Target {
	name: string;
	url: string;
	/** 샘플 앱이면 정답(data-sample-nav)으로 채점한다 */
	hasTruth: boolean;
	expectedAdapter?: FocusAdapterId;
	expectedSelector?: string;
}

interface Truth {
	path: string | null;
	navPaths: string[];
}

interface StepRecord {
	index: number;
	key: RemoteKey | 'START';
	stable: boolean;
	waitedMs: number;
	readings: FocusReading[];
	truth: Truth | null;
	screenshot: string | null;
}

interface TargetResult {
	target: Target;
	candidates: FocusCandidate[];
	selector: string | null;
	steps: StepRecord[];
	accuracy: Partial<Record<FocusAdapterId, { hits: number; total: number }>>;
	agreement: Partial<Record<FocusAdapterId, number>>;
}

/** 샘플 앱 정답: 실제 포커스(spotlight) 또는 focused 클래스(class)가 붙은 포커스 가능 요소. 채점에만 쓴다 (D-018) */
async function readTruth(page: Page): Promise<Truth> {
	await page.evaluate('globalThis.__name ??= (fn) => fn');
	return page.evaluate(() => {
		const pathOf = (el: Element): string => {
			const parts: string[] = [];
			let node: Element | null = el;
			while (node !== null && node !== document.body && node.parentElement !== null) {
				let index = 1;
				let sibling = node.previousElementSibling;
				while (sibling !== null) {
					if (sibling.tagName === node.tagName) index++;
					sibling = sibling.previousElementSibling;
				}
				parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
				node = node.parentElement;
			}
			return parts.length === 0 ? 'body' : `body>${parts.join('>')}`;
		};
		const mode = document.querySelector('[data-focus-mode]')?.getAttribute('data-focus-mode');
		const el =
			mode === 'class'
				? document.querySelector('.nav-item.focused')
				: (document.activeElement?.closest('[data-sample-nav]') ?? null);
		return {
			path: el === null ? null : pathOf(el),
			navPaths: Array.from(document.querySelectorAll('[data-sample-nav]')).map(pathOf)
		};
	});
}

/** 어댑터 결과가 정답과 맞는지: 같은 요소, 정답 안쪽 요소, 또는 정답 하나만 감싼 바깥 요소면 맞음 */
function judge(path: string | null, truth: Truth): boolean {
	if (truth.path === null) return path === null;
	if (path === null) return false;
	if (path === truth.path || isAncestor(truth.path, path)) return true;
	if (isAncestor(path, truth.path)) {
		return truth.navPaths.filter((p) => isSelfOrAncestor(path, p)).length === 1;
	}
	return false;
}

function related(a: string | null, b: string | null): boolean {
	if (a === null || b === null) return a === b;
	return a === b || isAncestor(a, b) || isAncestor(b, a);
}

async function settle(page: Page): Promise<{ stable: boolean; waitedMs: number }> {
	return waitForStable(page);
}

async function runTarget(browser: Browser, target: Target, keys: RemoteKey[], outDir: string): Promise<TargetResult> {
	const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
	const cdp = await page.context().newCDPSession(page);
	const press = (key: RemoteKey) => pressRemoteKey(cdp, WEBOS_KEY_MAP[key]);

	// 1) 포커스 방식 자동 탐지
	await page.goto(target.url);
	await settle(page);
	const detectStates: FocusState[] = [await collectFocusState(page)];
	for (const key of DETECT_KEYS) {
		await press(key);
		await settle(page);
		detectStates.push(await collectFocusState(page));
	}
	const candidates = detectFocusAdapters(detectStates);
	const selector = candidates.find((c) => c.adapter === 'selector')?.selector ?? null;

	// 2) 키 20회 입력하며 어댑터별 판단 기록
	await page.goto(target.url);
	const first = await settle(page);
	const tracker = new StyleDiffTracker();
	const steps: StepRecord[] = [];
	const shotDir = join(outDir, target.name);
	await mkdir(shotDir, { recursive: true });

	const record = async (index: number, key: RemoteKey | 'START', st: { stable: boolean; waitedMs: number }) => {
		const state = await collectFocusState(page, { selector });
		const readings = [
			readEnactSpotlight(state),
			readActiveElement(state),
			...(selector === null ? [] : [readSelector(state)]),
			tracker.update(state)
		];
		const truth = target.hasTruth ? await readTruth(page) : null;
		const file = `step-${String(index).padStart(2, '0')}.jpg`;
		await page.screenshot({ path: join(shotDir, file), type: 'jpeg', quality: 60 });
		steps.push({
			index,
			key,
			stable: st.stable,
			waitedMs: st.waitedMs,
			readings,
			truth,
			screenshot: `${target.name}/${file}`
		});
	};

	await record(0, 'START', first);
	for (const [i, key] of keys.entries()) {
		await press(key);
		await record(i + 1, key, await settle(page));
	}
	await page.close();

	// 3) 채점 (키 입력 이후 단계만. style-diff는 시작 상태를 판단할 수 없으므로)
	const scored = steps.slice(1);
	const accuracy: TargetResult['accuracy'] = {};
	const agreement: TargetResult['agreement'] = {};
	const top = candidates[0]?.adapter;
	for (const adapter of ADAPTERS) {
		const readingsOf = scored.map((s) => s.readings.find((r) => r.adapter === adapter));
		if (readingsOf.some((r) => r === undefined)) continue;
		if (target.hasTruth) {
			const hits = scored.filter(
				(s, i) => s.truth !== null && judge(readingsOf[i]?.path ?? null, s.truth)
			).length;
			accuracy[adapter] = { hits, total: scored.length };
		}
		if (top !== undefined && adapter !== top) {
			const agree = scored.filter((s) =>
				related(
					s.readings.find((r) => r.adapter === adapter)?.path ?? null,
					s.readings.find((r) => r.adapter === top)?.path ?? null
				)
			).length;
			agreement[adapter] = agree / scored.length;
		}
	}
	return { target, candidates, selector, steps, accuracy, agreement };
}

const COLORS: Record<FocusAdapterId, string> = {
	'enact-spotlight': '#00c853',
	'active-element': '#2979ff',
	selector: '#ff9100',
	'style-diff': '#d500f9'
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

function renderReport(results: TargetResult[]): string {
	const sections = results.map((r) => {
		const summary = ADAPTERS.map((a) => {
			const acc = r.accuracy[a];
			const agr = r.agreement[a];
			if (acc === undefined && agr === undefined && !r.steps[0]?.readings.some((x) => x.adapter === a)) return '';
			const accText =
				acc === undefined ? '-' : `${acc.hits}/${acc.total} (${Math.round((acc.hits / acc.total) * 100)}%)`;
			const agrText = agr === undefined ? '-' : `${Math.round(agr * 100)}%`;
			return `<tr><td><span class="sw" style="background:${COLORS[a]}"></span>${a}</td><td>${accText}</td><td>${agrText}</td></tr>`;
		}).join('');
		const cands = r.candidates
			.map(
				(c) =>
					`<li><b>${c.adapter}${c.selector === undefined ? '' : ` ${escapeHtml(c.selector)}`}</b> ${Math.round(c.confidence * 100)}% — ${escapeHtml(c.evidence)}</li>`
			)
			.join('');
		const steps = r.steps
			.map((s) => {
				const boxes = s.readings
					.filter((x) => x.element !== null)
					.map((x) => {
						const [left, top, width, height] = x.element?.rect ?? [0, 0, 0, 0];
						return `<div class="box" title="${x.adapter}" style="left:${left / 2}px;top:${top / 2}px;width:${width / 2}px;height:${height / 2}px;border-color:${COLORS[x.adapter]}"></div>`;
					})
					.join('');
				const lines = s.readings
					.map((x) => {
						const ok = s.truth === null ? '' : judge(x.path, s.truth) ? ' ✓' : ' ✗';
						const label =
							x.element === null
								? '없음'
								: escapeHtml(x.element.spotlightId ?? x.element.text ?? x.element.tag);
						return `<div style="color:${COLORS[x.adapter]}">${x.adapter}: ${label}${ok}</div>`;
					})
					.join('');
				return `<div class="step"><div class="shot"><img src="${s.screenshot ?? ''}" width="960" height="540">${boxes}</div><div class="meta"><b>#${s.index} ${s.key}</b> ${s.stable ? '' : '(안정화 시간 초과) '}${s.waitedMs}ms${lines}</div></div>`;
			})
			.join('');
		return `<h2>${escapeHtml(r.target.name)} <small>${escapeHtml(r.target.url)}</small></h2>
<h3>자동 탐지 후보</h3><ol>${cands}</ol>
<h3>어댑터별 결과</h3><table><tr><th>어댑터</th><th>정확도(정답 대비)</th><th>1순위 후보와 일치율</th></tr>${summary}</table>
${steps}`;
	});
	return `<!doctype html><meta charset="utf-8"><title>P0-2 포커스 판별 스파이크</title>
<style>body{font-family:sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}.sw{display:inline-block;width:12px;height:12px;margin-right:6px}.step{display:flex;gap:16px;margin:12px 0}.shot{position:relative;width:960px;height:540px;flex:none}.box{position:absolute;border:3px solid;box-sizing:border-box}.meta{font-size:13px}</style>
<h1>P0-2 포커스 판별 스파이크</h1><p>상자 색: ${ADAPTERS.map((a) => `<span class="sw" style="background:${COLORS[a]}"></span>${a}`).join(' ')}</p>${sections.join('<hr>')}`;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			url: { type: 'string' },
			keys: { type: 'string', default: DEFAULT_KEYS },
			modes: { type: 'string', default: 'spotlight,class' },
			out: { type: 'string', default: join(HERE, 'out') },
			headed: { type: 'boolean', default: false }
		}
	});
	const keys = parseKeySequence(values.keys);
	const outDir = resolve(values.out);
	await mkdir(outDir, { recursive: true });

	const targets: Target[] = [];
	let closeServer: (() => void) | null = null;
	if (values.url !== undefined) {
		targets.push({ name: 'external', url: values.url, hasTruth: false });
	} else {
		await build({ root: SAMPLE_APP_ROOT, logLevel: 'warn' });
		const server = await preview({
			root: SAMPLE_APP_ROOT,
			logLevel: 'warn',
			preview: { port: 4180, strictPort: false }
		});
		const base = server.resolvedUrls?.local[0];
		if (base === undefined) throw new Error('샘플 앱 서버 주소를 얻지 못했습니다.');
		closeServer = () => server.httpServer.close();
		for (const mode of values.modes.split(',')) {
			targets.push({
				name: `sample-${mode}`,
				url: `${base}?focus=${mode}&defects=none`,
				hasTruth: true,
				expectedAdapter: mode === 'class' ? 'selector' : 'enact-spotlight',
				...(mode === 'class' ? { expectedSelector: '.focused' } : {})
			});
		}
	}

	const browser = await launchBrowser({ headless: !values.headed });
	const results: TargetResult[] = [];
	try {
		for (const target of targets) {
			console.log(`\n[${target.name}] ${target.url}`);
			const result = await runTarget(browser, target, keys, outDir);
			results.push(result);
			const top = result.candidates[0];
			console.log(
				`  탐지 1순위: ${top === undefined ? '없음' : `${top.adapter}${top.selector === undefined ? '' : ` ${top.selector}`} (${Math.round(top.confidence * 100)}%)`}`
			);
			if (target.expectedAdapter !== undefined) {
				const ok =
					top?.adapter === target.expectedAdapter &&
					(target.expectedSelector === undefined || top.selector === target.expectedSelector);
				console.log(
					`  탐지 정답(${target.expectedAdapter}${target.expectedSelector === undefined ? '' : ` ${target.expectedSelector}`}): ${ok ? '맞음' : '틀림'}`
				);
			}
			for (const [adapter, acc] of Object.entries(result.accuracy)) {
				console.log(
					`  ${adapter.padEnd(16)} 정확도 ${acc.hits}/${acc.total} (${Math.round((acc.hits / acc.total) * 100)}%)`
				);
			}
			for (const [adapter, agr] of Object.entries(result.agreement)) {
				console.log(`  ${adapter.padEnd(16)} 1순위와 일치 ${Math.round(agr * 100)}%`);
			}
			const unstable = result.steps.filter((s) => !s.stable).length;
			if (unstable > 0) console.log(`  안정화 시간 초과 ${unstable}회`);
		}
	} finally {
		await browser.close();
		closeServer?.();
	}

	await writeFile(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
	await writeFile(join(outDir, 'report.html'), renderReport(results));
	console.log(`\n리포트: ${join(outDir, 'report.html')}`);
}

await main();
