/**
 * P0-8 TC 실행 스파이크: TC 엑셀의 자동 대상 단계를 앱에서 리모컨 키로 실행하고,
 * 기대 결과를 조건으로 나눠(D-037) 코드로 판정한 뒤, 그 TC 파일에 양식 그대로 P/F와 이유를 쓴다(D-040, 쓰기 전 백업).
 * 사람이 P/F를 적은 다른 파일(QA 결과 보고서 등, --truth)과 비교해 일치율을 잰다.
 *
 *   pnpm spike:tc-run <TC.xlsx> --profile spikes/p0-8-e2e/profile.local.json --spec spikes/p0-8-e2e/spec [--truth <QA 결과.xlsx>]
 *   pnpm spike:tc-run --score out/<시각>/result.json --truth <QA 결과.xlsx>
 *
 * 한 단계 = 화면설계서 콜아웃 하나의 사양(표시 내용·개수·키 동작·선택 시).
 *   1. 그 화면까지 간다 (앱 프로필의 진입 경로). 같은 화면의 단계들은 앱을 한 번만 연다 (D-038)
 *   2. 표시 조건(있는지만·개수·정해진 문구·말줄임)은 그 화면에서 콜아웃 요소를 읽어 판정한다
 *   3. 키 동작은 목표 콜아웃 첫 항목으로 간 뒤 키 하나를 누르고 화면설계서와 비교한다.
 *      목표로는 키로 돌아온다: 화면 밖이면 BACK·exit 키 → 이동 지도 길 → 길이 없으면 방향 탐색. 못 돌아오면 그때만 앱을 다시 연다
 *   4. 선택 시(화면 전환·나타나는 것·포커스·선택 불가)는 OK 한 번을 누르고 결과를 본다
 *   순서·키가 정해져 있어 같은 TC·앱이면 같은 결과가 나온다 (재현성, D-005).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BrowserDriver, launchBrowser } from '@auto-qa/browser';
import type { RemoteKey } from '@auto-qa/core';
import {
	addedItems,
	compareMotion,
	nextResetStep,
	sameFingerprint,
	sampleMotion,
	takeFingerprint
} from '@auto-qa/focus';
import type { MotionSample, Observation, ObservedTarget, ScreenFingerprint } from '@auto-qa/focus';
import {
	VERDICT_LABEL,
	aggregateStep,
	checkExactText,
	checkMaxCount,
	checkPresence,
	splitClauses
} from '@auto-qa/judge';
import type { Check, CheckResult, Clause, StepVerdict, Verdict } from '@auto-qa/judge';
import {
	DEFAULT_KEYMAP_OPTIONS,
	DEFAULT_ROUTE_OPTIONS,
	buildKeyMap,
	defaultFocusTarget,
	matchByName,
	nameScore,
	overrideKeyTexts,
	parseOperation,
	planRoute,
	withCalloutNames
} from '@auto-qa/planner';
import type { KeyAction, KeyMapOptions, NavScreen, OperationPlan } from '@auto-qa/planner';
import type { SpecKey } from '@auto-qa/spec';
import {
	listValuesAt,
	normalize,
	readListValidations,
	readWorkbook,
	resultCellWrites,
	resultVocabulary,
	suggestProfile,
	writeResultInPlace
} from '@auto-qa/tc';
import type { ResultWrite, StepResult, TcCase, TcStep } from '@auto-qa/tc';
import {
	DEFAULT_LOADING_SELECTOR,
	KEY_LABEL,
	Session,
	checkSpecMove,
	focusText,
	jsonFiles,
	loadNavScreens,
	note,
	onTrail,
	record,
	runEntry,
	stateChangeCount,
	target,
	viewOptions
} from './common';
import type { TcKeyTexts, Trail } from './common';
import { DEFAULT_LIVE_OPTIONS, LiveReporter, isRunId } from './live';
import {
	PROFILE_FORMAT,
	buildRegistry,
	calloutMark,
	entryPath,
	isCancelText,
	resetConfig,
	validateProfile
} from './profile';
import type { AppProfile, ElementRegistry } from './profile';
import { DEFAULT_TIMING } from './scenario';
import type { ElementDef, Timing } from './scenario';

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
		/** 사람이 P/F 열에 결과를 적은 엑셀 (QA 결과 보고서 등, 실행할 TC 파일과 다른 파일) */
		truth: { type: 'string' },
		/** 일부러 틀린 TC의 바꾼 목록 (mutate.ts가 만든 <TC>.mutations.json) — 바꾼 조건을 Fail로 잡았는지 잰다 */
		mutations: { type: 'string' },
		/** TC 파일에 이미 값이 있는 P/F·이유 칸도 덮어쓴다 (다시 검수할 때) */
		overwrite: { type: 'boolean', default: false },
		/** 실행 폴더 이름 (사용자 UI가 정해 넘긴다, tc-로 시작). 없으면 시각으로 만든다 */
		run: { type: 'string' },
		/** 실시간 앱 화면(live.jpg)을 다시 쓰는 최소 간격 ms. 0이면 받지 않는다 (사용자 UI 미리보기용, 판정과 무관) */
		'live-frame-ms': { type: 'string', default: String(DEFAULT_LIVE_OPTIONS.frameMs) }
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
const PROGRESS_FORMAT = 'auto-qa/tc-run-progress';

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

// ── 화면 세션: 같은 화면 단계는 앱을 한 번만 연다 ──────────

interface Ctx {
	browser: Awaited<ReturnType<typeof launchBrowser>>;
	profile: AppProfile;
	registry: ElementRegistry;
	timing: Timing;
	pauseMs: number;
	url: string;
	keyMaps: Map<string, KeyAction[]> | null;
	/** 화면설계서 문장만으로 만든 이동 지도 (TC와 다른 곳 설명용). null이면 화면설계서 없음 */
	specKeyMaps: Map<string, KeyAction[]> | null;
	/** 콜아웃 이름(화면설계서 + TC 단계 이름 + 프로필 이름)·위치. 키 동작을 TC 문장으로 해석할 때 쓴다 (D-046) */
	navs: Map<string, NavScreen>;
	options: KeyMapOptions;
	/** 실행 중 상황을 사용자 UI에 알림 (판정과 무관) */
	live: LiveReporter;
}

interface ScreenSession {
	screen: string;
	session: Session;
	/** 그 화면에 막 들어왔을 때의 관찰 (진입 시 포커스 확인용) */
	entryObs: Observation;
	opened: number;
	/** 진입을 마쳤을 때의 키 수. 같으면 진입 직후(아직 아무 키도 안 누름) */
	freshAt: number;
}

/** 열려 있는 앱: 드라이버 하나를 계속 쓰고, 처음 화면 지문을 기억한다 (D-039) */
interface AppSession {
	driver: BrowserDriver;
	home: ScreenFingerprint;
	/** 실시간 화면 멈추기 */
	stopView: (() => Promise<void>) | null;
}

/** 목표에 못 간 이유. again = 처음 화면부터 다시 가 보면 될 수 있음 */
interface Miss {
	reason: string;
	again: boolean;
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

/** 목록 콜아웃 안에서 다음 항목으로 가는 키 (화면설계서·TC의 "다음 항목", 없으면 "이전 항목" 키의 반대) */
function listNextKey(actions: readonly KeyAction[], no: string): RemoteKey | null {
	const own = actions.filter((a) => a.from === no && a.effect.kind === 'step');
	const next = own.find((a) => a.effect.kind === 'step' && a.effect.delta > 0);
	if (next !== undefined) return KEY_OF[next.key] ?? null;
	const prev = own.find((a) => a.effect.kind === 'step' && a.effect.delta < 0);
	return prev === undefined ? null : (OPPOSITE[prev.key] ?? null);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 조작 → 결과 (planner parseOperation):
 * - closed: 목표에서 문장의 키를 차례로 누른 뒤 이 화면(팝업)이 닫혔는지
 * - uninterrupted: 목표에서 OK(선택) 바로 뒤, 끝나기 전에 이 콜아웃에서 "동작 없음"인 키를 끼워 넣고, 자리 잡은 뒤
 *   OK가 가는 곳(화면 최상단 Default 포커스 항목)이 화면 위쪽 안에 보이는지 (스크롤이 중간에 멈추지 않았는지)
 */
async function checkOperation(
	runner: Runner,
	screen: string,
	no: string,
	op: OperationPlan,
	noopKey: string | null,
	clause: Clause,
	check: Check,
	trail: Trail[]
): Promise<CheckResult> {
	const { ctx } = runner;
	const miss = await runner.reach(screen, no, trail);
	if (miss !== null) return res(clause, check, 'needs-review', miss.reason);
	if (op.result === 'closed') {
		ctx.live.phase('조작 → 닫힘 확인 중');
		if (!runner.shown(await runner.session.observe(), screen))
			return res(clause, check, 'needs-review', `누르기 전 ${screen} 화면이 보이지 않음`);
		const keys = op.keys.map((k) => KEY_OF[k]).filter((k): k is RemoteKey => k !== undefined);
		for (const key of keys) {
			const r = await runner.session.press(key);
			record(trail, { key, focus: focusText(r.obs), stable: r.stable }, '    조작 ');
		}
		const label = keys.map((k) => KEY_LABEL[k] ?? k).join(' → ');
		const closed = await runner.session.until((o) => !runner.shown(o, screen), ctx.timing.transitionWaitMs);
		const now = closed ?? (await runner.session.observe());
		return closed !== null
			? res(clause, check, 'pass', `${label} → ${screen} 화면 닫힘 (포커스 ${focusText(now)})`)
			: res(clause, check, 'fail', `${label} 뒤에도 ${screen} 화면이 닫히지 않음 (포커스 ${focusText(now)})`);
	}
	// uninterrupted
	const interrupt = noopKey === null ? undefined : KEY_OF[noopKey];
	if (interrupt === undefined)
		return res(clause, check, null, '끼워 넣을 입력(이 콜아웃에서 "동작 없음"인 키)을 TC에서 찾지 못함');
	const dft = defaultFocusOf(ctx, screen, '화면 최상단 Default 포커스 항목');
	if (dft === null) return res(clause, check, null, '선택 뒤 가야 할 곳(화면 최상단 기본 포커스)을 정하지 못함');
	ctx.live.phase('이동 중 입력 확인 중');
	const driver = runner.session.driver;
	await driver.pressKey('OK');
	await sleep(ctx.timing.pollMs);
	await driver.pressKey(interrupt);
	const settled = await runner.session.settle(ctx.timing.readyTimeoutMs);
	const label = `OK, 곧바로 ${KEY_LABEL[interrupt] ?? interrupt}`;
	record(trail, { key: null, focus: `${label} → ${focusText(settled.obs)}`, stable: settled.settled }, '    ');
	const top = target(settled.obs, dft.element)?.rect ?? null;
	if (top === null) return res(clause, check, 'fail', `${label} 뒤 ${dft.element}이(가) 보이지 않음`);
	return top[1] >= -2
		? res(
				clause,
				check,
				'pass',
				`${label} → 맨 위 ${dft.element}까지 이동 (위치 y=${top[1]}, 포커스 ${focusText(settled.obs)})`
			)
		: res(
				clause,
				check,
				'fail',
				`${label} 뒤 맨 위까지 가지 않음: ${dft.element} 위치 y=${top[1]} (포커스 ${focusText(settled.obs)})`
			);
}

/**
 * Marquee (움직임·시간): 넘치는 글자가 있는 항목에 포커스를 두고 기다린 뒤, 넘치는 글자의 위치가 바뀌는지 본다.
 * - TC "N초 뒤"면 N초(없으면 timing.motionWaitMs) + 여유를 기다린 뒤 간격을 두고 두 번 잰다
 * - "N초 뒤"인데 포커스 직후부터 움직이면 시작 시각이 맞는지 사람 확인 (시간에 민감해 Fail로 정하지 않음)
 * - "Marquee 적용되지 않음"(value 'still')은 같은 시간 동안 움직이지 않아야 Pass
 * 넘치는 글자가 없으면 확인 불가(null). 첫 항목에 없으면 목록 안에서 옆 항목으로 가 보며 찾는다
 */
async function checkMotion(
	runner: Runner,
	screen: string,
	no: string,
	element: string,
	seen: ObservedTarget | undefined,
	clause: Clause,
	check: Check,
	trail: Trail[]
): Promise<CheckResult> {
	const { ctx } = runner;
	const still = check.value === 'still';
	if ((seen?.textOverflow.overflowing ?? 0) === 0)
		return res(clause, check, null, '칸을 넘치는 글자가 없어 Marquee를 확인할 수 없음');
	const miss = await runner.reach(screen, no, trail);
	if (miss !== null) return res(clause, check, 'needs-review', miss.reason);
	ctx.live.phase('Marquee 움직임 확인 중');
	const sample = (): Promise<MotionSample> => sampleMotion(runner.session.driver, runner.session.focusSelector);
	// 목록의 다음 항목 키를 모르면 오른쪽 (TV 목록·그리드는 가로가 먼저). 목록을 벗어나면 멈춘다
	const next = listNextKey(ctx.keyMaps?.get(screen) ?? [], no) ?? 'RIGHT';
	let first = await sample();
	let started = Date.now();
	const budget = Math.min(ctx.timing.motionMaxItems, Math.max(0, (seen?.itemCount ?? 1) - 1));
	for (let i = 0; first.overflowing === 0 && i < budget; i++) {
		const r = await runner.session.press(next, false);
		record(trail, { key: next, focus: focusText(r.obs), stable: r.stable }, '    Marquee ');
		if (target(r.obs, element)?.hasFocus !== true) break;
		first = await sample();
		started = Date.now();
	}
	if (first.overflowing === 0)
		return res(clause, check, null, `포커스한 ${element} 항목에 넘치는 글자가 없어 Marquee를 확인할 수 없음`);
	const { motionWaitMs, motionMarginMs, motionGapMs } = ctx.timing;
	const waitMs = typeof check.value === 'number' ? check.value * 1000 : motionWaitMs;
	// 기다리기 전(포커스 직후) 한 번 더: "N초 뒤 시작"인데 이미 움직이는지
	await sleep(Math.min(motionGapMs, waitMs / 2));
	const early = await sample();
	await sleep(Math.max(0, started + waitMs + motionMarginMs - Date.now()));
	const a = await sample();
	await sleep(motionGapMs);
	const b = await sample();
	if (!b.focused) return res(clause, check, 'needs-review', '기다리는 동안 포커스가 사라짐');
	const moved = compareMotion(first, a) === 'moved' || compareMotion(a, b) === 'moved';
	const sec = `${(waitMs / 1000).toFixed(waitMs % 1000 === 0 ? 0 : 1)}초`;
	const where = `${focusText(await runner.session.observe())}, 넘치는 글자 ${b.overflowing}개`;
	if (still) {
		return moved
			? res(clause, check, 'fail', `Marquee가 없어야 하는데 넘치는 글자가 움직임 (${where})`)
			: res(clause, check, 'pass', `포커스 ${sec} 넘게 넘치는 글자가 움직이지 않음 (${where})`);
	}
	if (!moved)
		return res(clause, check, 'fail', `포커스 ${sec} 뒤에도 넘치는 글자가 움직이지 않음 — Marquee 없음 (${where})`);
	if (typeof check.value === 'number' && compareMotion(first, early) === 'moved') {
		return res(
			clause,
			check,
			'needs-review',
			`포커스 직후부터 움직임 — ${sec} 뒤에 시작하는지 사람 확인 (${where})`
		);
	}
	return res(clause, check, 'pass', `포커스 ${sec} 뒤 넘치는 글자가 움직임 (${where})`);
}

/**
 * 이름으로 가리킨 대상을 찾을 요소: 이 화면 요소 + 진입 경로 앞 화면의 콜아웃 중 누르기 전 화면에 보이던 것.
 * 4.3(최근 검색어가 있을 경우)의 "[▼] 추천 검색어 …"는 앞 화면 4.2의 추천 검색어를 가리킨다(Search!31).
 * 보이지 않는 앞 화면 요소(다른 페이지)는 넣지 않아 같은 이름의 다른 화면 요소로 기대를 잘못 정하지 않는다
 */
function nameScope(registry: ElementRegistry, screen: string, before: Observation): Record<string, ElementDef> {
	const shown = Object.entries(registry.upstream(screen)).filter(([n]) => (target(before, n)?.visible ?? 0) > 0);
	return { ...registry.scoped(screen), ...Object.fromEntries(shown) };
}

/**
 * TC "X가 없을 경우 Y"의 X가 화면에 보이는가. X를 앱 요소 이름(모든 화면)에서 찾고, 그 요소가 관찰에 없으면
 * 그 요소가 속한 화면의 표시(@화면)로 본다. 이름에 맞는 요소가 없으면 null (조건을 고르지 않음, 추측하지 않음)
 */
function presentIn(
	registry: ElementRegistry,
	options: KeyMapOptions
): (name: string, obs: Observation) => boolean | null {
	const candidates = Object.entries(registry.elements).filter(([n]) => !n.startsWith('@'));
	return (name, obs) => {
		const m = matchByName(name, candidates, ([n, e]) => [n, ...(e.names ?? [])], options);
		if (m === null) return null;
		const [element, def] = m.match;
		const t = target(obs, element);
		if (t !== undefined) return t.visible > 0;
		const screen = (def.callout ?? '').split('#')[0] ?? '';
		const shown = screen === '' ? undefined : target(obs, `@${screen} 화면`);
		return shown === undefined ? null : shown.visible > 0;
	};
}

/**
 * 화면·콜아웃 번호별 이름: TC 단계 이름("(6) Back to Top" → "Back to Top")과 앱 프로필 이름.
 * TC 문장은 TC가 쓰는 이름으로 콜아웃을 부르므로(화면설계서 판에 설명이 없는 콜아웃 포함) 이것으로 대응시킨다
 */
function calloutNameTable(profile: AppProfile, cases: readonly TcCase[]): Map<string, Record<string, string[]>> {
	const out = new Map<string, Record<string, string[]>>();
	const add = (screen: string, no: string, names: readonly (string | undefined)[]): void => {
		const table = out.get(screen) ?? {};
		const list = table[no] ?? [];
		for (const n of names) if (n !== undefined && n.trim() !== '' && !list.includes(n.trim())) list.push(n.trim());
		table[no] = list;
		out.set(screen, table);
	};
	for (const c of cases) {
		const screen = c.specRef?.screenId;
		if (screen == null) continue;
		for (const st of c.steps) if (st.targetRef !== null) add(screen, st.targetRef.callout, [st.targetRef.label]);
	}
	for (const [screen, def] of Object.entries(profile.screens))
		for (const [no, co] of Object.entries(def.callouts)) add(screen, no, [co.name, ...(co.names ?? [])]);
	return out;
}

/**
 * 앱 요소 이름에 그 콜아웃의 이름(화면설계서·TC 단계 이름)을 더한다. TC 문장이 다른 화면의 콜아웃을 이름으로 부를 때
 * ("[▲] "Option" 버튼" → 4.2 ⑤ "Search Option 메뉴", "최근검색어가 없을 경우" → 4.3 ① "최근 검색어") 그 이름으로 찾는다
 */
function addCalloutNames(registry: ElementRegistry, navs: ReadonlyMap<string, NavScreen>): void {
	for (const def of Object.values(registry.elements)) {
		const [screen = '', no = ''] = (def.callout ?? '').split('#');
		const extra = navs.get(screen)?.callouts.find((c) => c.no === no)?.names ?? [];
		if (extra.length > 0) def.names = [...new Set([...(def.names ?? []), ...extra])];
	}
}

/** 화면·콜아웃 번호별 TC 키 동작 문장 ("[▼] …"). 같은 콜아웃이 여러 단계에 있으면 나중 단계 문장 */
function tcKeyTable(cases: readonly TcCase[]): Map<string, Record<string, Partial<Record<SpecKey, string>>>> {
	const out = new Map<string, Record<string, Partial<Record<SpecKey, string>>>>();
	for (const c of cases) {
		const screen = c.specRef?.screenId;
		if (screen == null) continue;
		for (const st of c.steps) {
			if (st.targetRef === null) continue;
			const table = out.get(screen) ?? {};
			const texts = table[st.targetRef.callout] ?? {};
			for (const clause of splitClauses(st.expected ?? ''))
				if (clause.key !== null) texts[clause.key] = clause.text;
			table[st.targetRef.callout] = texts;
			out.set(screen, table);
		}
	}
	return out;
}

class Runner {
	current: ScreenSession | null = null;
	app: AppSession | null = null;
	/** 앱을 연 횟수 (처음 + 되돌리기 실패로 다시 연 횟수) */
	opens = 0;
	/** 처음 화면으로 키로 되돌린 횟수 */
	resets = 0;
	/** 키 확인 결과 (화면|콜아웃|키) — 같은 확인은 한 번만 실행 */
	readonly moves = new Map<string, ReturnType<typeof checkSpecMove>>();
	readonly reset: ReturnType<typeof resetConfig>;
	/**
	 * 화면 표시(detect)별 깨끗한 상태의 요소 (D-043 ②): 앱을 연 뒤 다른 선택(OK·검색) 없이 그 화면에 들어왔을 때의 지문 요소.
	 * 앞 단계가 남긴 상태(최근 검색어 등)로 요소가 새로 생겼는지 비교하는 기준
	 */
	readonly baselines = new Map<string, string[]>();
	/** 깨끗하게 다시 열어도 요소가 달라지는 화면 표시(detect) (콘텐츠가 바뀌는 화면) — 상태 비교를 하지 않는다 */
	readonly dynamic = new Set<string>();
	/** 상태가 남아 앱을 다시 연 횟수 */
	cleanRelaunches = 0;

	constructor(readonly ctx: Ctx) {
		this.reset = resetConfig(ctx.profile);
	}

	async close(): Promise<void> {
		this.current = null;
		if (this.app !== null) {
			await this.app.stopView?.();
			await this.app.driver.close();
		}
		this.app = null;
	}

	/** 앱을 새로 열고(새 브라우저 컨텍스트라 저장 상태도 새로) 준비되면 처음 화면 지문을 기억한다 */
	private async launch(trail: Trail[]): Promise<string | null> {
		await this.close();
		const { ctx } = this;
		this.opens++;
		ctx.live.phase('앱 여는 중');
		const driver = await BrowserDriver.open(ctx.browser, ctx.url);
		// 실시간 화면은 앱이 뜨는 동안부터 보낸다 (못 받아도 검수는 그대로)
		const stopView = ctx.live.framesOn
			? await driver.liveView((jpeg) => ctx.live.onFrame(jpeg)).catch(() => null)
			: null;
		const probe = this.probe(driver);
		// 스플래시·스켈레톤이 끝나고 포커스가 자리 잡은 뒤의 화면을 처음 화면으로 기억한다
		const ready = await probe.settle(ctx.timing.readyTimeoutMs);
		if (!ready.settled) {
			await stopView?.();
			await driver.close();
			return '앱이 준비되지 않음 (포커스가 없거나 로딩 표시가 사라지지 않음)';
		}
		const home = await takeFingerprint(driver, this.reset.fingerprint);
		this.app = { driver, home, stopView };
		const layers = home.layers.length > 0 ? `, 겹친 층 ${home.layers.length}` : '';
		record(
			trail,
			{ key: null, focus: `앱 열기 → 처음 화면 기억 (요소 ${home.items.length}개${layers})`, stable: true },
			'      '
		);
		return null;
	}

	/**
	 * 처음 화면으로 키로 되돌린다 (D-039): 지문과 같아질 때까지 BACK, 포커스가 든 팝업은 닫기 키, 포커스 없는 층(토스트)은
	 * BACK을 누르지 않음, 최상위에 닿은 뒤 GNB 같은 영역에 있으면 그 영역의 나가기 키. OK는 누르지 않는다.
	 * 안 되면 앱을 다시 연다. 오류 문장 또는 null
	 */
	private async resetHome(trail: Trail[]): Promise<string | null> {
		try {
			return await this.resetHomeOnce(trail);
		} catch (error) {
			// 앱이 꺼져 창이 닫혔으면(종료 버튼 등) 멈추지 않고 다시 연다
			const why = error instanceof Error ? error.message.split('\n')[0] : String(error);
			record(
				trail,
				{ key: null, focus: `다시 열기 (앱 창이 닫힘: ${why ?? ''})`, stable: true },
				'      홈으로 '
			);
			return this.launch(trail);
		}
	}

	/**
	 * BACK으로 닫히지 않는 팝업에서 취소 버튼을 고른다: 지금 포커스 글자가 취소면 OK, 아니면 방향키를 하나씩 눌러 보며
	 * 팝업 안에서 취소 글자 버튼을 찾는다. 나가기 글자 버튼에서는 OK를 누르지 않는다
	 */
	private async chooseCancel(driver: BrowserDriver, popup: ScreenFingerprint, trail: Trail[]): Promise<boolean> {
		const probe = this.probe(driver);
		const { cancelWords, exitWords } = this.reset;
		const keys: RemoteKey[] = ['DOWN', 'RIGHT', 'UP', 'LEFT', 'DOWN', 'RIGHT'];
		for (let i = 0; i <= keys.length; i++) {
			const obs = await probe.observe();
			const text = obs.focus?.text ?? '';
			if (isCancelText(text, cancelWords, exitWords)) {
				await driver.pressKey('OK');
				await driver.waitForStable();
				await probe.settle(this.ctx.timing.readyTimeoutMs);
				record(trail, { key: 'OK', focus: `팝업 "${text}" 버튼으로 닫기`, stable: true }, '      홈으로 ');
				const after = await takeFingerprint(driver, this.reset.fingerprint);
				return after.layers.length < popup.layers.length;
			}
			const key = keys[i];
			if (key === undefined) break;
			await driver.pressKey(key);
			await driver.waitForStable();
			record(
				trail,
				{ key, focus: `팝업 취소 버튼 찾기 ("${text.slice(0, 20)}")`, stable: true },
				'      홈으로 '
			);
		}
		return false;
	}

	private async resetHomeOnce(trail: Trail[]): Promise<string | null> {
		const app = this.app;
		if (app === null) return this.launch(trail);
		const { ctx } = this;
		ctx.live.phase('처음 화면으로 되돌리는 중');
		const state = { top: 0 };
		// 화면에는 한 줄로 요약한다 (키마다의 이유는 리포트 기록에만)
		const keys: string[] = [];
		const take = (): Promise<ScreenFingerprint> => takeFingerprint(app.driver, this.reset.fingerprint);
		for (let i = 0; i <= ctx.timing.maxResetKeys; i++) {
			let now = await take();
			let step = nextResetStep(app.home, now, state, this.reset.rules, this.reset.match);
			if (step.kind === 'wait') {
				// 토스트가 사라질 때까지 (고정 sleep 대신 조건 확인)
				const end = Date.now() + ctx.timing.toastWaitMs;
				while (step.kind === 'wait' && Date.now() < end) {
					await new Promise((r) => setTimeout(r, ctx.timing.pollMs));
					now = await take();
					step = nextResetStep(app.home, now, state, this.reset.rules, this.reset.match);
				}
				state.top++;
				if (step.kind === 'wait') step = { kind: 'relaunch', reason: '포커스 없는 층이 사라지지 않음' };
			}
			if (step.kind === 'done') {
				if (i > 0) {
					this.resets++;
					record(
						trail,
						{ key: null, focus: `${keys.join(' ')} → 홈 (${step.reason})`, stable: true },
						'      홈으로 '
					);
				}
				return null;
			}
			if (step.kind === 'relaunch' || i === ctx.timing.maxResetKeys) {
				const why =
					step.kind === 'relaunch' ? step.reason : `키 ${ctx.timing.maxResetKeys}번 안에 처음 화면에 못 옴`;
				record(trail, { key: null, focus: `다시 열기 (${why})`, stable: true }, '      홈으로 ');
				return this.launch(trail);
			}
			if (step.kind !== 'press') continue;
			await app.driver.pressKey(step.key);
			const st = await app.driver.waitForStable();
			await this.probe(app.driver).settle(ctx.timing.readyTimeoutMs);
			// 팝업(종료 팝업)을 닫았거나 BACK에 화면이 그대로면 최상위에 닿은 것
			let noEffect = step.key === this.reset.rules.backKey && sameFingerprint(now, await take());
			if (noEffect && step.closes === 'popup') {
				// BACK으로 안 닫히는 팝업: 취소 글자 버튼으로 가서 OK (나가기 버튼에서는 누르지 않음)
				const closed = await this.chooseCancel(app.driver, now, trail);
				noEffect = false;
				if (!closed) {
					record(
						trail,
						{ key: null, focus: '다시 열기 (팝업의 취소 버튼을 찾지 못함)', stable: true },
						'      홈으로 '
					);
					return this.launch(trail);
				}
			}
			if (step.closes === 'popup' || noEffect) state.top++;
			keys.push(KEY_LABEL[step.key] ?? step.key);
			note(trail, {
				key: step.key,
				focus: noEffect ? `${step.reason} (반응 없음 → 최상위)` : step.reason,
				stable: st.stable
			});
		}
		return this.launch(trail);
	}

	/** 그 화면까지 간다: 앱이 없으면 열고, 있으면 처음 화면으로 되돌린 뒤 진입 경로를 따라간다 (앱을 다시 열지 않음) */
	async open(screen: string, trail: Trail[]): Promise<string | null> {
		const { ctx } = this;
		this.current = null;
		const ready = this.app === null ? await this.launch(trail) : await this.resetHome(trail);
		if (ready !== null || this.app === null) return ready ?? '앱을 열지 못함';
		let session = this.newSession(screen);
		// 진입 경로를 밟기 전까지 앱 상태를 바꾼 동작 수 (0이면 깨끗한 앱에서 들어감)
		const changesBefore = stateChangeCount(this.app.driver);
		const enter = async (): Promise<string | null> => {
			ctx.live.phase(`${screen} 화면으로 들어가는 중`);
			const e = await runEntry(
				session,
				entryPath(ctx.profile, ctx.registry, screen),
				trail,
				ctx.profile.testData
			);
			if (e !== null) return e;
			const shown = await session.until((o) => this.shown(o, screen), ctx.timing.readyTimeoutMs);
			return shown === null ? `${screen} 화면 표시(detect)가 보이지 않음` : null;
		};
		let error = await enter();
		if (error !== null) {
			// 한 번만 다시: 홈으로 돌아가 진입 경로를 처음부터 (그래도 안 되면 멈춘다 — 헛돌지 않음)
			record(trail, { key: null, focus: `진입 실패 → 홈부터 한 번 더 (${error})`, stable: true }, '      ');
			const again = await this.resetHome(trail);
			if (again !== null || this.app === null) return again ?? '앱을 열지 못함';
			session = this.newSession(screen);
			error = await enter();
		}
		if (error !== null) return error;
		const drift = await this.stateDrift(screen, changesBefore);
		if (drift !== null) {
			// 앞 단계가 남긴 상태가 화면설계서의 전제와 다르게 만든다 → 깨끗한 앱에서 다시 (재시작은 이때만)
			record(trail, { key: null, focus: `앱 상태가 다름 → 다시 열기 (${drift})`, stable: true }, '      ');
			this.cleanRelaunches++;
			const relaunched = await this.launch(trail);
			if (relaunched !== null || this.app === null) return relaunched ?? '앱을 열지 못함';
			session = this.newSession(screen);
			error = await enter();
			if (error !== null) return error;
			const again = await this.stateDrift(screen, 0, drift);
			if (again !== null) return again;
		}
		this.current = {
			screen,
			session,
			entryObs: await session.observe(),
			opened: this.opens,
			freshAt: session.presses
		};
		return null;
	}

	/**
	 * 앞 단계가 남긴 상태로 이 화면이 처음(깨끗한 상태)과 달라졌는가 (D-043 ②). 다르면 이유, 같거나 비교할 수 없으면 null.
	 * - 깨끗한 앱에서 들어왔으면(changesBefore 0) 지금 요소를 기준으로 기억한다
	 * - 기준이 없는데 앞 단계가 무언가 골랐으면 → 깨끗한 상태를 모르므로 다시 열어 기준을 만든다
	 * - 기준보다 요소가 새로 생겼으면(최근 검색어 등) → 다시 연다
	 * retried: 다시 연 뒤의 확인. 깨끗하게 열어도 달라지면 콘텐츠가 바뀌는 화면으로 보고 이후 비교하지 않는다
	 */
	private async stateDrift(
		screen: string,
		changesBefore: number,
		retried: string | null = null
	): Promise<string | null> {
		// 같은 패널로 표시되는 화면(예: 4.1·4.2 검색 패널)은 기준을 함께 쓴다
		const key = this.ctx.profile.screens[screen]?.detect ?? screen;
		if (this.app === null || this.dynamic.has(key)) return null;
		const now = (await takeFingerprint(this.app.driver, this.reset.fingerprint)).items;
		const base = this.baselines.get(key);
		if (changesBefore === 0) {
			if (retried !== null && base !== undefined && addedItems(base, now).length > 0) this.dynamic.add(key);
			this.baselines.set(key, now);
			return null;
		}
		if (base === undefined) return '이 화면의 깨끗한 상태를 아직 모름';
		const added = addedItems(base, now);
		if (added.length === 0) return null;
		const shown = added.slice(0, 3).join(', ');
		return `처음 없던 요소 ${added.length}개: ${shown}${added.length > 3 ? ' …' : ''}`;
	}

	/** 요소 없이 포커스·로딩만 보는 세션 (앱 준비·되돌리기 대기용) */
	private probe(driver: BrowserDriver): Session {
		const { ctx } = this;
		return new Session(
			driver,
			{},
			ctx.profile.focusSelector ?? null,
			ctx.timing,
			0,
			ctx.profile.loading ?? DEFAULT_LOADING_SELECTOR
		);
	}

	private newSession(screen: string): Session {
		const { ctx } = this;
		if (this.app === null) throw new Error('앱이 열려 있지 않음');
		return new Session(
			this.app.driver,
			ctx.registry.forScreen(screen),
			ctx.profile.focusSelector ?? null,
			ctx.timing,
			ctx.pauseMs,
			ctx.profile.loading ?? DEFAULT_LOADING_SELECTOR
		);
	}

	/**
	 * 이 화면을 쓰고 있으면 그대로. 같은 패널(detect가 같은 화면, 예: 4.1·4.2 검색 패널)이 이미 떠 있으면
	 * 처음 화면으로 돌아가지 않고 이어 쓴다(진입 시 관찰은 그 패널에 들어왔을 때의 것). 아니면 처음 화면부터 들어간다
	 */
	async ensure(screen: string, trail: Trail[]): Promise<string | null> {
		const cur = this.current;
		if (cur?.screen === screen) return null;
		if (cur !== null && this.sameDetect(cur.screen, screen)) {
			const session = this.newSession(screen);
			const obs = await session.observe();
			if (this.shown(obs, screen)) {
				this.current = { screen, session, entryObs: cur.entryObs, opened: cur.opened, freshAt: -1 };
				record(
					trail,
					{ key: null, focus: `${cur.screen}와 같은 화면이 떠 있어 이어서 씀`, stable: true },
					'      '
				);
				return null;
			}
		}
		return this.open(screen, trail);
	}

	get session(): Session {
		if (this.current === null) throw new Error('화면 세션이 없음');
		return this.current.session;
	}

	shown(o: Observation, screen: string): boolean {
		return (target(o, this.ctx.registry.detect(screen))?.visible ?? 0) > 0;
	}

	/** 두 화면이 같은 요소로 표시되는가 (예: 4.1과 4.2는 같은 검색 패널) */
	sameDetect(a: string, b: string): boolean {
		return this.ctx.profile.screens[a]?.detect === this.ctx.profile.screens[b]?.detect;
	}

	/** 포커스가 이 화면의 콜아웃 안에 있는가 */
	inScreen(o: Observation, screen: string): boolean {
		const callouts = Object.keys(this.ctx.profile.screens[screen]?.callouts ?? {});
		return (
			this.shown(o, screen) &&
			callouts.some((n) => target(o, this.ctx.registry.callout(screen, n) ?? '')?.hasFocus === true)
		);
	}

	/** 이 화면에 막 들어온 상태인가 (아직 아무 키도 안 누름) */
	fresh(screen: string): boolean {
		const cur = this.current;
		return cur !== null && cur.screen === screen && cur.session.presses === cur.freshAt;
	}

	/**
	 * 목표 콜아웃 첫 항목으로 (단순화, D-042): 진입 직후가 아니면 홈으로 돌아가(재시작 아님) 그 화면에 다시 들어간 뒤,
	 * 이동 지도의 길(없으면 목표 쪽 방향키)로 간다. 앞 확인에서 누른 키의 영향이 남지 않는다
	 */
	async reach(screen: string, no: string, trail: Trail[]): Promise<Miss | null> {
		if (!this.fresh(screen)) {
			// 앞 키를 누른 뒤에도 포커스가 이 화면 콜아웃 안이면 홈까지 가지 않고 그 자리에서 목표로 (확인당 키 수를 줄임).
			// 화면이 바뀌었거나(OK) 화면 밖(GNB)·팝업이면, 또는 그 자리에서 못 가면 홈 → 진입 경로
			if (this.inScreen(await this.session.observe(), screen)) {
				const miss = await this.tryReach(screen, no, trail);
				if (miss === null) return null;
				record(
					trail,
					{ key: null, focus: `그 자리에서 못 감 → 홈부터 (${miss.reason})`, stable: true },
					'      '
				);
			}
			const error = await this.open(screen, trail);
			if (error !== null) return { reason: `진입 실패: ${error}`, again: false };
		}
		return this.tryReach(screen, no, trail);
	}

	private async tryReach(screen: string, no: string, trail: Trail[]): Promise<Miss | null> {
		const { ctx } = this;
		ctx.live.phase(`목표 ${calloutMark(no)} 찾아가는 중`);
		const name = ctx.registry.callout(screen, no) ?? '';
		const at = (o: Observation): boolean => {
			const t = target(o, name);
			return t?.hasFocus === true && (t.itemCount <= 1 || t.focusItem === 0);
		};
		const actions = ctx.keyMaps?.get(screen) ?? [];
		const prevKey = listPrevKey(actions, no) ?? 'LEFT';
		const seen = new Set<string>();
		let noRoute: string | null = null;
		for (let round = 0; round <= ctx.timing.maxSearchKeys; round++) {
			const obs = await this.session.observe();
			if (at(obs)) return null;
			const here = focusText(obs);
			if (seen.has(here)) break;
			seen.add(here);
			const inList = target(obs, name);
			if (inList?.hasFocus === true && inList.focusItem > 0) {
				for (let i = inList.focusItem; i > 0; i--) await this.step(prevKey, trail, '      길 ');
				continue;
			}
			const from = Object.keys(ctx.profile.screens[screen]?.callouts ?? {}).find(
				(n) => target(obs, ctx.registry.callout(screen, n) ?? '')?.hasFocus === true
			);
			if (from !== undefined && from !== no) {
				const fromObs = target(obs, ctx.registry.callout(screen, from) ?? '');
				const route = planRoute(
					actions,
					{ callout: from, position: Math.max(1, (fromObs?.focusItem ?? 0) + 1) },
					{ callout: no, position: 1 },
					[],
					DEFAULT_ROUTE_OPTIONS
				);
				if (route.ok) {
					for (const key of route.keys)
						await this.step(key, trail, `      길${route.estimated ? '(추정)' : ''} `);
					continue;
				}
				noRoute = route.reason;
			}
			if (!(await this.searchStep(name, obs, trail))) break;
		}
		const obs = await this.session.observe();
		if (at(obs)) return null;
		const why = `${noRoute === null ? '' : `이동 지도에 길 없음(${noRoute}), `}방향 탐색으로도 ${calloutMark(no)}에 가지 못함 (실제 ${focusText(obs)})`;
		return { reason: why, again: false };
	}

	private async step(key: RemoteKey, trail: Trail[], label: string): Promise<Observation> {
		const r = await this.session.press(key, false);
		record(trail, { key, focus: focusText(r.obs), stable: r.stable }, label);
		return r.obs;
	}

	/** 목표 쪽으로 방향키 한 번 (주 축 먼저, 포커스가 안 움직이면 다른 축). 움직였으면 true */
	private async searchStep(name: string, obs: Observation, trail: Trail[]): Promise<boolean> {
		const t = target(obs, name);
		if (t?.rect == null || obs.focus === null) return false;
		const [fx, fy, fw, fh] = obs.focus.rect;
		const [tx, ty, tw, th] = t.rect;
		const dx = tx + tw / 2 - (fx + fw / 2);
		const dy = ty + th / 2 - (fy + fh / 2);
		const vertical: RemoteKey = dy > 0 ? 'DOWN' : 'UP';
		const horizontal: RemoteKey = dx > 0 ? 'RIGHT' : 'LEFT';
		const keys = Math.abs(dy) >= Math.abs(dx) ? [vertical, horizontal] : [horizontal, vertical];
		const before = focusText(obs);
		for (const key of keys) {
			const after = await this.step(key, trail, '      탐색 ');
			if (focusText(after) !== before) return true;
		}
		return false;
	}
}

const squash = (t: string): string => t.replace(/\s+/g, '').toLowerCase();

/** 참고 문서를 가리키는 괄호 "(#4.3. … 페이지 참고)"는 목적지가 아니므로 뺀다 */
const withoutReference = (t: string): string => t.replace(/\([^()]*참고[^()]*\)/g, ' ');

/**
 * 화면 전환·선택 결과 문장이 가리키는 화면: "#4.2." 같은 화면 번호, 아니면 앱 프로필의 화면 이름이 문장에 들어 있는 것
 * (가장 긴 이름, 같은 길이로 둘 이상이면 정하지 않음)
 */
function namedScreen(profile: AppProfile, raw: string, current: string): string | null {
	const text = withoutReference(raw);
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

/** "OTA 콘텐츠는 최대 5개"처럼 콜아웃 전체가 아닌 일부 종류의 개수인지 */
function subsetSubject(text: string, names: readonly string[], options: KeyMapOptions): string | null {
	const subject = /^(.+?)\s*(?:은|는)\s*최대\s*\d+\s*개/.exec(text.trim())?.[1]?.trim();
	if (subject === undefined || subject === '') return null;
	return names.some((n) => nameScore(subject, n, options) >= options.minNameScore) ? null : subject;
}

type OkCheck = { clause: Clause; check: Check; after: 'transition' | 'no-action' | 'presence' | 'focus' };

/**
 * "화면 최상단 Default 포커스 항목"의 기대 요소 (planner defaultFocusTarget). 화면설계서 Default Focus → 맨 위 목록의 첫 항목.
 * 목록 콜아웃 = 앱 요소 목록에서 항목 선택자(items)가 있는 콜아웃. 정하지 못하면 null (진입 시 포커스로 판정)
 */
function defaultFocusOf(
	ctx: Ctx,
	screen: string,
	clauseText: string
): { element: string; firstItem: boolean; basis: string } | null {
	const nav = ctx.navs.get(screen);
	if (nav === undefined) return null;
	const byNo = new Map<string, string>();
	const lists = new Set<string>();
	for (const [name, def] of Object.entries(ctx.registry.scoped(screen))) {
		const [sc, no] = (def.callout ?? '').split('#');
		if (sc !== screen || no === undefined || no === '') continue;
		byNo.set(no, name);
		if ((def.items ?? '') !== '') lists.add(no);
	}
	const dft = defaultFocusTarget(nav, clauseText, nav.defaultFocus ?? null, lists, ctx.options);
	const element = dft === null ? undefined : byNo.get(dft.no);
	return dft === null || element === undefined ? null : { element, firstItem: dft.firstItem, basis: dft.basis };
}
async function runStep(runner: Runner, c: TcCase, s: TcStep, outDir: string, trail: Trail[]): Promise<StepRun> {
	const { ctx } = runner;
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
		trail,
		screenshot: null,
		ms: Date.now() - started
	});
	if (no === null) return notRun('단계에 콜아웃 참조가 없음');
	if (ctx.profile.screens[screen] === undefined) return notRun(`앱 프로필에 ${screen} 화면 진입 경로가 없음`);
	const element = ctx.registry.callout(screen, no);
	if (element === undefined) return notRun(`앱 프로필에 ${screen} ${calloutMark(no)} 대응 요소가 없음`);

	const entryError = await runner.ensure(screen, trail);
	if (entryError !== null) return notRun(`진입 실패: ${entryError}`);
	if (!runner.shown(await runner.session.observe(), screen)) {
		const error = await runner.open(screen, trail);
		if (error !== null) return notRun(`진입 실패: ${error}`);
	}
	ctx.live.phase('화면 표시 확인 중');
	const entryObs = runner.current?.entryObs ?? (await runner.session.observe());
	const obs = await runner.session.observe();
	const t = target(obs, element);
	const title = ctx.registry.title(screen, no);
	const titleObs = title === undefined ? undefined : target(obs, title);
	const calloutNames = [element, s.targetRef?.label ?? '', ...(ctx.registry.elements[element]?.names ?? [])].filter(
		(n) => n !== ''
	);

	const clauses = splitClauses(s.expected ?? '');
	const results: CheckResult[] = [];
	const keyChecks: { clause: Clause; check: Check }[] = [];
	const okChecks: OkCheck[] = [];
	const motionChecks: { clause: Clause; check: Check }[] = [];
	const opChecks: { clause: Clause; check: Check; op: OperationPlan }[] = [];

	for (const clause of clauses) {
		// "선택 시" 묶음의 있는지·포커스 조건은 OK를 누른 뒤의 결과다
		const onSelect = /선택/.test(clause.section ?? '');
		// "선택 시 … 이동"(화면 전환), "OK … VKB 호출"(키보드)처럼 결과를 따로 보는 조건이 있으면 조작 → 결과는 그쪽으로 본다
		const covered = clause.checks.some((k) => k.kind === 'transition' || k.kind === 'keyboard');
		for (const check of clause.checks) {
			if (check.method === 'none') {
				results.push(res(clause, check, null, check.reason));
				continue;
			}
			// 조작 → 결과 문장 중 키 순서와 결과를 규칙으로 정할 수 있는 것 ("상단방향키 … 확인 버튼 선택 시 팝업 닫힘")
			const op = check.kind === 'behavior' || check.kind === 'descriptive' ? parseOperation(clause.text) : null;
			if (op !== null) {
				opChecks.push({ clause, check, op });
				continue;
			}
			if (check.method === 'ai') {
				results.push(res(clause, check, 'needs-review', 'AI 판정 대상 — 이번 실행에서는 AI를 쓰지 않음'));
				continue;
			}
			const shown = t !== undefined && t.visible > 0;
			if (onSelect && (check.kind === 'presence' || check.kind === 'focus')) {
				okChecks.push({ clause, check, after: check.kind });
				continue;
			}
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
					const subset = subsetSubject(clause.text, calloutNames, ctx.options);
					if (subset !== null) {
						results.push(
							res(clause, check, null, `"${subset}"(일부 종류)의 개수 — 화면에서 종류를 구분하지 않음`)
						);
					} else if (!shown) results.push(res(clause, check, 'fail', `${element}이(가) 보이지 않음`));
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
					const firstItem = /첫\s*번째|default/i.test(clause.text);
					const et = target(entryObs, element);
					const ok = et?.hasFocus === true && (!firstItem || et.itemCount <= 1 || et.focusItem === 0);
					results.push(
						res(
							clause,
							check,
							ok ? 'pass' : 'fail',
							ok
								? `진입 시 포커스 ${focusText(entryObs)}`
								: `진입 시 포커스가 다름: 기대 ${element}${firstItem ? '[0]' : ''} / 실제 ${focusText(entryObs)}`
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
				case 'remote':
					results.push(
						res(
							clause,
							check,
							null,
							`리모컨 전용 조작("${String(check.value)}")은 TV에서만 확인 (브라우저에는 없음)`
						)
					);
					break;
				case 'motion':
					motionChecks.push({ clause, check });
					break;
				case 'key':
					keyChecks.push({ clause, check });
					break;
				case 'transition':
					okChecks.push({ clause, check, after: 'transition' });
					break;
				case 'no-action':
					okChecks.push({ clause, check, after: 'no-action' });
					break;
				case 'behavior':
					if (!covered) results.push(res(clause, check, 'needs-review', '조작 → 결과 자동 확인은 아직 없음'));
					break;
				default:
					results.push(res(clause, check, 'needs-review', `${check.kind} 자동 확인은 아직 없음`));
			}
		}
	}

	const screenshot = `${c.sheet}-${s.row}.png`;
	await writeFile(join(outDir, screenshot), await runner.session.driver.screenshot());

	for (const { clause, check } of motionChecks)
		results.push(await checkMotion(runner, screen, no, element, t, clause, check, trail));

	// 키 동작: 목표 첫 항목에서 키 하나씩. 누른 뒤에는 키로 목표에 돌아온다 (못 돌아오면 그때만 다시 연다)
	let blocked: string | null = null;
	// 판정 기준은 TC (D-044·D-046): 이 단계의 키 동작 문장으로 기대 위치를 정한다. 화면설계서는 이름·위치·길 찾기에만
	const tcKeys: TcKeyTexts = {
		screen,
		no,
		texts: Object.fromEntries(
			keyChecks.flatMap(({ clause }) => (clause.key === null ? [] : [[clause.key, clause.text]]))
		) as TcKeyTexts['texts'],
		present: presentIn(ctx.registry, ctx.options)
	};
	for (const { clause, check } of keyChecks) {
		if (ctx.navs.get(screen) === undefined && ctx.keyMaps?.get(screen) === undefined) {
			results.push(res(clause, check, null, `${screen} 콜아웃 정보가 없어 키 동작을 비교할 수 없음`));
			continue;
		}
		if (blocked !== null) {
			results.push(res(clause, check, 'needs-review', blocked));
			continue;
		}
		const key = KEY_OF[String(check.value)];
		if (key === undefined) {
			results.push(res(clause, check, null, `모르는 키 ${String(check.value)}`));
			continue;
		}
		// 같은 화면·같은 출발(콜아웃 첫 항목)·같은 키는 결과가 같다고 보고 한 번만 실행 (이동 이력 조건은 실제 지나간 위치로 기대값을 계산)
		const cacheKey = `${screen}|${no}|${key}|${clause.text}`;
		const cached = runner.moves.get(cacheKey);
		if (cached !== undefined) {
			results.push({ ...cached, clause, check });
			record(
				trail,
				{
					key,
					focus: `앞 단계 결과 재사용 (${VERDICT_LABEL[cached.verdict ?? 'needs-review']})`,
					stable: true
				},
				'    '
			);
			continue;
		}
		const miss = await runner.reach(screen, no, trail);
		ctx.live.phase(`키 ${KEY_LABEL[key] ?? key} 동작 확인 중`);
		if (miss !== null) {
			blocked = miss.reason;
			results.push(res(clause, check, 'needs-review', miss.reason));
			continue;
		}
		const before = await runner.session.observe();
		const remembered = new Map(runner.session.remembered);
		const r = await runner.session.press(key);
		record(trail, { key, focus: focusText(r.obs), stable: r.stable }, '    ');
		const move = checkSpecMove(
			ctx.registry.scoped(screen),
			{ keyMaps: ctx.keyMaps, options: ctx.options, navs: ctx.navs, specOnly: ctx.specKeyMaps },
			before,
			key,
			r.obs,
			remembered,
			nameScope(ctx.registry, screen, before),
			tcKeys
		);
		results.push({ ...move, clause, check });
		runner.moves.set(cacheKey, move);
		if (move.verdict !== null && move.verdict !== 'pass') {
			console.log(`      [${VERDICT_LABEL[move.verdict]}] ${move.explanation}`);
		}
	}

	// 선택 시: 목표에서 OK 한 번을 누르고 결과(화면 전환·나타난 것·포커스·변화 없음)를 함께 본다
	if (okChecks.length > 0) {
		const miss = blocked !== null ? { reason: blocked, again: false } : await runner.reach(screen, no, trail);
		if (miss !== null) {
			for (const { clause, check } of okChecks) results.push(res(clause, check, 'needs-review', miss.reason));
		} else {
			ctx.live.phase('선택(OK) 결과 확인 중');
			const before = await runner.session.observe();
			const r = await runner.session.press('OK');
			record(trail, { key: 'OK', focus: focusText(r.obs), stable: r.stable }, '    ');
			// 화면 전환은 늦게 시작하거나 로딩이 끝나야 보인다: 다른 화면이 나타나거나, 포커스가 이 화면 콜아웃을 벗어나거나,
			// 포커스가 바뀔 때까지 기다린다 (바뀌면 바로 끝남, 최대 transitionWaitMs). 안 바뀌면 그대로 본다
			const otherShown = (o: Observation): boolean =>
				Object.keys(ctx.profile.screens).some(
					(sc) => sc !== screen && runner.shown(o, sc) && !runner.shown(before, sc)
				);
			const moved = (o: Observation): boolean =>
				otherShown(o) || !runner.inScreen(o, screen) || focusText(o) !== focusText(before);
			const after =
				moved(r.obs) && r.obs.focus !== null
					? r.obs
					: ((await runner.session.until(
							(o) => moved(o) && o.focus !== null && !runner.session.loading(o),
							ctx.timing.transitionWaitMs
						)) ?? (await runner.session.observe()));
			// 이 화면을 벗어났는가 (프로필에 없는 화면 — 재생·다른 시트의 상세 페이지 — 으로 간 경우)
			const left = !runner.inScreen(after, screen);
			const newlyShown = (sc: string): boolean => {
				const a = target(after, ctx.registry.detect(sc));
				const b = target(before, ctx.registry.detect(sc));
				return (
					(a?.visible ?? 0) > 0 && ((b?.visible ?? 0) === 0 || (a?.hasFocus === true && b?.hasFocus !== true))
				);
			};
			const changedTo = Object.keys(ctx.profile.screens).filter((sc) => sc !== screen && newlyShown(sc));
			for (const { clause, check, after: kind } of okChecks) {
				if (kind === 'no-action') {
					const same = focusText(before) === focusText(after) && changedTo.length === 0;
					results.push(
						res(
							clause,
							check,
							same ? 'pass' : 'fail',
							same ? 'OK를 눌러도 화면·포커스 그대로' : `OK 후 바뀜: ${focusText(after)}`
						)
					);
					continue;
				}
				if (kind === 'focus') {
					// "최상단 Default 포커스 항목" = 이 화면에 들어왔을 때의 기본 포커스
					if (!/default|최상단|기본/i.test(clause.text)) {
						results.push(
							res(
								clause,
								check,
								'needs-review',
								`OK 후 포커스 ${focusText(after)} — 어느 요소여야 하는지 정하지 못함`
							)
						);
						continue;
					}
					const dft = defaultFocusOf(ctx, screen, clause.text);
					if (dft !== null) {
						const t = target(after, dft.element);
						const ok = t?.hasFocus === true && (!dft.firstItem || t.itemCount <= 1 || t.focusItem === 0);
						const want = `${dft.element}${dft.firstItem ? '[0]' : ''}`;
						results.push(
							res(
								clause,
								check,
								ok ? 'pass' : 'fail',
								ok
									? `OK → 기본 포커스 ${want} (${dft.basis})`
									: `OK 후 포커스가 기본 위치가 아님: 기대 ${want} (${dft.basis}) / 실제 ${focusText(after)}`
							)
						);
						continue;
					}
					const want = focusText(entryObs);
					results.push(
						res(
							clause,
							check,
							focusText(after) === want ? 'pass' : 'fail',
							focusText(after) === want
								? `OK → 기본 포커스(${want})`
								: `OK 후 포커스가 기본 위치가 아님: 기대 ${want} / 실제 ${focusText(after)}`
						)
					);
					continue;
				}
				const wantScreen = namedScreen(ctx.profile, clause.text, screen);
				if (wantScreen === null && kind === 'transition' && changedTo.length === 0 && left) {
					// 문장이 가리키는 화면이 앱 프로필에 없다(다른 시트의 페이지·재생 화면). 이 화면을 벗어났는지만 코드로 확인한다
					results.push(
						res(
							clause,
							check,
							'pass',
							`OK → 이 화면을 벗어남 (포커스 ${focusText(after)}) — 도착 화면은 앱 프로필에 없어 이름은 확인하지 않음`
						)
					);
					continue;
				}
				if (wantScreen === null) {
					results.push(
						res(
							clause,
							check,
							'needs-review',
							changedTo.length > 0
								? `OK 후 ${changedTo.join(', ')} 화면으로 바뀜 — 문장이 가리키는 화면을 정하지 못해 사람 확인`
								: `OK 후 화면이 바뀌지 않음(${focusText(after)}) — 문장이 가리키는 화면을 정하지 못해 사람 확인`
						)
					);
					continue;
				}
				const ok = newlyShown(wantScreen);
				const what =
					kind === 'presence'
						? `${wantScreen} 화면(${ctx.profile.screens[wantScreen]?.names?.[0] ?? ''}) 나타남`
						: `${wantScreen} 화면`;
				results.push(
					res(
						clause,
						check,
						ok ? 'pass' : 'fail',
						ok ? `OK → ${what}` : `OK 후 ${wantScreen} 화면이 아님 (포커스 ${focusText(after)})`
					)
				);
			}
		}
	}

	for (const { clause, check, op } of opChecks) {
		const noop = keyChecks.find(({ clause: k }) => /동작\s*없음/.test(k.text))?.check.value;
		results.push(
			await checkOperation(runner, screen, no, op, noop === undefined ? null : String(noop), clause, check, trail)
		);
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
		`원본 QA와 같은 판정 ${pct(sc.agree, sc.labelled)} (확인 필요·미실행은 다른 것으로 셈)`,
		`사람이 P/F를 적은 단계 ${sc.labelled}개 — 자동 판정(Pass/Fail) ${pct(sc.decided, sc.labelled)}, 확인 필요 ${sc.review}, 미실행 ${sc.notRun}`,
		`일치율(자동 판정한 단계 중) ${pct(sc.agree, sc.decided)} · 틀린 Pass ${sc.falsePass.length} · 틀린 Fail ${sc.falseFail.length}`
	];
}

// ── 틀린 TC 검출 (mutate.ts) ───────────────────────────

interface MutationEntryLite {
	key: string;
	op: string;
	before: string;
	after: string;
}

interface Detection {
	total: number;
	caught: string[];
	missed: string[];
	undecided: string[];
	lines: string[];
}

/** 바꾼 키 조건마다: 엔진이 Fail로 잡았나(검출) / Pass로 넘겼나(놓침, 틀린 Pass) / 판정 못 했나 */
function detection(steps: readonly StepRun[], mutations: readonly MutationEntryLite[]): Detection {
	const d: Detection = { total: mutations.length, caught: [], missed: [], undecided: [], lines: [] };
	d.lines.push('| 단계 | 바꾼 조건 | 결과 | 설명 |', '|---|---|---|---|');
	for (const m of mutations) {
		const step = steps.find((x) => x.key === m.key);
		const r = step?.results.find((x) => x.kind === 'key' && x.clause === m.after);
		let mark: string;
		if (r?.verdict === 'fail') {
			d.caught.push(m.key);
			mark = '검출';
		} else if (r?.verdict === 'pass') {
			d.missed.push(m.key);
			mark = '**놓침(틀린 Pass)**';
		} else {
			d.undecided.push(m.key);
			mark = step === undefined || step.status === 'not-run' ? '미실행' : '판정 못 함';
		}
		const why = r?.explanation ?? step?.explanation ?? '실행 안 됨';
		d.lines.push(
			`| ${m.key} | ${cell(`${m.before} → ${m.after}`)} | ${mark} | ${cell(why.split('\n')[0] ?? '')} |`
		);
	}
	return d;
}

function detectionText(d: Detection): string[] {
	return [
		`틀린 TC 검출 ${pct(d.caught.length, d.total)} · 놓침(틀린 Pass) ${d.missed.length} · 판정 못 함 ${d.undecided.length}`
	];
}

async function readMutations(path: string): Promise<MutationEntryLite[]> {
	const saved = JSON.parse(await readFile(path, 'utf8')) as { format?: string; mutations?: MutationEntryLite[] };
	if (saved.format !== 'auto-qa/tc-mutations') throw new Error('바꾼 목록 파일 형식이 아님 (auto-qa/tc-mutations)');
	return saved.mutations ?? [];
}

/**
 * Pass가 아닌 단계가 어디서 막혔는지 (일치율을 올릴 곳을 층별로 본다). 판정과 무관한 집계이며,
 * 설명 글자의 정해진 문구로 나눈다 (엔진이 직접 쓰는 문구라 앱·TC와 무관)
 */
const LAYERS: { layer: string; status: StepStatus; pattern: RegExp }[] = [
	{ layer: '콜아웃 표시 없는 단계', status: 'not-run', pattern: /콜아웃 참조가 없음/ },
	{ layer: '진입 경로 없음', status: 'not-run', pattern: /진입 경로가 없음/ },
	{ layer: '요소 대응 없음', status: 'not-run', pattern: /대응 요소가 없음/ },
	{ layer: '진입 실패 (환경·데이터)', status: 'not-run', pattern: /진입 실패/ },
	{ layer: 'TV에서만 확인', status: 'needs-review', pattern: /TV에서만|실기기에서/ },
	{ layer: '검사 종류 없음', status: 'needs-review', pattern: /자동 확인은 아직 없음|motion|확인 기능이 없음/ },
	{ layer: '문장 해석 애매', status: 'needs-review', pattern: /정하지 못|사람 확인/ }
];

function layerOf(step: StepRun): string {
	if (step.status === 'pass') return 'Pass';
	if (step.status === 'fail') return 'Fail';
	return (
		LAYERS.find((l) => l.status === step.status && l.pattern.test(step.explanation))?.layer ??
		`${STATUS_LABEL[step.status]} (기타)`
	);
}

function layerText(steps: readonly StepRun[]): string[] {
	const counts = new Map<string, string[]>();
	for (const s of steps) counts.set(layerOf(s), [...(counts.get(layerOf(s)) ?? []), s.key]);
	return [...counts.entries()].map(([layer, keys]) => `${layer} ${keys.length}: ${keys.join(', ')}`);
}

// ── 리포트 ──────────────────────────────────────────────

const cell = (t: string): string => t.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

function report(
	profile: AppProfile,
	url: string,
	tcFile: string,
	steps: readonly StepRun[],
	sc: Score | null,
	det: Detection | null = null
): string {
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
	lines.push('## 막힌 곳 (층별)', '', ...layerText(steps).map((t) => `- ${t}`), '');
	if (sc !== null) lines.push('## 사람 판정과 비교', '', ...scoreText(sc).map((t) => `- ${t}`), '', ...sc.lines, '');
	if (det !== null)
		lines.push('## 틀린 TC 검출', '', ...detectionText(det).map((t) => `- ${t}`), '', ...det.lines, '');
	const review = steps.filter((s) => s.status === 'needs-review');
	if (review.length > 0) {
		// TC 파일에는 Passed + [확인 필요]로 적히므로(D-040) 사람이 볼 목록을 따로 둔다
		lines.push('## 확인 필요 (TC에는 Passed + [확인 필요])', '');
		for (const s of review) lines.push(`- ${s.key} ${s.screen} — ${cell(s.explanation.split('\n')[0] ?? '')}`);
		lines.push('');
	}
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

// ── TC 파일에 결과 쓰기 ─────────────────────────────────

/**
 * 판정 결과를 사용자가 준 TC 파일(원본)에 양식 그대로 쓴다 (D-040): P/F 열에 그 파일의 드롭다운 값,
 * 이유는 이슈 설명 열. 확인 필요는 Passed + [확인 필요] + 색. 확인한 조건이 없거나 실행하지 않은 단계는 쓰지 않는다.
 * 쓰기 전에 백업을 남긴다. 이미 값이 있는 칸은 --overwrite일 때만 덮어쓴다.
 */
async function writeResults(tcFile: string, steps: readonly StepRun[], overwrite: boolean): Promise<string> {
	const grid = await readWorkbook(tcFile);
	const profile = suggestProfile(grid);
	const cases = normalize(grid, profile).cases;
	const byKey = new Map(steps.map((s) => [s.key, s]));
	const validations = await readListValidations(tcFile);
	const lines: string[] = [];
	const writes: ResultWrite[] = [];
	let notWritten = 0;
	for (const sheetName of [...new Set(steps.map((s) => s.sheet))]) {
		const sp = profile.sheets.find((p) => p.sheet === sheetName);
		if (sp === undefined || sp.columns.result === undefined) {
			lines.push(`${sheetName}: P/F 열을 찾지 못해 쓰지 않음`);
			continue;
		}
		const results: StepResult[] = [];
		for (const c of cases.filter((x) => x.sheet === sheetName)) {
			for (const s of c.steps) {
				const run = byKey.get(`${c.sheet}!${s.row}`);
				if (run === undefined || run.status === 'not-run' || s.resultCell === null) continue;
				results.push({
					resultCell: s.resultCell,
					outcome: run.status,
					reason: run.explanation,
					checked: run.results.filter((r) => r.verdict !== null).length
				});
			}
		}
		const first = results[0]?.resultCell.address;
		const listValues = first === undefined ? null : listValuesAt(validations.get(sheetName) ?? [], first);
		const vocab = resultVocabulary(listValues);
		if (vocab === null) {
			lines.push(
				`${sheetName}: P/F 드롭다운(${(listValues ?? []).join(', ')})에 Pass·Fail에 해당하는 값이 없어 쓰지 않음`
			);
			continue;
		}
		const issue = sp.columns.issue ?? sp.columns.note ?? null;
		const plan = resultCellWrites(results, vocab, issue);
		notWritten += plan.skipped.length;
		writes.push(...plan.writes);
		lines.push(
			`${sheetName}: P/F ${sp.columns.result}열(${vocab.pass}/${vocab.fail}${vocab.source === 'list' ? ', 드롭다운' : ', 기본값'})` +
				`, 이유 ${issue === null ? '열 없음(리포트에만)' : `${issue}열`}, 단계 ${results.length - plan.skipped.length}개`
		);
	}
	const rep = await writeResultInPlace(tcFile, writes, { overwrite });
	lines.push(
		`쓴 칸 ${rep.written} · 값이 있어 건너뜀 ${rep.skipped.length}${overwrite ? '' : ' (다시 쓰려면 --overwrite)'} · 수식이라 건너뜀 ${rep.formula.length} · 확인한 조건이 없어 안 씀 ${notWritten}`
	);
	if (rep.skipped.length > 0)
		lines.push(
			`  건너뛴 칸: ${rep.skipped
				.slice(0, 10)
				.map((c) => `${c.sheet}!${c.address}`)
				.join(', ')}${rep.skipped.length > 10 ? ' …' : ''}`
		);
	lines.push(rep.backup === null ? '  바뀐 칸이 없어 파일을 그대로 둠' : `  백업: ${rep.backup}`);
	return lines.join('\n');
}

// ── main ────────────────────────────────────────────────

async function main(): Promise<void> {
	if (values.score !== undefined) {
		if (values.truth === undefined && values.mutations === undefined) {
			throw new Error('--score에는 --truth(사람이 P/F 적은 엑셀)나 --mutations(틀린 TC 바꾼 목록)가 필요합니다');
		}
		const saved = JSON.parse(await readFile(resolve(cwd, values.score), 'utf8')) as {
			format: string;
			steps: StepRun[];
		};
		if (saved.format !== RESULT_FORMAT) throw new Error(`결과 파일 형식이 아님 (${RESULT_FORMAT})`);
		console.log(layerText(saved.steps).join('\n'));
		if (values.truth !== undefined) {
			const sc = score(saved.steps, await readTruth(resolve(cwd, values.truth)));
			console.log(scoreText(sc).join('\n'));
			console.log(sc.lines.join('\n'));
		}
		if (values.mutations !== undefined) {
			const det = detection(saved.steps, await readMutations(resolve(cwd, values.mutations)));
			console.log(detectionText(det).join('\n'));
			console.log(det.lines.join('\n'));
		}
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
	const specNavs = specFiles.length === 0 ? null : await loadNavScreens(specFiles);
	if (specNavs !== null) console.log(`화면설계서 화면 ${specNavs.size}개: ${[...specNavs.keys()].join(', ')}`);

	const tcPath = resolve(cwd, tcFile);
	if (values.truth !== undefined && resolve(cwd, values.truth) === tcPath) {
		throw new Error(
			'--truth는 실행할 TC 파일과 다른 파일이어야 합니다 (결과를 TC 파일에 쓰므로, D-040). QA 결과 보고서를 주세요.'
		);
	}
	const grid = await readWorkbook(tcPath);
	const cases = normalize(grid, suggestProfile(grid)).cases;
	// 콜아웃 이름: 화면설계서 이름 + TC 단계 이름("(6) Back to Top") + 프로필 이름. TC 문장 속 이름을 콜아웃에 대응시킨다
	const navs = new Map<string, NavScreen>();
	for (const [screen, names] of calloutNameTable(profile, cases))
		navs.set(screen, withCalloutNames(specNavs?.get(screen) ?? null, screen, names));
	for (const [screen, nav] of specNavs ?? []) if (!navs.has(screen)) navs.set(screen, nav);
	// 이동 지도(길 찾기): 화면설계서 키 동작에 TC 단계의 키 동작 문장을 덮어 쓴다 (판정 기준은 TC, D-046).
	// 화면설계서에 이동 지도가 없는 화면(팝업 등)도 TC 문장으로 길을 찾는다
	const tcKeys = tcKeyTable(cases);
	const keyMaps = new Map<string, KeyAction[]>();
	const specKeyMaps = specNavs === null ? null : new Map<string, KeyAction[]>();
	for (const [screen, nav] of navs) {
		let actions = buildKeyMap(nav, options);
		if (specNavs?.has(screen) === true) specKeyMaps?.set(screen, actions);
		for (const [no, texts] of Object.entries(tcKeys.get(screen) ?? {}))
			actions = overrideKeyTexts(actions, nav, no, texts, options).actions;
		keyMaps.set(screen, actions);
	}
	addCalloutNames(registry, navs);
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
	const runId = values.run ?? `tc-${stamp}`;
	if (!isRunId(runId)) throw new Error(`--run은 tc-로 시작하는 폴더 이름이어야 합니다: ${runId}`);
	const out = join(resolve(cwd, values.out), runId);
	await mkdir(out, { recursive: true });
	const frameMs = Number(values['live-frame-ms']);
	if (!Number.isFinite(frameMs) || frameMs < 0) throw new Error('--live-frame-ms는 0 이상의 숫자(ms)입니다');

	// 사용자 UI(apps/web)가 실행 중 상황을 읽는 파일: 키 하나·하는 일이 바뀔 때마다 다시 쓴다 (live.ts)
	const steps: StepRun[] = [];
	const startedAt = new Date().toISOString();
	const planned = selected.map(([c, s]) => ({
		key: `${c.sheet}!${s.row}`,
		screen: c.specRef?.screenId ?? '',
		callout: s.targetRef?.callout ?? null,
		label: s.targetRef?.label ?? c.title ?? ''
	}));
	const url = values.url ?? profile.url;
	const live = new LiveReporter(
		out,
		() => ({
			format: PROGRESS_FORMAT,
			version: 2,
			tc: basename(tcPath),
			tcPath,
			url,
			startedAt,
			planned,
			steps
		}),
		{ ...DEFAULT_LIVE_OPTIONS, frameMs }
	);
	live.stage('preparing', '브라우저 여는 중');
	await live.flush();
	onTrail(() => live.touch());

	let completed = false;
	try {
		const { windowScale, pauseMs } = await viewOptions(values.headed, values.scale, values.slow);
		const browser = await launchBrowser({ headless: !values.headed, windowScale });
		const ctx: Ctx = {
			browser,
			profile,
			registry,
			timing: { ...DEFAULT_TIMING, ...profile.timing },
			pauseMs,
			url,
			keyMaps,
			specKeyMaps,
			navs,
			options,
			live
		};
		const runner = new Runner(ctx);
		try {
			for (const [c, s] of selected) {
				const key = `${c.sheet}!${s.row}`;
				const label = `${key} ${c.specRef?.screenId ?? ''} ${s.targetRef === null ? '' : calloutMark(s.targetRef.callout)} ${s.targetRef?.label ?? ''}`;
				console.log(`  ${label}`);
				const trail: Trail[] = [];
				live.begin(key, trail);
				const run = await runStep(runner, c, s, out, trail);
				steps.push(run);
				live.end();
				console.log(
					`    = ${STATUS_LABEL[run.status]} — ${run.explanation.split('\n')[0] ?? ''} (${(run.ms / 1000).toFixed(1)}초)`
				);
			}
		} finally {
			live.stage('writing', '앱 닫는 중');
			await runner.close();
			await browser.close();
		}
		console.log(
			`앱을 연 횟수: ${runner.opens} (남은 상태 때문에 ${runner.cleanRelaunches}) · 처음 화면으로 키로 되돌린 횟수: ${runner.resets}` +
				(runner.dynamic.size > 0
					? ` · 콘텐츠가 바뀌어 상태 비교를 뺀 화면: ${[...runner.dynamic].join(', ')}`
					: '')
		);

		live.phase('TC 파일에 결과 쓰는 중');
		console.log(
			`\nTC 파일에 결과 쓰기 (${basename(tcPath)}):\n${await writeResults(tcPath, steps, values.overwrite)}`
		);
		const sc = values.truth === undefined ? null : score(steps, await readTruth(resolve(cwd, values.truth)));
		if (sc !== null) console.log(scoreText(sc).join('\n'));
		const det =
			values.mutations === undefined
				? null
				: detection(steps, await readMutations(resolve(cwd, values.mutations)));
		if (det !== null) console.log(detectionText(det).join('\n'));
		console.log(layerText(steps).join('\n'));
		live.phase('리포트 쓰는 중');
		await writeFile(join(out, 'report.md'), report(profile, url, basename(tcPath), steps, sc, det));
		await writeFile(
			join(out, 'result.json'),
			`${JSON.stringify({ format: RESULT_FORMAT, version: 1, tc: basename(tcPath), url, steps }, null, '\t')}\n`
		);
		const count = (st: StepStatus): number => steps.filter((x) => x.status === st).length;
		console.log(
			`단계 ${steps.length}개 — Pass ${count('pass')} · Fail ${count('fail')} · 확인 필요 ${count('needs-review')} · 미실행 ${count('not-run')}`
		);
		console.log(`→ ${join(out, 'report.md')}\n→ ${tcPath}`);
		completed = true;
	} finally {
		onTrail(null);
		await live.finish(completed);
	}
}

main().catch((e: unknown) => {
	console.error(e instanceof Error ? e.message : e);
	process.exitCode = 1;
});
