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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BrowserDriver, launchBrowser } from '@auto-qa/browser';
import type { Observation } from '@auto-qa/focus';
import { VERDICT_LABEL, aggregateStep, checkExactText, checkMaxCount, checkPresence } from '@auto-qa/judge';
import type { CheckResult, StepVerdict, Verdict } from '@auto-qa/judge';
import { DEFAULT_KEYMAP_OPTIONS } from '@auto-qa/planner';
import type { KeyMapOptions } from '@auto-qa/planner';
import {
	KEY_LABEL,
	Session,
	checkSpecMove,
	focusText,
	jsonFiles,
	loadKeyMaps,
	record,
	result,
	runEntry,
	target,
	viewOptions
} from './common';
import type { Trail } from './common';
import { DEFAULT_TIMING, SCENARIO_FORMAT, validateScenario } from './scenario';
import type { CheckDef, Scenario, StepDef, Timing } from './scenario';

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
	const specFiles = await jsonFiles(values.spec, cwd);
	const keyMaps = specFiles.length === 0 ? null : await loadKeyMaps(specFiles, options);
	if (keyMaps !== null) console.log(`화면설계서 화면 ${keyMaps.size}개: ${[...keyMaps.keys()].join(', ')}`);

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const out = join(resolve(cwd, values.out), stamp);
	await mkdir(out, { recursive: true });

	const { windowScale, pauseMs } = await viewOptions(values.headed, values.scale, values.slow);
	const browser = await launchBrowser({ headless: !values.headed, windowScale });
	const driver = await BrowserDriver.open(browser, url);
	const session = new Session(driver, scenario.elements, scenario.focusSelector ?? null, timing, pauseMs);
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
					const move = checkSpecMove(scenario.elements, { keyMaps, options }, before, key, obs, remembered);
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
