/**
 * P0-8 브라우저 E2E 스파이크: 앱을 리모컨 키로 조작하면서
 * 화면설계서 이동 지도로 계산한 기대 포커스(D-036 ①)와 코드 판정(D-036 ③, D-037)을 한 번에 돌려 본다.
 * 드라이버 인터페이스만 쓰므로 같은 흐름이 실기기 드라이버에서도 돈다 (D-027).
 *
 *   pnpm spike:e2e spikes/p0-8-e2e/scenario.sample.json --url http://localhost:5173
 *   pnpm spike:e2e spikes/p0-8-e2e/scenario.local.json --spec spikes/p0-8-e2e/spec --headed
 *
 * --headed: 창을 띄워 진행을 본다. 1920×1080 화면이 모니터에 다 들어오게 창 배율을 맞추고(--scale),
 *   사람이 따라볼 수 있게 키마다 잠깐 멈춘다(--slow, 기본 800ms). 멈춤은 보기용이며 판정은 안정화 대기 후 관찰로 한다.
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BrowserDriver, fitWindowScale, launchBrowser, probeScreen } from '@auto-qa/browser';
import type { Driver, RemoteKey } from '@auto-qa/core';
import { analyzeExport, parseExport } from '@auto-qa/figma';
import type { NormalizedFrame } from '@auto-qa/figma';
import { observeTargets } from '@auto-qa/focus';
import type { Observation, ObserveTarget, ObservedTarget } from '@auto-qa/focus';
import { VERDICT_LABEL, aggregateStep, checkExactText, checkMaxCount, checkPresence } from '@auto-qa/judge';
import type { Check, CheckKind, CheckResult, StepVerdict, Verdict } from '@auto-qa/judge';
import {
	DEFAULT_KEYMAP_OPTIONS,
	buildKeyMap,
	expectAfterKey,
	expectedItemIndex,
	matchByName,
	navScreenFromSpec
} from '@auto-qa/planner';
import type { KeyAction, KeyMapOptions } from '@auto-qa/planner';
import { extractSpecScreen, mergeSpecScreens } from '@auto-qa/spec';
import type { SpecKey, SpecScreen } from '@auto-qa/spec';
import { DEFAULT_TIMING, SCENARIO_FORMAT, parseCalloutRef, validateScenario } from './scenario';
import type { CheckDef, ElementDef, EntryStep, Scenario, StepDef, Timing } from './scenario';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		url: { type: 'string' },
		spec: { type: 'string', multiple: true, default: [] },
		headed: { type: 'boolean', default: false },
		/** 키마다 멈추는 시간 (ms, 보기용). 기본: --headed면 800, 아니면 0 */
		slow: { type: 'string' },
		/** --headed 창 배율. auto(기본) = 모니터에 1920×1080이 다 보이게 */
		scale: { type: 'string', default: 'auto' },
		out: { type: 'string', default: join(import.meta.dirname, 'out') }
	}
});
const cwd = process.env['INIT_CWD'] ?? process.cwd();

const SPEC_KEY: Partial<Record<RemoteKey, SpecKey>> = {
	UP: 'up',
	DOWN: 'down',
	LEFT: 'left',
	RIGHT: 'right',
	OK: 'ok',
	BACK: 'back'
};
const KEY_LABEL: Record<RemoteKey, string> = {
	UP: '▲',
	DOWN: '▼',
	LEFT: '◀',
	RIGHT: '▶',
	OK: 'OK',
	BACK: 'Back',
	HOME: 'Home'
};

// ── 입력 ────────────────────────────────────────────────

async function jsonFiles(paths: readonly string[]): Promise<string[]> {
	const out: string[] = [];
	for (const p of paths) {
		const full = resolve(cwd, p);
		if ((await stat(full)).isDirectory()) {
			for (const f of (await readdir(full)).sort()) if (f.endsWith('.json')) out.push(join(full, f));
		} else out.push(full);
	}
	return out;
}

/** 화면설계서 내보내기 → 화면 번호별 이동 지도 */
async function loadKeyMaps(paths: readonly string[], options: KeyMapOptions): Promise<Map<string, KeyAction[]>> {
	const specs: SpecScreen[] = [];
	const frames = new Map<string, NormalizedFrame>();
	for (const f of await jsonFiles(paths)) {
		for (const a of analyzeExport(parseExport(JSON.parse(await readFile(f, 'utf8'))))) {
			if (a.kind !== 'spec') continue;
			frames.set(a.frame.id, a.frame);
			specs.push(extractSpecScreen(a.frame));
		}
	}
	const maps = new Map<string, KeyAction[]>();
	for (const merged of mergeSpecScreens(specs)) {
		const screen = navScreenFromSpec(merged, frames);
		if (screen.screenId !== null) maps.set(screen.screenId, buildKeyMap(screen, options));
	}
	return maps;
}

// ── 실행 ────────────────────────────────────────────────

interface Trail {
	key: RemoteKey | null;
	focus: string;
	stable: boolean;
}

class Session {
	private readonly targets: ObserveTarget[];
	/** 요소별 마지막 포커스 항목 (화면설계서 "이동한 이력이 있을 경우") */
	readonly remembered = new Map<string, number>();

	constructor(
		readonly driver: Driver,
		readonly scenario: Scenario,
		readonly timing: Timing,
		/** 키마다 사람이 볼 수 있게 멈추는 시간 (판정과 무관) */
		readonly pauseMs: number
	) {
		this.targets = Object.entries(scenario.elements).map(([name, e]) => ({
			name,
			selector: e.selector,
			textIncludes: e.textIncludes ?? null,
			items: e.items ?? null
		}));
	}

	async observe(): Promise<Observation> {
		const obs = await observeTargets(this.driver, this.targets, {
			focusSelector: this.scenario.focusSelector ?? null
		});
		for (const t of obs.targets) if (t.hasFocus && t.focusItem >= 0) this.remembered.set(t.name, t.focusItem);
		return obs;
	}

	async press(key: RemoteKey): Promise<{ obs: Observation; stable: boolean }> {
		await this.driver.pressKey(key);
		const s = await this.driver.waitForStable();
		const obs = await this.observe();
		if (this.pauseMs > 0) await new Promise((r) => setTimeout(r, this.pauseMs));
		return { obs, stable: s.stable };
	}

	/** 조건이 맞을 때까지 확인 (고정 sleep 대신 조건 대기) */
	async until(test: (o: Observation) => boolean, timeoutMs: number): Promise<Observation | null> {
		const end = Date.now() + timeoutMs;
		for (;;) {
			const obs = await this.observe();
			if (test(obs)) return obs;
			if (Date.now() >= end) return null;
			await new Promise((r) => setTimeout(r, this.timing.pollMs));
		}
	}
}

const target = (obs: Observation, name: string): ObservedTarget | undefined => obs.targets.find((t) => t.name === name);

/** 포커스를 요소 이름으로 (가장 안쪽 = 항목 순번이 있는 것 우선) */
function focusText(obs: Observation): string {
	const inside = obs.targets.filter((t) => t.hasFocus);
	if (inside.length > 0) {
		return inside
			.map((t) => (t.focusItem >= 0 && t.itemCount > 1 ? `${t.name}[${t.focusItem}]` : t.name))
			.join(' > ');
	}
	if (obs.focus === null) return '(포커스 없음)';
	const f = obs.focus;
	return `${f.tag}${f.spotlightId === null ? '' : `#${f.spotlightId}`} "${f.text.slice(0, 30)}"`;
}

function record(trail: Trail[], t: Trail, indent = '  진입 '): void {
	trail.push(t);
	console.log(
		`${indent}${t.key === null ? '(대기)' : KEY_LABEL[t.key]} → ${t.focus}${t.stable ? '' : ' (안정화 시간 초과)'}`
	);
}

async function runEntry(session: Session, entry: readonly EntryStep[], trail: Trail[]): Promise<string | null> {
	for (const step of entry) {
		if ('waitFocus' in step) {
			const obs = await session.until((o) => o.focus !== null, step.timeoutMs ?? session.timing.readyTimeoutMs);
			if (obs === null) return '앱에 포커스가 생기지 않음 (앱이 떴는지, 로딩·팝업 확인)';
			record(trail, { key: null, focus: focusText(obs), stable: true });
		} else if ('waitFor' in step) {
			const obs = await session.until(
				(o) => (target(o, step.waitFor)?.visible ?? 0) > 0,
				step.timeoutMs ?? session.timing.readyTimeoutMs
			);
			if (obs === null) return `"${step.waitFor}"가 보이지 않음`;
			record(trail, { key: null, focus: focusText(obs), stable: true });
		} else {
			const goal = step.until;
			if (goal === undefined) {
				const r = await session.press(step.press);
				record(trail, { key: step.press, focus: focusText(r.obs), stable: r.stable });
				continue;
			}
			const reached = (o: Observation): boolean => target(o, goal)?.hasFocus === true;
			if (reached(await session.observe())) continue;
			const max = step.max ?? 5;
			let done = false;
			for (const [key, times] of [
				[step.press, max],
				...(step.else === undefined ? [] : [[step.else, max * 2] as const])
			] as const) {
				for (let i = 0; i < times && !done; i++) {
					const r = await session.press(key);
					record(trail, { key, focus: focusText(r.obs), stable: r.stable });
					done = reached(r.obs);
				}
				if (done) break;
			}
			if (!done) return `${KEY_LABEL[step.press]}로 "${goal}"에 가지 못함`;
		}
	}
	return null;
}

// ── 판정 ────────────────────────────────────────────────

const result = (
	clause: string,
	kind: CheckKind,
	verdict: Verdict | null,
	explanation: string,
	value: Check['value'] = null
): CheckResult => {
	const check: Check = { kind, method: verdict === null ? 'none' : 'code', value, reason: '시나리오' };
	return {
		clause: { text: clause, section: null, key: null, checks: [check] },
		check,
		verdict,
		explanation,
		oracle: verdict === null ? 'none' : 'code',
		confidence: null
	};
};

interface SpecContext {
	keyMaps: Map<string, KeyAction[]> | null;
	options: KeyMapOptions;
}

/** 키 한 번의 이동을 화면설계서 이동 지도로 확인 */
function checkSpecMove(
	scenario: Scenario,
	spec: SpecContext,
	before: Observation,
	key: RemoteKey,
	after: Observation,
	remembered: ReadonlyMap<string, number>
): CheckResult {
	const label = `[${KEY_LABEL[key]}] 화면설계서 이동`;
	const specKey = SPEC_KEY[key];
	if (specKey === undefined) return result(label, 'key', null, `${KEY_LABEL[key]} 키는 이동 지도에 없음`);
	if (spec.keyMaps === null) return result(label, 'key', null, '화면설계서가 주어지지 않음 (--spec)');

	const elements = Object.entries(scenario.elements);
	const from = elements.find(([name, e]) => e.callout !== undefined && target(before, name)?.hasFocus === true);
	if (from === undefined) {
		return result(label, 'key', null, `누르기 전 포커스(${focusText(before)})가 콜아웃과 대응된 요소에 없음`);
	}
	const [fromName, fromDef] = from;
	const ref = parseCalloutRef(fromDef.callout ?? '');
	const actions = ref === null ? undefined : spec.keyMaps.get(ref.screen);
	if (ref === null || actions === undefined) {
		return result(label, 'key', null, `화면설계서에 ${ref?.screen ?? '?'} 화면이 없음`);
	}
	const prev = target(before, fromName);
	const position =
		prev !== undefined && prev.focusItem >= 0 && prev.itemCount > 1
			? { index: prev.focusItem, count: prev.itemCount }
			: null;
	const exp = expectAfterKey(actions, ref.no, specKey, position);
	const clause = `${ref.screen} ${exp.basis}`;
	if (!exp.ok) return result(clause, 'key', null, exp.reason);

	let want: [string, ElementDef] | undefined;
	if (exp.target.kind === 'same') want = from;
	else if (exp.target.kind === 'callout') {
		const no = exp.target.no;
		want = elements.find(([, e]) => e.callout === `${ref.screen}#${no}`);
		if (want === undefined) return result(clause, 'key', null, `${ref.screen} ${no}번 콜아웃에 대응된 요소가 없음`);
	} else {
		const name = exp.target.kind === 'element' ? exp.target.name : exp.target.to;
		const m = matchByName(name, elements, ([n, e]) => [n, ...(e.names ?? [])], spec.options);
		if (m === null) return result(clause, 'key', null, `"${name}"에 대응된 요소가 없음`);
		want = m.match;
	}
	const [wantName] = want;
	const got = target(after, wantName);
	const index =
		got === undefined || got.itemCount <= 1
			? null
			: expectedItemIndex(exp.item, {
					previous: wantName === fromName ? (prev?.focusItem ?? -1) : -1,
					count: got.itemCount,
					remembered: remembered.get(wantName) ?? null,
					endNoop: exp.endNoop
				});
	const wantText = `${wantName}${index === null ? '' : `[${index}]`}`;
	const ok = got?.hasFocus === true && (index === null || got.focusItem === index);
	const actual = focusText(after);
	if (exp.estimated) {
		return result(
			clause,
			'key',
			'needs-review',
			`키 방향으로 추정한 대상 ${wantText} / 실제 ${actual} — 사람 확인 필요`
		);
	}
	return ok
		? result(clause, 'key', 'pass', `${KEY_LABEL[key]} → ${actual} (화면설계서대로)`, wantName)
		: result(
				clause,
				'key',
				'fail',
				`${KEY_LABEL[key]} 후 포커스가 화면설계서와 다름: 기대 ${wantText} / 실제 ${actual}`
			);
}

function checkStep(
	scenario: Scenario,
	check: CheckDef,
	obs: Observation,
	moves: readonly CheckResult[]
): CheckResult[] {
	if ('unchecked' in check) return [result(check.unchecked, 'data', null, '화면으로 확인하지 않음')];
	if ('focus' in check) {
		if (check.focus === '@spec') return [...moves];
		const t = target(obs, check.focus);
		const want = `${check.focus}${check.item === undefined ? '' : `[${check.item}]`}`;
		const clause = check.clause ?? `포커스: ${want}`;
		const ok = t?.hasFocus === true && (check.item === undefined || t.focusItem === check.item);
		return [
			ok
				? result(clause, 'focus', 'pass', `포커스 ${focusText(obs)}`, want)
				: result(clause, 'focus', 'fail', `포커스가 다름: 기대 ${want} / 실제 ${focusText(obs)}`, want)
		];
	}
	if ('present' in check) {
		const t = target(obs, check.present);
		const clause = check.clause ?? `${check.present} 글자 있음`;
		if (t === undefined || t.visible === 0)
			return [result(clause, 'presence', 'fail', `${check.present}이(가) 보이지 않음`)];
		const r = checkPresence(t.texts, check.present);
		return [result(clause, 'presence', r.verdict, r.explanation)];
	}
	if ('count' in check) {
		const t = target(obs, check.count);
		const clause = check.clause ?? `${check.count} 최대 ${check.max}개`;
		if (t === undefined || t.visible === 0)
			return [result(clause, 'count', 'fail', `${check.count}이(가) 보이지 않음`)];
		const r = checkMaxCount(check.max, t.itemCount, check.count);
		return [result(clause, 'count', r.verdict, r.explanation, check.max)];
	}
	const t = target(obs, check.text);
	const clause = check.clause ?? `${check.text} 문구 "${check.equals}"`;
	const r = checkExactText(check.equals, t?.texts ?? [], check.text);
	return [result(clause, 'exact-text', r.verdict, r.explanation, check.equals)];
}

// ── 리포트 ──────────────────────────────────────────────

interface StepReport {
	step: StepDef;
	trail: Trail[];
	results: CheckResult[];
	verdict: StepVerdict;
	screenshot: string;
	errors: string[];
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

function report(
	scenario: Scenario,
	url: string,
	specFiles: number,
	entryTrail: Trail[],
	entryError: string | null,
	steps: StepReport[]
): string {
	const lines = [`# 브라우저 E2E (P0-8): ${scenario.name}`, ''];
	lines.push(
		`- 앱: ${url}`,
		`- 화면설계서: ${specFiles === 0 ? '없음 (@spec 확인 안 함)' : `${specFiles}개 파일`}`,
		''
	);
	lines.push('## 진입', '');
	for (const t of entryTrail)
		lines.push(
			`- ${t.key === null ? '(대기)' : KEY_LABEL[t.key]} → ${t.focus}${t.stable ? '' : ' (안정화 시간 초과)'}`
		);
	if (entryError !== null) lines.push('', `**진입 실패: ${entryError}**`);
	lines.push('');
	if (steps.length === 0) return `${lines.join('\n')}\n`;

	const count = (v: Verdict): number => steps.filter((s) => s.verdict.verdict === v).length;
	lines.push('## 요약', '');
	lines.push(
		`단계 ${steps.length}개 — Pass ${count('pass')} · Fail ${count('fail')} · 확인 필요 ${count('needs-review')}`
	);
	const all = steps.flatMap((s) => s.results);
	lines.push(
		`조건 ${all.length}개 — 코드 ${all.filter((r) => r.oracle === 'code').length} · 확인 불가 ${all.filter((r) => r.oracle === 'none').length}`,
		''
	);
	lines.push('| 단계 | 키 | 포커스 | 자동 판정 | 판정 설명 | 판정 근거 |', '|---|---|---|---|---|---|');
	for (const s of steps) {
		const last = s.trail[s.trail.length - 1];
		lines.push(
			`| ${s.step.id} ${cell(s.step.title)} | ${s.step.keys.map((k) => KEY_LABEL[k]).join(' ') || '—'} | ${cell(last?.focus ?? '')} | ${VERDICT_LABEL[s.verdict.verdict]} | ${cell(s.verdict.explanation)} | ${s.verdict.basis} |`
		);
	}
	lines.push('');
	for (const s of steps) {
		lines.push(`## ${s.step.id} ${s.step.title} — ${VERDICT_LABEL[s.verdict.verdict]}`, '');
		if (s.step.expected !== undefined) lines.push(`TC 기대 결과: ${s.step.expected}`, '');
		for (const t of s.trail)
			lines.push(
				`- ${t.key === null ? '(시작)' : KEY_LABEL[t.key]} → ${t.focus}${t.stable ? '' : ' (안정화 시간 초과)'}`
			);
		lines.push('', '| 조건 | 방법 | 결과 | 설명 |', '|---|---|---|---|');
		for (const r of s.results) {
			lines.push(
				`| ${cell(r.clause.text)} | ${r.oracle === 'code' ? '코드' : '확인 불가'} | ${r.verdict === null ? '—' : VERDICT_LABEL[r.verdict]} | ${cell(r.explanation)} |`
			);
		}
		for (const e of s.errors) lines.push('', `⚠ ${e}`);
		lines.push('', `![${s.step.id}](${s.screenshot})`, '');
	}
	return `${lines.join('\n')}\n`;
}

// ── main ────────────────────────────────────────────────

async function main(): Promise<void> {
	const file = positionals[0];
	if (file === undefined) throw new Error('시나리오 파일을 주세요: pnpm spike:e2e <scenario.json>');
	const raw = JSON.parse(await readFile(resolve(cwd, file), 'utf8')) as unknown;
	const errors = validateScenario(raw);
	if (errors.length > 0) throw new Error(`시나리오 형식 오류 (${SCENARIO_FORMAT}):\n- ${errors.join('\n- ')}`);
	const scenario = raw as Scenario;
	const timing: Timing = { ...DEFAULT_TIMING, ...scenario.timing };
	const url = values.url ?? scenario.url;

	const options: KeyMapOptions = { ...DEFAULT_KEYMAP_OPTIONS, aliases: scenario.aliases ?? {} };
	const specFiles = await jsonFiles(values.spec);
	const keyMaps = specFiles.length === 0 ? null : await loadKeyMaps(specFiles, options);
	if (keyMaps !== null) console.log(`화면설계서 화면 ${keyMaps.size}개: ${[...keyMaps.keys()].join(', ')}`);

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const out = join(resolve(cwd, values.out), stamp);
	await mkdir(out, { recursive: true });

	let windowScale: number | undefined;
	if (values.headed) {
		if (values.scale === 'auto') {
			const screen = await probeScreen();
			windowScale = fitWindowScale(screen) ?? undefined;
			console.log(
				`창 배율 ${windowScale ?? '그대로'} (모니터 ${screen.availWidth}×${screen.availHeight}, 시스템 배율 ${screen.dpr})`
			);
		} else {
			windowScale = Number(values.scale);
			if (!(windowScale > 0)) throw new Error(`--scale은 양수 또는 auto: ${values.scale}`);
		}
	}
	const pauseMs = values.slow === undefined ? (values.headed ? 800 : 0) : Number(values.slow);
	if (!(pauseMs >= 0)) throw new Error(`--slow는 0 이상의 ms: ${String(values.slow)}`);

	const browser = await launchBrowser({ headless: !values.headed, windowScale });
	const driver = await BrowserDriver.open(browser, url);
	const session = new Session(driver, scenario, timing, pauseMs);
	const entryTrail: Trail[] = [];
	const steps: StepReport[] = [];
	let entryError: string | null;
	try {
		console.log(`앱 열기: ${url}`);
		entryError = await runEntry(session, scenario.entry, entryTrail);
		await writeFile(join(out, 'entry.png'), await driver.screenshot());
		if (entryError !== null) console.log(`진입 실패: ${entryError}`);
		else {
			let obs = await session.observe();
			for (const step of scenario.steps) {
				console.log(`  ${step.id} ${step.title}`);
				const trail: Trail[] = [{ key: null, focus: focusText(obs), stable: true }];
				const moves: CheckResult[] = [];
				const errs: string[] = [...obs.errors];
				for (const key of step.keys) {
					const before = obs;
					const remembered = new Map(session.remembered);
					const r = await session.press(key);
					obs = r.obs;
					const move = checkSpecMove(scenario, { keyMaps, options }, before, key, obs, remembered);
					moves.push(move);
					record(trail, { key, focus: focusText(obs), stable: r.stable }, '    ');
					if (move.verdict !== null && move.verdict !== 'pass') {
						console.log(`      [화면설계서 ${VERDICT_LABEL[move.verdict]}] ${move.explanation}`);
					}
				}
				const results = step.checks.flatMap((c) => checkStep(scenario, c, obs, moves));
				const verdict = aggregateStep(results);
				const shot = `step-${step.id}.png`;
				await writeFile(join(out, shot), await driver.screenshot());
				steps.push({
					step,
					trail,
					results,
					verdict,
					screenshot: shot,
					errors: [...new Set(errs.concat(obs.errors))]
				});
				console.log(`    = ${VERDICT_LABEL[verdict.verdict]} — ${verdict.explanation.split('\n')[0] ?? ''}`);
			}
		}
	} finally {
		await driver.close();
		await browser.close();
	}

	await writeFile(join(out, 'report.md'), report(scenario, url, specFiles.length, entryTrail, entryError, steps));
	await writeFile(
		join(out, 'result.json'),
		`${JSON.stringify({ scenario: scenario.name, url, entryTrail, entryError, steps }, null, '\t')}\n`
	);
	console.log(`\n→ ${join(out, 'report.md')}`);
	if (entryError !== null) process.exitCode = 1;
}

main().catch((e: unknown) => {
	console.error(e instanceof Error ? e.message : e);
	process.exitCode = 1;
});
