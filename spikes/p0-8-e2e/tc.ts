/**
 * P0-8 TC 실행 스파이크: TC 엑셀의 자동 대상 단계를 앱에서 리모컨 키로 실행하고,
 * 기대 결과를 조건으로 나눠(D-037) 코드로 판정한 뒤, 사본 엑셀 맨 뒤 열에 기록한다(D-034).
 * 사람이 그 사본의 원래 P/F 열에 결과를 적어 주면(--score) 자동 판정과의 일치율을 잰다.
 *
 *   pnpm spike:tc-run <TC.xlsx> --profile spikes/p0-8-e2e/profile.local.json --spec spikes/p0-8-e2e/spec
 *   pnpm spike:tc-run --score out/<시각>/result.json --truth <사람이 P/F 적은 사본.xlsx>
 *
 * 한 단계 = 화면설계서 콜아웃 하나의 사양(표시 내용·개수·키 동작·선택 시).
 *   1. 앱을 새로 열고 그 화면까지 간다 (앱 프로필의 진입 경로)
 *   2. 표시 조건(있는지만·개수·정해진 문구·말줄임)은 그 화면에서 콜아웃 요소를 읽어 판정한다
 *   3. 키 동작은 목표 콜아웃 첫 항목으로 간 뒤(경로는 이동 지도로 계산) 키 하나를 누르고 화면설계서와 비교한다
 *   4. 선택 시 화면 전환·선택 불가는 OK를 누르고 화면이 바뀌었는지 본다
 *   상태가 바뀐 뒤에는 앱을 다시 열어 같은 조건에서 시작한다 (재현성, D-005).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BrowserDriver, launchBrowser } from '@auto-qa/browser';
import type { RemoteKey } from '@auto-qa/core';
import type { Observation } from '@auto-qa/focus';
import {
	VERDICT_LABEL,
	aggregateStep,
	checkExactText,
	checkMaxCount,
	checkPresence,
	splitClauses
} from '@auto-qa/judge';
import type { Check, CheckResult, Clause, StepVerdict, Verdict } from '@auto-qa/judge';
import { DEFAULT_KEYMAP_OPTIONS, DEFAULT_ROUTE_OPTIONS, planRoute } from '@auto-qa/planner';
import type { KeyAction, KeyMapOptions } from '@auto-qa/planner';
import { endColumnWrites, endColumns, normalize, readWorkbook, suggestProfile, writeResultCopy } from '@auto-qa/tc';
import type { ResultWrite, StepValues, TcCase, TcStep } from '@auto-qa/tc';
import {
	KEY_LABEL,
	Session,
	checkSpecMove,
	focusText,
	jsonFiles,
	loadKeyMaps,
	record,
	runEntry,
	target,
	viewOptions
} from './common';
import type { Trail } from './common';
import { PROFILE_FORMAT, buildRegistry, calloutMark, entryPath, validateProfile } from './profile';
import type { AppProfile, ElementRegistry } from './profile';
import { DEFAULT_TIMING } from './scenario';
import type { Timing } from './scenario';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		profile: { type: 'string' },
		spec: { type: 'string', multiple: true, default: [] },
		/** 화면설계서 번호 앞부분 (기본 4 = 4.x) */
		screen: { type: 'string', default: '4' },
		/** 이 단계만 (예: Search!9,Search!10) */
		only: { type: 'string' },
		url: { type: 'string' },
		headed: { type: 'boolean', default: false },
		slow: { type: 'string' },
		scale: { type: 'string', default: 'auto' },
		out: { type: 'string', default: join(import.meta.dirname, 'out') },
		/** 실행 없이 지난 결과(result.json)를 사람 판정과 비교 */
		score: { type: 'string' },
		/** 사람이 원래 P/F 열에 결과를 적은 엑셀 */
		truth: { type: 'string' }
	}
});
const cwd = process.env['INIT_CWD'] ?? process.cwd();

// ── 결과 모양 ───────────────────────────────────────────

type StepStatus = Verdict | 'not-run';
const STATUS_LABEL: Record<StepStatus, string> = { ...VERDICT_LABEL, 'not-run': '미실행' };

interface StepRun {
	key: string;
	sheet: string;
	row: number;
	tcId: string | null;
	title: string | null;
	screen: string;
	callout: string | null;
	status: StepStatus;
	explanation: string;
	basis: string;
	results: { clause: string; kind: string; oracle: string; verdict: Verdict | null; explanation: string }[];
	trail: Trail[];
	screenshot: string | null;
	ms: number;
}

const RESULT_FORMAT = 'auto-qa/tc-run-result';

// ── 판정 조각 ───────────────────────────────────────────

function res(clause: Clause, check: Check, verdict: Verdict | null, explanation: string): CheckResult {
	const oracle = check.method === 'ai' ? 'ai' : verdict === null ? 'none' : 'code';
	return { clause, check, verdict, explanation, oracle, confidence: null };
}

const KEY_OF: Record<string, RemoteKey> = {
	up: 'UP',
	down: 'DOWN',
	left: 'LEFT',
	right: 'RIGHT',
	ok: 'OK',
	back: 'BACK'
};

// ── 한 단계 실행 ────────────────────────────────────────

interface Ctx {
	browser: Awaited<ReturnType<typeof launchBrowser>>;
	profile: AppProfile;
	registry: ElementRegistry;
	timing: Timing;
	pauseMs: number;
	url: string;
	keyMaps: Map<string, KeyAction[]> | null;
	options: KeyMapOptions;
}

interface Live {
	session: Session;
	close(): Promise<void>;
}

/** 앱을 새로 열고 그 화면까지 간다 */
async function enter(ctx: Ctx, screen: string, trail: Trail[]): Promise<{ live: Live; error: string | null }> {
	const driver = await BrowserDriver.open(ctx.browser, ctx.url);
	const session = new Session(
		driver,
		ctx.registry.forScreen(screen),
		ctx.profile.focusSelector ?? null,
		ctx.timing,
		ctx.pauseMs
	);
	const live: Live = { session, close: () => driver.close() };
	const error = await runEntry(session, entryPath(ctx.profile, ctx.registry, screen), trail);
	if (error !== null) return { live, error };
	const shown = await session.until(
		(o) => (target(o, ctx.registry.detect(screen))?.visible ?? 0) > 0,
		ctx.timing.readyTimeoutMs
	);
	return { live, error: shown === null ? `${screen} 화면 표시(detect)가 보이지 않음` : null };
}

const OPPOSITE: Record<string, RemoteKey> = { up: 'DOWN', down: 'UP', left: 'RIGHT', right: 'LEFT' };

/** 목록 콜아웃 안에서 이전 항목으로 가는 키 (화면설계서의 "이전 항목", 없으면 "다음 항목" 키의 반대) */
function listPrevKey(actions: readonly KeyAction[], no: string): RemoteKey | null {
	const own = actions.filter((a) => a.from === no && a.effect.kind === 'step');
	const prev = own.find((a) => a.effect.kind === 'step' && a.effect.delta < 0);
	if (prev !== undefined) return KEY_OF[prev.key] ?? null;
	const next = own.find((a) => a.effect.kind === 'step' && a.effect.delta > 0);
	return next === undefined ? null : (OPPOSITE[next.key] ?? null);
}

/** 목표 콜아웃의 첫 항목으로 간다 (이동 지도로 경로 계산). 실패하면 이유 */
async function goTo(ctx: Ctx, live: Live, screen: string, no: string, trail: Trail[]): Promise<string | null> {
	const name = ctx.registry.callout(screen, no) ?? '';
	const at = (o: Observation): boolean => {
		const t = target(o, name);
		return t?.hasFocus === true && (t.itemCount <= 1 || t.focusItem === 0);
	};
	let obs = await live.session.observe();
	if (at(obs)) return null;
	const actions = ctx.keyMaps?.get(screen);
	if (actions === undefined)
		return `화면설계서에 ${screen} 이동 지도가 없어 ${calloutMark(no)}까지 갈 길을 정할 수 없음`;
	const from = Object.entries(ctx.profile.screens[screen]?.callouts ?? {}).find(([n]) => {
		const t = target(obs, ctx.registry.callout(screen, n) ?? '');
		return t?.hasFocus === true;
	});
	if (from === undefined) return `출발 포커스(${focusText(obs)})가 ${screen} 콜아웃 밖이라 길을 정할 수 없음`;
	const fromObs = target(obs, ctx.registry.callout(screen, from[0]) ?? '');
	const route = planRoute(
		actions,
		{ callout: from[0], position: Math.max(1, (fromObs?.focusItem ?? 0) + 1) },
		{ callout: no, position: 1 },
		[],
		{ ...DEFAULT_ROUTE_OPTIONS, allowEstimated: false }
	);
	if (!route.ok) return `${calloutMark(from[0])} → ${calloutMark(no)} 길 없음: ${route.reason}`;
	for (const key of route.keys) {
		const r = await live.session.press(key);
		obs = r.obs;
		record(trail, { key, focus: focusText(obs), stable: r.stable }, '      길 ');
	}
	// 목록에 들어왔지만 첫 항목이 아니면(이력·가까운 항목으로 들어감) 목록 안 "이전" 키로 첫 항목까지
	const inList = target(obs, name);
	const prevKey = listPrevKey(actions, no);
	if (inList?.hasFocus === true && inList.focusItem > 0 && prevKey !== null) {
		for (let i = inList.focusItem; i > 0; i--) {
			const r = await live.session.press(prevKey);
			obs = r.obs;
			record(trail, { key: prevKey, focus: focusText(obs), stable: r.stable }, '      길 ');
		}
	}
	return at(obs)
		? null
		: `${route.keys.map((k) => KEY_LABEL[k]).join(' ')}로 ${calloutMark(no)}에 가지 못함 (실제 ${focusText(obs)})`;
}

const squash = (t: string): string => t.replace(/\s+/g, '').toLowerCase();

/**
 * 화면 전환 문장이 가리키는 화면: "#4.2." 같은 화면 번호, 아니면 앱 프로필의 화면 이름이 문장에 들어 있는 것
 * (가장 긴 이름, 같은 길이로 둘 이상이면 정하지 않음)
 */
function namedScreen(profile: AppProfile, text: string, current: string): string | null {
	const id = /#\s*(\d+(?:\.\d+)+)/.exec(text)?.[1];
	if (id !== undefined && id in profile.screens) return id;
	const t = squash(text);
	let best: { screen: string; len: number }[] = [];
	for (const [sc, d] of Object.entries(profile.screens)) {
		if (sc === current) continue;
		for (const n of d.names ?? []) {
			const len = squash(n).length;
			if (len === 0 || !t.includes(squash(n))) continue;
			if (best.length === 0 || len > (best[0]?.len ?? 0)) best = [{ screen: sc, len }];
			else if (len === best[0]?.len && !best.some((b) => b.screen === sc)) best.push({ screen: sc, len });
		}
	}
	return best.length === 1 ? (best[0]?.screen ?? null) : null;
}

async function runStep(ctx: Ctx, c: TcCase, s: TcStep, outDir: string): Promise<StepRun> {
	const started = Date.now();
	const screen = c.specRef?.screenId ?? '';
	const no = s.targetRef?.callout ?? null;
	const base: Omit<StepRun, 'status' | 'explanation' | 'basis' | 'results' | 'trail' | 'screenshot' | 'ms'> = {
		key: `${c.sheet}!${s.row}`,
		sheet: c.sheet,
		row: s.row,
		tcId: c.id,
		title: c.title,
		screen,
		callout: no
	};
	const notRun = (why: string): StepRun => ({
		...base,
		status: 'not-run',
		explanation: why,
		basis: '',
		results: [],
		trail: [],
		screenshot: null,
		ms: Date.now() - started
	});
	if (no === null) return notRun('단계에 콜아웃 참조가 없음');
	const screenDef = ctx.profile.screens[screen];
	if (screenDef === undefined) return notRun(`앱 프로필에 ${screen} 화면 진입 경로가 없음`);
	const element = ctx.registry.callout(screen, no);
	if (element === undefined) return notRun(`앱 프로필에 ${screen} ${calloutMark(no)} 대응 요소가 없음`);

	const clauses = splitClauses(s.expected ?? '');
	const results: CheckResult[] = [];
	const trail: Trail[] = [];
	const keyChecks: { clause: Clause; check: Check }[] = [];
	const okChecks: { clause: Clause; check: Check }[] = [];
	let screenshot: string | null;

	let { live, error } = await enter(ctx, screen, trail);
	try {
		if (error !== null) return notRun(`진입 실패: ${error}`);
		const entryObs = await live.session.observe();
		const t = target(entryObs, element);
		const title = ctx.registry.title(screen, no);
		const titleObs = title === undefined ? undefined : target(entryObs, title);

		for (const clause of clauses) {
			// "선택 시 … 이동"(화면 전환), "OK … VKB 호출"(키보드)처럼 결과를 따로 보는 조건이 있으면 조작 → 결과는 그쪽으로 본다
			const covered = clause.checks.some((k) => k.kind === 'transition' || k.kind === 'keyboard');
			for (const check of clause.checks) {
				if (check.method === 'none') {
					results.push(res(clause, check, null, check.reason));
					continue;
				}
				if (check.method === 'ai') {
					results.push(res(clause, check, 'needs-review', 'AI 판정 대상 — 이번 실행에서는 AI를 쓰지 않음'));
					continue;
				}
				const shown = t !== undefined && t.visible > 0;
				switch (check.kind) {
					case 'presence': {
						const wantsTitle = /타이틀|title/i.test(clause.text) && titleObs !== undefined;
						const obj = wantsTitle ? titleObs : t;
						const label = wantsTitle ? `${element} 타이틀` : element;
						if (obj === undefined || obj.visible === 0) {
							results.push(res(clause, check, 'fail', `${label}이(가) 보이지 않음`));
						} else if (/아이콘|이미지|썸네일|icon/i.test(clause.text) && !wantsTitle) {
							results.push(res(clause, check, 'pass', `${label} 보임 (아이콘은 글자 없이 있는지만)`));
						} else {
							const r = checkPresence(obj.texts, label);
							results.push(res(clause, check, r.verdict, r.explanation));
						}
						break;
					}
					case 'count': {
						if (!shown) results.push(res(clause, check, 'fail', `${element}이(가) 보이지 않음`));
						else {
							const r = checkMaxCount(Number(check.value), t.itemCount, element);
							results.push(res(clause, check, r.verdict, r.explanation));
						}
						break;
					}
					case 'exact-text': {
						const texts = [...(t?.texts ?? []), ...(t?.itemTexts ?? []), ...(titleObs?.texts ?? [])];
						const r = checkExactText(String(check.value), texts, element);
						results.push(res(clause, check, r.verdict, r.explanation));
						break;
					}
					case 'focus': {
						const first = /첫\s*번째|default/i.test(clause.text);
						const ok = t?.hasFocus === true && (!first || t.itemCount <= 1 || t.focusItem === 0);
						results.push(
							res(
								clause,
								check,
								ok ? 'pass' : 'fail',
								ok
									? `진입 시 포커스 ${focusText(entryObs)}`
									: `진입 시 포커스가 다름: 기대 ${element}${first ? '[0]' : ''} / 실제 ${focusText(entryObs)}`
							)
						);
						break;
					}
					case 'ellipsis': {
						const o = t?.textOverflow ?? { overflowing: 0, ellipsis: 0 };
						if (o.overflowing === 0)
							results.push(res(clause, check, null, '칸을 넘치는 글자가 없어 말줄임을 확인할 수 없음'));
						else if (o.ellipsis === o.overflowing)
							results.push(res(clause, check, 'pass', `넘치는 글자 ${o.overflowing}개 모두 말줄임`));
						else
							results.push(
								res(
									clause,
									check,
									'fail',
									`넘치는 글자 ${o.overflowing}개 중 ${o.overflowing - o.ellipsis}개가 말줄임 없이 잘림`
								)
							);
						break;
					}
					case 'keyboard':
						results.push(res(clause, check, null, '가상 키보드(VKB)는 TV에서만 확인 (브라우저에는 없음)'));
						break;
					case 'key':
						keyChecks.push({ clause, check });
						break;
					case 'transition':
					case 'no-action':
						okChecks.push({ clause, check });
						break;
					case 'behavior':
						if (!covered)
							results.push(res(clause, check, 'needs-review', '조작 → 결과 자동 확인은 아직 없음'));
						break;
					default:
						results.push(res(clause, check, 'needs-review', `${check.kind} 자동 확인은 아직 없음`));
				}
			}
		}

		// 표시 상태 캡처 (진입 직후)
		screenshot = `${c.sheet}-${s.row}.png`;
		await writeFile(join(outDir, screenshot), await live.session.driver.screenshot());

		// 키 동작: 목표 첫 항목에서 키 하나씩
		let dirty = false;
		for (const { clause, check } of keyChecks) {
			if (ctx.keyMaps?.get(screen) === undefined) {
				results.push(
					res(clause, check, null, `화면설계서에 ${screen} 이동 지도가 없어 키 동작을 비교할 수 없음`)
				);
				continue;
			}
			if (dirty) {
				await live.close();
				({ live, error } = await enter(ctx, screen, trail));
				if (error !== null) {
					results.push(res(clause, check, 'needs-review', `다시 진입 실패: ${error}`));
					continue;
				}
			}
			const why = await goTo(ctx, live, screen, no, trail);
			if (why !== null) {
				results.push(res(clause, check, 'needs-review', why));
				dirty = true;
				continue;
			}
			const key = KEY_OF[String(check.value)];
			if (key === undefined) {
				results.push(res(clause, check, null, `모르는 키 ${String(check.value)}`));
				continue;
			}
			const before = await live.session.observe();
			const remembered = new Map(live.session.remembered);
			const r = await live.session.press(key);
			record(trail, { key, focus: focusText(r.obs), stable: r.stable }, '    ');
			const move = checkSpecMove(
				ctx.registry.scoped(screen),
				{ keyMaps: ctx.keyMaps, options: ctx.options },
				before,
				key,
				r.obs,
				remembered
			);
			results.push({ ...move, clause, check });
			if (move.verdict !== null && move.verdict !== 'pass')
				console.log(`      [${VERDICT_LABEL[move.verdict]}] ${move.explanation}`);
			const back = target(r.obs, element);
			dirty = !(back?.hasFocus === true && (back.itemCount <= 1 || back.focusItem === 0));
		}

		// 선택 시: OK를 누르고 화면이 바뀌는지
		for (const { clause, check } of okChecks) {
			if (dirty || keyChecks.length > 0) {
				await live.close();
				({ live, error } = await enter(ctx, screen, trail));
				if (error !== null) {
					results.push(res(clause, check, 'needs-review', `다시 진입 실패: ${error}`));
					continue;
				}
			}
			dirty = true;
			const why = await goTo(ctx, live, screen, no, trail);
			if (why !== null) {
				results.push(res(clause, check, 'needs-review', why));
				continue;
			}
			const before = await live.session.observe();
			const r = await live.session.press('OK');
			record(trail, { key: 'OK', focus: focusText(r.obs), stable: r.stable }, '    ');
			const changedTo = Object.keys(ctx.profile.screens).filter((sc) => {
				if (sc === screen) return false;
				const a = target(r.obs, ctx.registry.detect(sc));
				const b = target(before, ctx.registry.detect(sc));
				return (
					(a?.visible ?? 0) > 0 && ((b?.visible ?? 0) === 0 || (a?.hasFocus === true && b?.hasFocus !== true))
				);
			});
			if (check.kind === 'no-action') {
				const same = focusText(before) === focusText(r.obs) && changedTo.length === 0;
				results.push(
					res(
						clause,
						check,
						same ? 'pass' : 'fail',
						same ? 'OK를 눌러도 화면·포커스 그대로' : `OK 후 바뀜: ${focusText(r.obs)}`
					)
				);
				continue;
			}
			const wantScreen = namedScreen(ctx.profile, clause.text, screen);
			if (wantScreen === null) {
				results.push(
					res(
						clause,
						check,
						'needs-review',
						changedTo.length > 0
							? `OK 후 ${changedTo.join(', ')} 화면으로 바뀜 — 문장이 가리키는 화면을 정하지 못해 사람 확인`
							: `OK 후 화면이 바뀌지 않음(${focusText(r.obs)}) — 문장이 가리키는 화면을 정하지 못해 사람 확인`
					)
				);
				continue;
			}
			// 그 화면이 새로 보이거나(이전 화면이 DOM에 남아 있을 수 있으므로) 포커스가 그 화면 안으로 옮겨 가야 한다
			const after = target(r.obs, ctx.registry.detect(wantScreen));
			const wasShown = (target(before, ctx.registry.detect(wantScreen))?.visible ?? 0) > 0;
			const ok = (after?.visible ?? 0) > 0 && (!wasShown || after?.hasFocus === true);
			results.push(
				res(
					clause,
					check,
					ok ? 'pass' : 'fail',
					ok ? `OK → ${wantScreen} 화면` : `OK 후 ${wantScreen} 화면이 아님 (포커스 ${focusText(r.obs)})`
				)
			);
		}
	} finally {
		await live.close();
	}

	const v: StepVerdict = aggregateStep(results);
	return {
		...base,
		status: v.verdict,
		explanation: v.explanation,
		basis: v.basis,
		results: results.map((r) => ({
			clause: r.clause.text,
			kind: r.check.kind,
			oracle: r.oracle,
			verdict: r.verdict,
			explanation: r.explanation
		})),
		trail,
		screenshot,
		ms: Date.now() - started
	};
}

// ── 사람 판정과 비교 ────────────────────────────────────

type Human = 'pass' | 'fail';

function humanLabel(text: string | null): Human | null {
	const t = (text ?? '').trim().toLowerCase();
	if (/^(p|pass|passed|ok|o)$/.test(t)) return 'pass';
	if (/^(f|fail|failed|ng|x)$/.test(t)) return 'fail';
	return null;
}

async function readTruth(path: string): Promise<Map<string, Human>> {
	const grid = await readWorkbook(path);
	const truth = new Map<string, Human>();
	for (const c of normalize(grid, suggestProfile(grid)).cases) {
		for (const s of c.steps) {
			const h = humanLabel(s.existingResult);
			if (h !== null) truth.set(`${c.sheet}!${s.row}`, h);
		}
	}
	return truth;
}

interface Score {
	labelled: number;
	decided: number;
	agree: number;
	falsePass: string[];
	falseFail: string[];
	review: number;
	notRun: number;
	lines: string[];
}

function score(steps: readonly StepRun[], truth: ReadonlyMap<string, Human>): Score {
	const s: Score = {
		labelled: 0,
		decided: 0,
		agree: 0,
		falsePass: [],
		falseFail: [],
		review: 0,
		notRun: 0,
		lines: []
	};
	s.lines.push('| 단계 | 사람 | 자동 | 결과 |', '|---|---|---|---|');
	for (const step of steps) {
		const h = truth.get(step.key);
		if (h === undefined) continue;
		s.labelled++;
		let mark: string;
		if (step.status === 'not-run') {
			s.notRun++;
			mark = '미실행';
		} else if (step.status === 'needs-review') {
			s.review++;
			mark = '자동 판정 보류';
		} else {
			s.decided++;
			if (step.status === h) {
				s.agree++;
				mark = '일치';
			} else if (step.status === 'pass') {
				s.falsePass.push(step.key);
				mark = '**틀린 Pass**';
			} else {
				s.falseFail.push(step.key);
				mark = '틀린 Fail';
			}
		}
		s.lines.push(`| ${step.key} | ${h === 'pass' ? 'Pass' : 'Fail'} | ${STATUS_LABEL[step.status]} | ${mark} |`);
	}
	return s;
}

const pct = (n: number, d: number): string => (d === 0 ? '-' : `${n}/${d} (${Math.round((n / d) * 100)}%)`);

function scoreText(sc: Score): string[] {
	return [
		`사람이 P/F를 적은 단계 ${sc.labelled}개 — 자동 판정(Pass/Fail) ${pct(sc.decided, sc.labelled)}, 확인 필요 ${sc.review}, 미실행 ${sc.notRun}`,
		`일치율(자동 판정한 단계 중) ${pct(sc.agree, sc.decided)} · 틀린 Pass ${sc.falsePass.length} · 틀린 Fail ${sc.falseFail.length}`
	];
}

// ── 리포트 ──────────────────────────────────────────────

const cell = (t: string): string => t.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

function report(profile: AppProfile, url: string, tcFile: string, steps: readonly StepRun[], sc: Score | null): string {
	const count = (st: StepStatus): number => steps.filter((s) => s.status === st).length;
	const all = steps.flatMap((s) => s.results);
	const lines = [
		`# TC 실행 (P0-8): ${profile.name}`,
		'',
		`- TC: ${tcFile}`,
		`- 앱: ${url}`,
		`- 단계 ${steps.length}개 — Pass ${count('pass')} · Fail ${count('fail')} · 확인 필요 ${count('needs-review')} · 미실행 ${count('not-run')}`,
		`- 조건 ${all.length}개 — 코드 판정 ${all.filter((r) => r.oracle === 'code').length} · AI 대상 ${all.filter((r) => r.oracle === 'ai').length} · 확인 불가 ${all.filter((r) => r.oracle === 'none').length}`,
		''
	];
	if (sc !== null) lines.push('## 사람 판정과 비교', '', ...scoreText(sc).map((t) => `- ${t}`), '', ...sc.lines, '');
	lines.push('## 단계', '', '| 단계 | 화면 | 콜아웃 | 자동 판정 | 판정 설명 |', '|---|---|---|---|---|');
	for (const s of steps) {
		lines.push(
			`| ${s.key} | ${s.screen} | ${s.callout === null ? '' : calloutMark(s.callout)} | ${STATUS_LABEL[s.status]} | ${cell(s.explanation)} |`
		);
	}
	lines.push('');
	for (const s of steps) {
		if (s.status === 'not-run') continue;
		lines.push(
			`### ${s.key} ${s.screen} ${s.callout === null ? '' : calloutMark(s.callout)} ${cell(s.title ?? '')} — ${STATUS_LABEL[s.status]}`,
			''
		);
		lines.push('| 조건 | 방법 | 결과 | 설명 |', '|---|---|---|---|');
		for (const r of s.results) {
			const how = r.oracle === 'code' ? '코드' : r.oracle === 'ai' ? 'AI' : '확인 불가';
			lines.push(
				`| ${cell(r.clause)} | ${how} | ${r.verdict === null ? '—' : VERDICT_LABEL[r.verdict]} | ${cell(r.explanation)} |`
			);
		}
		if (s.screenshot !== null) lines.push('', `![${s.key}](${s.screenshot})`);
		lines.push('');
	}
	return `${lines.join('\n')}\n`;
}

// ── 엑셀 사본 ───────────────────────────────────────────

async function writeExcel(
	tcFile: string,
	output: string,
	steps: readonly StepRun[],
	screenPrefix: string
): Promise<string> {
	const grid = await readWorkbook(tcFile);
	const profile = suggestProfile(grid);
	const cases = normalize(grid, profile).cases;
	const byKey = new Map(steps.map((s) => [s.key, s]));
	const lines: string[] = [];
	const writes: ResultWrite[] = [];
	const merges: { sheet: string; ref: string }[] = [];
	let allReused = true;
	for (const sheetName of [...new Set(steps.map((s) => s.sheet))]) {
		const sheet = grid.sheets.find((g) => g.name === sheetName);
		const sp = profile.sheets.find((p) => p.sheet === sheetName);
		if (sheet === undefined || sp === undefined) continue;
		const cols = endColumns(sheet, sp.headerRow);
		allReused &&= cols.reused;
		const resultCol = sp.columns.result;
		const values: StepValues[] = [];
		for (const c of cases.filter((x) => x.sheet === sheetName)) {
			const screen = c.specRef?.screenId ?? '';
			if (!(screen === screenPrefix || screen.startsWith(`${screenPrefix}.`))) continue;
			for (const s of c.steps) {
				const run = byKey.get(`${c.sheet}!${s.row}`);
				let row: [string, string, string];
				if (run !== undefined) {
					const shot = run.screenshot === null ? '' : ` · 캡처 ${run.screenshot}`;
					row = [STATUS_LABEL[run.status], run.explanation, `${run.basis}${shot}`];
				} else if (s.automation === 'deferred')
					row = ['보류', s.automationReason, `자동화 라벨: ${s.automationRule}`];
				else if (s.automation === 'auto') continue;
				else row = ['미실행', `자동화 대상 아님 (${s.automation})`, s.automationReason];
				values.push({ row: s.row, rowSpan: s.rowSpan, values: row, styleFrom: s.resultCell?.address ?? null });
			}
		}
		const plan = endColumnWrites(cols, values, {
			headerStyleFrom: resultCol === undefined ? null : `${resultCol}${sp.headerRow}`
		});
		writes.push(...plan.writes);
		merges.push(...plan.merges);
		lines.push(
			`${sheetName}: ${cols.columns.join(', ')}열${cols.reused ? ' (이전 사본의 열을 다시 씀)' : ''}, 단계 ${values.length}개`
		);
	}
	// 전에 쓴 사본의 우리 열만 덮어쓴다. 새 열 자리에 사람이 쓴 값이 있으면 건드리지 않고 알린다 (D-028)
	const rep = await writeResultCopy(tcFile, output, writes, { overwrite: allReused, merges });
	lines.push(`쓴 칸 ${rep.written} · 값이 있어 건너뜀 ${rep.skipped.length} · 수식이라 건너뜀 ${rep.formula.length}`);
	if (rep.skipped.length > 0)
		lines.push(
			`  건너뛴 칸: ${rep.skipped
				.slice(0, 10)
				.map((c) => c.address)
				.join(', ')}`
		);
	return lines.join('\n');
}

// ── main ────────────────────────────────────────────────

async function main(): Promise<void> {
	if (values.score !== undefined) {
		if (values.truth === undefined) throw new Error('--score에는 --truth(사람이 P/F 적은 엑셀)가 필요합니다');
		const saved = JSON.parse(await readFile(resolve(cwd, values.score), 'utf8')) as {
			format: string;
			steps: StepRun[];
		};
		if (saved.format !== RESULT_FORMAT) throw new Error(`결과 파일 형식이 아님 (${RESULT_FORMAT})`);
		const sc = score(saved.steps, await readTruth(resolve(cwd, values.truth)));
		console.log(scoreText(sc).join('\n'));
		console.log(sc.lines.join('\n'));
		return;
	}

	const tcFile = positionals[0];
	if (tcFile === undefined || values.profile === undefined) {
		throw new Error('사용법: pnpm spike:tc-run <TC.xlsx> --profile <앱 프로필.json> --spec <화면설계서 폴더>');
	}
	const raw = JSON.parse(await readFile(resolve(cwd, values.profile), 'utf8')) as unknown;
	const errors = validateProfile(raw);
	if (errors.length > 0) throw new Error(`앱 프로필 형식 오류 (${PROFILE_FORMAT}):\n- ${errors.join('\n- ')}`);
	const profile = raw as AppProfile;
	const registry = buildRegistry(profile);
	const options: KeyMapOptions = { ...DEFAULT_KEYMAP_OPTIONS, aliases: profile.aliases ?? {} };
	const specFiles = await jsonFiles(values.spec, cwd);
	const keyMaps = specFiles.length === 0 ? null : await loadKeyMaps(specFiles, options);
	if (keyMaps !== null) console.log(`화면설계서 화면 ${keyMaps.size}개: ${[...keyMaps.keys()].join(', ')}`);

	const tcPath = resolve(cwd, tcFile);
	const grid = await readWorkbook(tcPath);
	const cases = normalize(grid, suggestProfile(grid)).cases;
	const only = values.only === undefined ? null : new Set(values.only.split(',').map((x) => x.trim()));
	const prefix = values.screen;
	const selected: [TcCase, TcStep][] = [];
	for (const c of cases) {
		const screen = c.specRef?.screenId ?? '';
		if (!(screen === prefix || screen.startsWith(`${prefix}.`))) continue;
		for (const s of c.steps) {
			if (s.automation !== 'auto' || (s.expected ?? '').trim() === '') continue;
			if (only !== null && !only.has(`${c.sheet}!${s.row}`)) continue;
			selected.push([c, s]);
		}
	}
	console.log(`TC ${basename(tcPath)}: 화면 ${prefix}.x 자동 대상 단계 ${selected.length}개`);

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const out = join(resolve(cwd, values.out), `tc-${stamp}`);
	await mkdir(out, { recursive: true });
	const { windowScale, pauseMs } = await viewOptions(values.headed, values.scale, values.slow);
	const browser = await launchBrowser({ headless: !values.headed, windowScale });
	const ctx: Ctx = {
		browser,
		profile,
		registry,
		timing: { ...DEFAULT_TIMING, ...profile.timing },
		pauseMs,
		url: values.url ?? profile.url,
		keyMaps,
		options
	};
	const steps: StepRun[] = [];
	try {
		for (const [c, s] of selected) {
			const label = `${c.sheet}!${s.row} ${c.specRef?.screenId ?? ''} ${s.targetRef === null ? '' : calloutMark(s.targetRef.callout)} ${s.targetRef?.label ?? ''}`;
			console.log(`  ${label}`);
			const run = await runStep(ctx, c, s, out);
			steps.push(run);
			console.log(
				`    = ${STATUS_LABEL[run.status]} — ${run.explanation.split('\n')[0] ?? ''} (${(run.ms / 1000).toFixed(1)}초)`
			);
		}
	} finally {
		await browser.close();
	}

	const excel = join(out, `${basename(tcPath, '.xlsx')}-auto-qa-result.xlsx`);
	console.log(`\n엑셀 사본: ${await writeExcel(tcPath, excel, steps, prefix)}`);
	const sc = values.truth === undefined ? null : score(steps, await readTruth(resolve(cwd, values.truth)));
	if (sc !== null) console.log(scoreText(sc).join('\n'));
	await writeFile(join(out, 'report.md'), report(profile, ctx.url, basename(tcPath), steps, sc));
	await writeFile(
		join(out, 'result.json'),
		`${JSON.stringify({ format: RESULT_FORMAT, version: 1, tc: basename(tcPath), url: ctx.url, steps }, null, '\t')}\n`
	);
	const count = (st: StepStatus): number => steps.filter((x) => x.status === st).length;
	console.log(
		`단계 ${steps.length}개 — Pass ${count('pass')} · Fail ${count('fail')} · 확인 필요 ${count('needs-review')} · 미실행 ${count('not-run')}`
	);
	console.log(`→ ${join(out, 'report.md')}\n→ ${excel}`);
}

main().catch((e: unknown) => {
	console.error(e instanceof Error ? e.message : e);
	process.exitCode = 1;
});
