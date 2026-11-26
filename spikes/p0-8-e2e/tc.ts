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
import { nextResetStep, sameFingerprint, takeFingerprint } from '@auto-qa/focus';
import type { Observation, ScreenFingerprint } from '@auto-qa/focus';
import {
	VERDICT_LABEL,
	aggregateStep,
	checkExactText,
	checkMaxCount,
	checkPresence,
	splitClauses
} from '@auto-qa/judge';
import type { Check, CheckResult, Clause, StepVerdict, Verdict } from '@auto-qa/judge';
import { DEFAULT_KEYMAP_OPTIONS, DEFAULT_ROUTE_OPTIONS, nameScore, planRoute } from '@auto-qa/planner';
import type { KeyAction, KeyMapOptions } from '@auto-qa/planner';
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
import { PROFILE_FORMAT, buildRegistry, calloutMark, entryPath, resetConfig, validateProfile } from './profile';
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
		/** 사람이 P/F 열에 결과를 적은 엑셀 (QA 결과 보고서 등, 실행할 TC 파일과 다른 파일) */
		truth: { type: 'string' },
		/** TC 파일에 이미 값이 있는 P/F·이유 칸도 덮어쓴다 (다시 검수할 때) */
		overwrite: { type: 'boolean', default: false }
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

// ── 화면 세션: 같은 화면 단계는 앱을 한 번만 연다 ──────────

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

interface ScreenSession {
	screen: string;
	session: Session;
	/** 그 화면에 막 들어왔을 때의 관찰 (진입 시 포커스 확인용) */
	entryObs: Observation;
	opened: number;
}

/** 열려 있는 앱: 드라이버 하나를 계속 쓰고, 처음 화면 지문을 기억한다 (D-039) */
interface AppSession {
	driver: BrowserDriver;
	home: ScreenFingerprint;
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

class Runner {
	current: ScreenSession | null = null;
	app: AppSession | null = null;
	/** 앱을 연 횟수 (처음 + 되돌리기 실패로 다시 연 횟수) */
	opens = 0;
	/** 처음 화면으로 키로 되돌린 횟수 */
	resets = 0;
	readonly reset: ReturnType<typeof resetConfig>;

	constructor(readonly ctx: Ctx) {
		this.reset = resetConfig(ctx.profile);
	}

	async close(): Promise<void> {
		this.current = null;
		if (this.app !== null) await this.app.driver.close();
		this.app = null;
	}

	/** 앱을 새로 열고(새 브라우저 컨텍스트라 저장 상태도 새로) 준비되면 처음 화면 지문을 기억한다 */
	private async launch(trail: Trail[]): Promise<string | null> {
		await this.close();
		const { ctx } = this;
		this.opens++;
		const driver = await BrowserDriver.open(ctx.browser, ctx.url);
		const probe = this.probe(driver);
		// 스플래시·스켈레톤이 끝나고 포커스가 자리 잡은 뒤의 화면을 처음 화면으로 기억한다
		const ready = await probe.settle(ctx.timing.readyTimeoutMs);
		if (!ready.settled) {
			await driver.close();
			return '앱이 준비되지 않음 (포커스가 없거나 로딩 표시가 사라지지 않음)';
		}
		const home = await takeFingerprint(driver, this.reset.fingerprint);
		this.app = { driver, home };
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
		const app = this.app;
		if (app === null) return this.launch(trail);
		const { ctx } = this;
		const state = { top: 0 };
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
					record(trail, { key: null, focus: step.reason, stable: true }, '      처음으로 ');
				}
				return null;
			}
			if (step.kind === 'relaunch' || i === ctx.timing.maxResetKeys) {
				const why =
					step.kind === 'relaunch' ? step.reason : `키 ${ctx.timing.maxResetKeys}번 안에 처음 화면에 못 옴`;
				record(trail, { key: null, focus: `다시 열기 (${why})`, stable: true }, '      처음으로 ');
				return this.launch(trail);
			}
			if (step.kind !== 'press') continue;
			await app.driver.pressKey(step.key);
			const st = await app.driver.waitForStable();
			await this.probe(app.driver).settle(ctx.timing.readyTimeoutMs);
			// 팝업(종료 팝업)을 닫았거나 BACK에 화면이 그대로면 최상위에 닿은 것
			const noEffect = step.key === this.reset.rules.backKey && sameFingerprint(now, await take());
			if (step.closes === 'popup' || noEffect) state.top++;
			record(
				trail,
				{
					key: step.key,
					focus: noEffect ? `${step.reason} (반응 없음 → 최상위)` : step.reason,
					stable: st.stable
				},
				'      처음으로 '
			);
		}
		return this.launch(trail);
	}

	/** 그 화면까지 간다: 앱이 없으면 열고, 있으면 처음 화면으로 되돌린 뒤 진입 경로를 따라간다 (앱을 다시 열지 않음) */
	async open(screen: string, trail: Trail[]): Promise<string | null> {
		const { ctx } = this;
		this.current = null;
		const ready = this.app === null ? await this.launch(trail) : await this.resetHome(trail);
		if (ready !== null || this.app === null) return ready ?? '앱을 열지 못함';
		const session = this.newSession(screen);
		let error = await runEntry(session, entryPath(ctx.profile, ctx.registry, screen), trail);
		if (error === null) {
			const shown = await session.until((o) => this.shown(o, screen), ctx.timing.readyTimeoutMs);
			if (shown === null) error = `${screen} 화면 표시(detect)가 보이지 않음`;
		}
		if (error !== null) return error;
		this.current = { screen, session, entryObs: await session.observe(), opened: this.opens };
		return null;
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
				this.current = { screen, session, entryObs: cur.entryObs, opened: cur.opened };
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

	/**
	 * 화면 밖으로 나간 포커스를 화면 안으로 되돌린다: 그 화면이 안 보이거나 다른 화면(팝업 등)에 포커스가 있으면 BACK,
	 * 포커스가 공통 요소(GNB 등)에 있으면 그 요소의 exit 키. 앱을 다시 열지 않는다.
	 * in = 화면 콜아웃에 포커스, shown = 화면은 보이고 포커스는 콜아웃 밖(방향 탐색으로 갈 수 있음), lost = 되돌리지 못함
	 */
	async returnInto(screen: string, trail: Trail[]): Promise<'in' | 'shown' | 'lost'> {
		for (let i = 0; i <= this.ctx.timing.maxReturnKeys; i++) {
			let obs = await this.session.observe();
			if (this.inScreen(obs, screen)) return 'in';
			if (obs.focus === null && this.shown(obs, screen)) {
				// 화면 전환 중이면 포커스가 생길 때까지 기다린다
				obs = (await this.session.until((o) => o.focus !== null, 3000)) ?? obs;
				if (this.inScreen(obs, screen)) return 'in';
			}
			if (i === this.ctx.timing.maxReturnKeys) break;
			const inOther = Object.keys(this.ctx.profile.screens).some(
				(sc) =>
					sc !== screen &&
					target(obs, this.ctx.registry.detect(sc))?.hasFocus === true &&
					!this.sameDetect(sc, screen)
			);
			let key: RemoteKey | null = null;
			if (!this.shown(obs, screen) || inOther) key = 'BACK';
			else {
				for (const [name, e] of Object.entries(this.ctx.profile.elements ?? {})) {
					if (e.exit !== undefined && target(obs, name)?.hasFocus === true) key = e.exit;
				}
			}
			if (key === null) return obs.focus !== null && this.shown(obs, screen) ? 'shown' : 'lost';
			const r = await this.session.press(key);
			record(trail, { key, focus: focusText(r.obs), stable: r.stable }, '      돌아오기 ');
		}
		return 'lost';
	}

	/** 목표 콜아웃 첫 항목으로: 키로 돌아오기 → 이동 지도 길 → (없으면) 방향 탐색 → 안 되면 앱 다시 열기 */
	async reach(screen: string, no: string, trail: Trail[]): Promise<Miss | null> {
		const first = await this.tryReach(screen, no, trail);
		if (first === null || !first.again) return first;
		record(trail, { key: null, focus: `처음 화면부터 다시 (${first.reason})`, stable: true }, '      ');
		const error = await this.open(screen, trail);
		if (error !== null) return { reason: `처음 화면부터 다시 가지 못함: ${error}`, again: false };
		return this.tryReach(screen, no, trail);
	}

	/**
	 * 목표 첫 항목에 갈 때까지 반복: 콜아웃에 있으면 이동 지도로 길을 계산해 따라가고, 길이 없거나 콜아웃 밖이면
	 * 목표 쪽 방향키 한 번(목표 지향 탐색, D-024), 목록 안이면 "이전" 키로 첫 항목까지. 같은 자리를 다시 만나면 멈춘다.
	 */
	private async tryReach(screen: string, no: string, trail: Trail[]): Promise<Miss | null> {
		const { ctx } = this;
		const name = ctx.registry.callout(screen, no) ?? '';
		const at = (o: Observation): boolean => {
			const t = target(o, name);
			return t?.hasFocus === true && (t.itemCount <= 1 || t.focusItem === 0);
		};
		const where = await this.returnInto(screen, trail);
		if (where === 'lost') return { reason: `포커스를 ${screen} 화면으로 되돌리지 못함`, again: true };
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
		return { reason: why, again: where === 'shown' };
	}

	private async step(key: RemoteKey, trail: Trail[], label: string): Promise<Observation> {
		const r = await this.session.press(key);
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

async function runStep(runner: Runner, c: TcCase, s: TcStep, outDir: string): Promise<StepRun> {
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
	const trail: Trail[] = [];
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
	if ((await runner.returnInto(screen, trail)) === 'lost') {
		const error = await runner.open(screen, trail);
		if (error !== null) return notRun(`진입 실패: ${error}`);
	}
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

	// 키 동작: 목표 첫 항목에서 키 하나씩. 누른 뒤에는 키로 목표에 돌아온다 (못 돌아오면 그때만 다시 연다)
	let blocked: string | null = null;
	for (const { clause, check } of keyChecks) {
		if (ctx.keyMaps?.get(screen) === undefined) {
			results.push(res(clause, check, null, `화면설계서에 ${screen} 이동 지도가 없어 키 동작을 비교할 수 없음`));
			continue;
		}
		if (blocked !== null) {
			results.push(res(clause, check, 'needs-review', blocked));
			continue;
		}
		const miss = await runner.reach(screen, no, trail);
		if (miss !== null) {
			blocked = miss.reason;
			results.push(res(clause, check, 'needs-review', miss.reason));
			continue;
		}
		const key = KEY_OF[String(check.value)];
		if (key === undefined) {
			results.push(res(clause, check, null, `모르는 키 ${String(check.value)}`));
			continue;
		}
		const before = await runner.session.observe();
		const remembered = new Map(runner.session.remembered);
		const r = await runner.session.press(key);
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
			const before = await runner.session.observe();
			const r = await runner.session.press('OK');
			record(trail, { key: 'OK', focus: focusText(r.obs), stable: r.stable }, '    ');
			// 화면 전환은 로딩이 끝나야 보이므로 다른 화면이 나타날 때까지 조금 기다린다
			const settled =
				(await runner.session.until(
					(o) =>
						Object.keys(ctx.profile.screens).some(
							(sc) => sc !== screen && runner.shown(o, sc) && !runner.shown(before, sc)
						) || o.focus !== null,
					ctx.timing.readyTimeoutMs
				)) ?? r.obs;
			const after = settled;
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
	if (values.truth !== undefined && resolve(cwd, values.truth) === tcPath) {
		throw new Error(
			'--truth는 실행할 TC 파일과 다른 파일이어야 합니다 (결과를 TC 파일에 쓰므로, D-040). QA 결과 보고서를 주세요.'
		);
	}
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
	const runner = new Runner(ctx);
	try {
		for (const [c, s] of selected) {
			const label = `${c.sheet}!${s.row} ${c.specRef?.screenId ?? ''} ${s.targetRef === null ? '' : calloutMark(s.targetRef.callout)} ${s.targetRef?.label ?? ''}`;
			console.log(`  ${label}`);
			const run = await runStep(runner, c, s, out);
			steps.push(run);
			console.log(
				`    = ${STATUS_LABEL[run.status]} — ${run.explanation.split('\n')[0] ?? ''} (${(run.ms / 1000).toFixed(1)}초)`
			);
		}
	} finally {
		await runner.close();
		await browser.close();
	}
	console.log(`앱을 연 횟수: ${runner.opens} · 처음 화면으로 키로 되돌린 횟수: ${runner.resets}`);

	console.log(`\nTC 파일에 결과 쓰기 (${basename(tcPath)}):\n${await writeResults(tcPath, steps, values.overwrite)}`);
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
	console.log(`→ ${join(out, 'report.md')}\n→ ${tcPath}`);
}

main().catch((e: unknown) => {
	console.error(e instanceof Error ? e.message : e);
	process.exitCode = 1;
});
