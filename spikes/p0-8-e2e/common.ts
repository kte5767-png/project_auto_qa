/**
 * 브라우저 E2E·TC 실행 공용: 리모컨 키 입력·관찰 세션, 진입 경로, 화면설계서 이동 판정.
 * 드라이버 인터페이스만 쓰므로 실기기 드라이버에서도 같은 흐름이 돈다 (D-027).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fitWindowScale, probeScreen } from '@auto-qa/browser';
import { TextInputError } from '@auto-qa/core';
import type { Driver, RemoteKey } from '@auto-qa/core';
import { analyzeExport, parseExport } from '@auto-qa/figma';
import type { NormalizedFrame } from '@auto-qa/figma';
import { observeTargets } from '@auto-qa/focus';
import type { Observation, ObserveTarget, ObservedTarget } from '@auto-qa/focus';
import type { Check, CheckKind, CheckResult, Verdict } from '@auto-qa/judge';
import {
	buildKeyMap,
	describeEffect,
	expectAfterKey,
	expectedItemIndex,
	matchByName,
	navScreenFromSpec,
	overrideKeyTexts,
	resolveAbsentCondition,
	resolveTextValue
} from '@auto-qa/planner';
import type { KeyAction, KeyMapOptions, NavScreen } from '@auto-qa/planner';
import { extractSpecScreen, mergeSpecScreens } from '@auto-qa/spec';
import type { SpecKey, SpecScreen } from '@auto-qa/spec';
import { parseCalloutRef } from './scenario';
import type { ElementDef, EntryStep, Timing } from './scenario';

export const SPEC_KEY: Partial<Record<RemoteKey, SpecKey>> = {
	UP: 'up',
	DOWN: 'down',
	LEFT: 'left',
	RIGHT: 'right',
	OK: 'ok',
	BACK: 'back'
};
export const KEY_LABEL: Record<RemoteKey, string> = {
	UP: '▲',
	DOWN: '▼',
	LEFT: '◀',
	RIGHT: '▶',
	OK: 'OK',
	BACK: 'Back',
	HOME: 'Home'
};

// ── 입력 ────────────────────────────────────────────────

export async function jsonFiles(paths: readonly string[], cwd: string): Promise<string[]> {
	const out: string[] = [];
	for (const p of paths) {
		const full = resolve(cwd, p);
		if ((await stat(full)).isDirectory()) {
			for (const f of (await readdir(full)).sort()) if (f.endsWith('.json')) out.push(join(full, f));
		} else out.push(full);
	}
	return out;
}

/** 화면설계서 내보내기 → 화면 번호별 이동 지도 입력 (콜아웃 이름·위치·목업 글자·키 동작 문장) */
export async function loadNavScreens(paths: readonly string[]): Promise<Map<string, NavScreen>> {
	// 나눠 내보낸 파일(-p01of18…)을 한 폴더에서 읽는다. 같은 프레임을 다시 내보냈으면 나중 파일(이름순)을 쓴다
	const frames = new Map<string, NormalizedFrame>();
	for (const f of paths) {
		for (const a of analyzeExport(parseExport(JSON.parse(await readFile(f, 'utf8'))))) {
			if (a.kind === 'spec') frames.set(a.frame.id, a.frame);
		}
	}
	const specs: SpecScreen[] = [...frames.values()].map((frame) => extractSpecScreen(frame));
	const navs = new Map<string, NavScreen>();
	for (const merged of mergeSpecScreens(specs)) {
		const screen = navScreenFromSpec(merged, frames);
		if (screen.screenId !== null) navs.set(screen.screenId, screen);
	}
	return navs;
}

/** 화면설계서 내보내기 → 화면 번호별 이동 지도 */
export async function loadKeyMaps(paths: readonly string[], options: KeyMapOptions): Promise<Map<string, KeyAction[]>> {
	const maps = new Map<string, KeyAction[]>();
	for (const [id, screen] of await loadNavScreens(paths)) maps.set(id, buildKeyMap(screen, options));
	return maps;
}

// ── 실행 ────────────────────────────────────────────────

export function observeTargetsOf(elements: Record<string, ElementDef>): ObserveTarget[] {
	return Object.entries(elements).map(([name, e]) => ({
		name,
		selector: e.selector,
		textIncludes: e.textIncludes ?? null,
		items: e.items ?? null
	}));
}

export interface Trail {
	key: RemoteKey | null;
	focus: string;
	stable: boolean;
	/** 키가 아닌 동작 (예: 글자 입력). 있으면 키 대신 이것을 보여 준다 */
	action?: string;
}

/** 로그·리포트에 쓰는 한 칸: 키 이름, 동작, 또는 대기 */
export function trailLabel(t: Trail, idle = '(대기)'): string {
	return t.action ?? (t.key === null ? idle : KEY_LABEL[t.key]);
}

/** 넣은 글자를 로그에 보이는 길이로 */
export function shownText(text: string, max = 24): string {
	return text.length <= max ? `"${text}"` : `"${text.slice(0, max)}…" (${text.length}자)`;
}

/** 로딩 표시(스피너·스켈레톤 등). 보이는 동안은 화면이 준비되지 않은 것으로 본다. 프로필 `loading`으로 바꾼다 */
export const DEFAULT_LOADING_SELECTOR =
	'[class*="Spinner"], [class*="spinner"], [class*="Skeleton"], [class*="skeleton"], [aria-busy="true"]';

const LOADING = '@loading';

/**
 * 앱 상태를 바꿀 수 있는 동작(OK 선택, 글자 입력 확인)을 드라이버별로 센다 (D-043 ②). 방향키·BACK은 상태를 남기지 않는다고 본다.
 * 0이면 앱을 연 뒤 아직 아무것도 고르지 않은 깨끗한 상태
 */
const stateChanges = new WeakMap<Driver, number>();

export function markStateChange(driver: Driver): void {
	stateChanges.set(driver, (stateChanges.get(driver) ?? 0) + 1);
}

export function stateChangeCount(driver: Driver): number {
	return stateChanges.get(driver) ?? 0;
}

export class Session {
	private readonly targets: ObserveTarget[];
	/** 화면설계서 콜아웃이 아닌 공통 요소(GNB 등) 이름 */
	readonly common: ReadonlySet<string>;
	/** 요소별 마지막 포커스 항목 (화면설계서 "이동한 이력이 있을 경우") */
	readonly remembered = new Map<string, number>();

	constructor(
		readonly driver: Driver,
		elements: Record<string, ElementDef>,
		readonly focusSelector: string | null,
		readonly timing: Timing,
		/** 키마다 사람이 볼 수 있게 멈추는 시간 (판정과 무관) */
		readonly pauseMs: number,
		loadingSelector: string | null = DEFAULT_LOADING_SELECTOR
	) {
		this.targets = observeTargetsOf(elements);
		this.common = new Set(
			Object.entries(elements)
				.filter(([, e]) => e.callout === undefined)
				.map(([name]) => name)
		);
		if (loadingSelector !== null && loadingSelector !== '') {
			this.targets.push({ name: LOADING, selector: loadingSelector, textIncludes: null, items: null });
		}
	}

	/** 로딩 표시가 보이는가 */
	loading(obs: Observation): boolean {
		return (target(obs, LOADING)?.visible ?? 0) > 0;
	}

	/**
	 * 화면이 자리 잡을 때까지 기다린다: 로딩 표시가 없고, 포커스가 있고, 두 번 연달아 본 포커스가 같을 때.
	 * 페이지 이동(OK·BACK) 뒤 로딩 화면에서 다음 키를 누르지 않게 한다. 고정 sleep이 아니라 조건 대기
	 */
	async settle(timeoutMs: number): Promise<{ obs: Observation; settled: boolean }> {
		const end = Date.now() + timeoutMs;
		let prev: string | null = null;
		for (;;) {
			await this.driver.waitForStable();
			const obs = await this.observe();
			const f = obs.focus;
			const key = this.loading(obs) || f === null ? null : `${focusText(obs)}@${f.rect.join(',')}`;
			if (key !== null && key === prev) return { obs, settled: true };
			prev = key;
			if (Date.now() >= end) return { obs, settled: false };
			await new Promise((r) => setTimeout(r, this.timing.pollMs));
		}
	}

	async observe(): Promise<Observation> {
		const obs = await observeTargets(this.driver, this.targets, {
			focusSelector: this.focusSelector
		});
		for (const t of obs.targets) if (t.hasFocus && t.focusItem >= 0) this.remembered.set(t.name, t.focusItem);
		return obs;
	}

	/** 이 세션에서 누른 키 수 (진입 직후인지 보는 데 쓴다) */
	presses = 0;

	/**
	 * 키 하나 + 안정화 대기. show = 사람이 볼 확인 키(headed에서 멈춤). 진입·길·홈 되돌리기 키는 멈추지 않는다
	 */
	async press(key: RemoteKey, show = true): Promise<{ obs: Observation; stable: boolean }> {
		this.presses++;
		if (key === 'OK') markStateChange(this.driver);
		await this.driver.pressKey(key);
		const s = await this.driver.waitForStable();
		let obs = await this.observe();
		let stable = s.stable;
		// 화면이 바뀌는 키(OK·BACK)이거나 포커스가 사라졌거나 로딩 중이면 자리 잡을 때까지 기다린다
		const navigates = key === 'OK' || key === 'BACK';
		if (navigates || obs.focus === null || this.loading(obs)) {
			const settled = await this.settle(this.timing.readyTimeoutMs);
			obs = settled.obs;
			stable = stable && settled.settled;
		}
		// 사람이 볼 수 있게 멈춤 (headed). 화면이 바뀌는 키는 결과 화면을 볼 수 있게 두 배
		const pause = !show ? 0 : navigates ? this.pauseMs * 2 : this.pauseMs;
		if (pause > 0) await new Promise((r) => setTimeout(r, pause));
		return { obs, stable };
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

export const target = (obs: Observation, name: string): ObservedTarget | undefined =>
	obs.targets.find((t) => t.name === name);

/** 포커스를 요소 이름으로 (가장 안쪽 = 항목 순번이 있는 것 우선) */
export function focusText(obs: Observation): string {
	const inside = obs.targets.filter((t) => t.hasFocus && !t.name.startsWith('@'));
	if (inside.length > 0) {
		return inside
			.map((t) => (t.focusItem >= 0 && t.itemCount > 1 ? `${t.name}[${t.focusItem}]` : t.name))
			.join(' > ');
	}
	if (obs.focus === null) return '(포커스 없음)';
	const f = obs.focus;
	return `${f.tag}${f.spotlightId === null ? '' : `#${f.spotlightId}`} "${f.text.slice(0, 30)}"`;
}

/** 기록이 늘 때 부르는 곳 (사용자 UI 실시간 표시용, 판정과 무관). 실행 스크립트가 하나만 정한다 */
let trailListener: (() => void) | null = null;

export function onTrail(listener: (() => void) | null): void {
	trailListener = listener;
}

export function record(trail: Trail[], t: Trail, indent = '  진입 '): void {
	trail.push(t);
	console.log(`${indent}${trailLabel(t)} → ${t.focus}${t.stable ? '' : ' (안정화 시간 초과)'}`);
	trailListener?.();
}

/** 로그 없이 기록만 (홈 되돌리기처럼 로그에는 한 줄로 요약하는 키) */
export function note(trail: Trail[], t: Trail): void {
	trail.push(t);
	trailListener?.();
}

export async function runEntry(
	session: Session,
	entry: readonly EntryStep[],
	trail: Trail[],
	testData: Readonly<Record<string, string>> = {}
): Promise<string | null> {
	for (const step of entry) {
		if ('type' in step) {
			const error = await typeEntry(session, step, trail, testData);
			if (error !== null) return error;
		} else if ('waitFocus' in step) {
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
				const r = await session.press(step.press, false);
				record(trail, { key: step.press, focus: focusText(r.obs), stable: r.stable });
				continue;
			}
			const reached = (o: Observation): boolean => target(o, goal)?.hasFocus === true;
			const start = await session.observe();
			if (reached(start)) continue;
			// 시작할 때 포커스가 있던 공통 요소(예: GNB). 키를 눌러 그 밖으로 나가면 헛돌지 않고 바로 멈춘다.
			// 화면 안 콜아웃에서 시작했으면 다른 콜아웃을 지나 목표로 가는 것이 정상이라 멈추지 않는다
			// (예: 최근 검색어가 있으면 검색창 ▼가 최근 검색어를 거쳐 추천 검색어로 간다)
			const startIn = start.targets.filter((t) => t.hasFocus && session.common.has(t.name)).map((t) => t.name);
			const max = step.max ?? 5;
			let done = false;
			for (const [key, times] of [
				[step.press, max],
				...(step.else === undefined ? [] : [[step.else, max * 2] as const])
			] as const) {
				for (let i = 0; i < times && !done; i++) {
					const r = await session.press(key, false);
					record(trail, { key, focus: focusText(r.obs), stable: r.stable });
					done = reached(r.obs);
					if (!done && startIn.length > 0 && !startIn.some((n) => target(r.obs, n)?.hasFocus === true)) {
						return `${KEY_LABEL[key]} 후 포커스가 ${startIn.join('·')} 밖으로 나감 (${focusText(r.obs)})`;
					}
				}
				if (done) break;
			}
			if (!done) return `${KEY_LABEL[step.press]}로 "${goal}"에 가지 못함`;
		}
	}
	return null;
}

/** 진입 경로의 글자 입력 (D-043 ①). 확인(submit)을 보내면 화면이 바뀌므로 자리 잡을 때까지 기다린다 */
async function typeEntry(
	session: Session,
	step: Extract<EntryStep, { type: string }>,
	trail: Trail[],
	testData: Readonly<Record<string, string>>
): Promise<string | null> {
	const resolved = resolveTextValue(step.type, { seed: step.seed ?? 'entry', data: testData });
	if ('error' in resolved) return `글자 입력 값: ${resolved.error}`;
	const submit = step.submit ?? false;
	let value: string;
	if (submit) markStateChange(session.driver);
	try {
		value = (await session.driver.typeText(resolved.value, { replace: step.replace ?? true, submit })).value;
	} catch (error) {
		if (error instanceof TextInputError) return error.message;
		throw error;
	}
	const settled = submit
		? await session.settle(session.timing.readyTimeoutMs)
		: { obs: await session.observe(), settled: (await session.driver.waitForStable()).stable };
	const cut = value === resolved.value ? '' : ` → 입력란 ${shownText(value)}`;
	record(trail, {
		key: null,
		action: `글자 입력 ${shownText(resolved.value)}${cut}${submit ? ' + 확인' : ''}`,
		focus: focusText(settled.obs),
		stable: settled.settled
	});
	return null;
}

// ── 판정 ────────────────────────────────────────────────

export const result = (
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

export interface SpecContext {
	keyMaps: Map<string, KeyAction[]> | null;
	options: KeyMapOptions;
	/** 콜아웃 이름(화면설계서 + TC·프로필)·위치. 있으면 TC 문장으로 키 동작을 다시 해석할 수 있다 (D-046) */
	navs?: ReadonlyMap<string, NavScreen>;
	/**
	 * 화면설계서 문장만으로 만든 이동 지도 (keyMaps에 TC 문장을 덮어 썼을 때, 화면설계서와 다른 곳을 설명에 남기는 데만 쓴다).
	 * null이면 화면설계서가 없음
	 */
	specOnly?: ReadonlyMap<string, KeyAction[]> | null;
}

/** 확인하는 TC 단계의 키 동작 문장 (판정 기준, D-044·D-046): 그 화면·콜아웃에서 누른 키에만 쓴다 */
export interface TcKeyTexts {
	screen: string;
	no: string;
	texts: Partial<Record<SpecKey, string>>;
	/**
	 * TC "X가 없을 경우 Y"의 X가 누르기 전 화면에 보이는가 (모르면 null → 조건을 고르지 않음).
	 * 없으면 판정에서 조건을 쓰지 않는다
	 */
	present?: (name: string, obs: Observation) => boolean | null;
}

/**
 * 키 한 번의 이동을 화면설계서 이동 지도로 확인.
 * nameScope: 콜아웃 번호가 아닌 이름("추천 검색어", "GNB")으로 가리킨 대상을 찾을 요소. 기본은 elements이고,
 * 앞 화면 위에 영역이 더해진 화면(4.3)에서는 화면에 함께 보이는 앞 화면의 콜아웃을 더해 준다
 */
export function checkSpecMove(
	elements: Record<string, ElementDef>,
	spec: SpecContext,
	before: Observation,
	key: RemoteKey,
	after: Observation,
	remembered: ReadonlyMap<string, number>,
	nameScope: Record<string, ElementDef> = elements,
	tc: TcKeyTexts | null = null
): CheckResult {
	const label = `[${KEY_LABEL[key]}] ${tc === null ? '화면설계서' : 'TC'} 이동`;
	const specKey = SPEC_KEY[key];
	if (specKey === undefined) return result(label, 'key', null, `${KEY_LABEL[key]} 키는 이동 지도에 없음`);
	if (spec.keyMaps === null && (tc === null || spec.navs === undefined))
		return result(label, 'key', null, '화면설계서가 주어지지 않음 (--spec)');

	const entries = Object.entries(elements);
	const from = entries.find(([name, e]) => e.callout !== undefined && target(before, name)?.hasFocus === true);
	if (from === undefined) {
		return result(label, 'key', null, `누르기 전 포커스(${focusText(before)})가 콜아웃과 대응된 요소에 없음`);
	}
	const [fromName, fromDef] = from;
	const ref = parseCalloutRef(fromDef.callout ?? '');
	let actions = ref === null ? undefined : spec.keyMaps?.get(ref.screen);
	// 판정 기준은 TC: 확인하는 콜아웃에서 누른 키면 TC 문장으로 다시 해석해 바꿔 끼운다. 화면설계서와 다르면 설명에 남긴다
	let basisName = '화면설계서';
	let specNote = '';
	let conditionNote = '';
	const nav = ref === null ? undefined : spec.navs?.get(ref.screen);
	if (ref !== null && tc !== null && tc.screen === ref.screen && tc.no === ref.no && nav !== undefined) {
		// "X가 없을 경우 Y": 누르기 전 화면에 X가 있는지로 문장 하나를 고른다
		const texts: Partial<Record<SpecKey, string>> = {};
		for (const [k, t] of Object.entries(tc.texts) as [SpecKey, string][]) {
			const r = resolveAbsentCondition(t, (name) => tc.present?.(name, before) ?? null);
			texts[k] = r.text;
			if (k === specKey && r.note !== null) conditionNote = ` (${r.note})`;
		}
		const o = overrideKeyTexts(actions ?? [], nav, ref.no, texts, spec.options);
		const mine = o.tc[specKey];
		if (mine !== undefined) {
			actions = o.actions;
			basisName = 'TC';
			const old =
				spec.specOnly === undefined
					? o.spec[specKey]
					: spec.specOnly?.get(ref.screen)?.find((a) => a.from === ref.no && a.key === specKey);
			if (spec.specOnly === null) specNote = '';
			else if (old === undefined) specNote = ' — 화면설계서에는 이 키 동작이 없음';
			else if (describeEffect(old.effect) !== describeEffect(mine.effect))
				specNote = ` — 화면설계서는 "${old.text}"`;
		}
	}
	specNote = `${conditionNote}${specNote}`;
	if (ref === null || actions === undefined) {
		return result(label, 'key', null, `화면설계서에 ${ref?.screen ?? '?'} 화면이 없음`);
	}
	const prev = target(before, fromName);
	const position =
		prev !== undefined && prev.focusItem >= 0 && prev.itemCount > 1
			? { index: prev.focusItem, count: prev.itemCount }
			: null;
	const exp = expectAfterKey(actions, ref.no, specKey, position);
	const clause = `${ref.screen} ${basisName === 'TC' ? 'TC ' : ''}${exp.basis}`;
	if (!exp.ok) return result(clause, 'key', null, `${exp.reason}${specNote}`);

	let want: [string, ElementDef] | undefined;
	if (exp.target.kind === 'same') want = from;
	else if (exp.target.kind === 'callout') {
		const no = exp.target.no;
		want = entries.find(([, e]) => e.callout === `${ref.screen}#${no}`);
		if (want === undefined) return result(clause, 'key', null, `${ref.screen} ${no}번 콜아웃에 대응된 요소가 없음`);
	} else {
		const name = exp.target.kind === 'element' ? exp.target.name : exp.target.to;
		// 이름으로 가리킨 이동 대상은 누르기 전 요소 자신이 아니다 (그 자리에 남는 것은 "동작 없음").
		// 4.4 팝업 "Search Option"의 "[▲] "Option" 버튼"은 팝업을 연 4.2 ⑤ "Search Option 메뉴"다 (Search!34)
		const scope = Object.entries(nameScope).filter(([n]) => n !== fromName);
		const m = matchByName(name, scope, ([n, e]) => [n, ...(e.names ?? [])], spec.options);
		if (m !== null) want = m.match;
		else {
			// 요소 이름이 아니면 화면에 보이는 목록 항목 글자에서 찾는다 ("[►] "Driving" 카테고리에 포커스" → 카테고리 목록의 "Driving 1")
			const hit = itemByText(name, before, Object.entries(nameScope));
			if (hit === null) return result(clause, 'key', null, `"${name}"에 대응된 요소가 없음`);
			const [itemOwner, found, itemText] = hit;
			const got = target(after, itemOwner[0]);
			// 같은 목록의 항목 이름은 TC를 쓸 때 데이터의 예시다. 같은 목록이면 키 방향의 옆 항목으로 보고 이름 차이는 설명에 남긴다
			const sameList = itemOwner[0] === fromName && prev !== undefined && prev.focusItem >= 0;
			const delta = specKey === 'right' || specKey === 'down' ? 1 : -1;
			const itemIndex = sameList ? (prev?.focusItem ?? 0) + delta : found;
			const gotText = got === undefined ? '' : (got.itemTexts[got.focusItem] ?? '');
			const nameNote = !sameList
				? `항목 "${itemText}"`
				: itemIndex === found
					? `옆 항목 "${itemText}"`
					: `옆 항목 — TC 예시 이름 "${name}"은 이 데이터에서 ${found + 1}번째 "${itemText}", 실제 옆 항목 "${gotText}"`;
			const ok = got?.hasFocus === true && got.focusItem === itemIndex;
			const wantText = `${itemOwner[0]}[${itemIndex}]${sameList ? '' : ` "${itemText}"`}`;
			const actual = focusText(after);
			return ok
				? result(
						clause,
						'key',
						'pass',
						`${KEY_LABEL[key]} → ${actual} (${basisName}대로, ${nameNote}${specNote})`,
						itemOwner[0]
					)
				: result(
						clause,
						'key',
						'fail',
						`${KEY_LABEL[key]} 후 포커스가 ${basisName}와 다름: 기대 ${wantText} / 실제 ${actual} (${nameNote})${specNote}`
					);
		}
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
	// 그리드의 아래·위 줄 항목: 몇 번째인지는 줄 폭을 알아야 하므로, 같은 목록 안에서 포커스가 그 방향 줄로 갔는지 본다
	const row = exp.item === 'below' || exp.item === 'above' ? exp.item : null;
	const fromY = before.focus?.rect[1] ?? null;
	const toY = after.focus?.rect[1] ?? null;
	const rowOk =
		row === null || (fromY !== null && toY !== null && (row === 'below' ? toY > fromY + 1 : toY < fromY - 1));
	const wantText = `${wantName}${index === null ? (row === null ? '' : ` ${row === 'below' ? '아래' : '위'} 줄`) : `[${index}]`}`;
	const ok = got?.hasFocus === true && (index === null || got.focusItem === index) && rowOk;
	const actual = focusText(after);
	if (exp.estimated) {
		return result(
			clause,
			'key',
			'needs-review',
			`키 방향으로 추정한 대상 ${wantText} / 실제 ${actual} — 사람 확인 필요${specNote}`
		);
	}
	return ok
		? result(clause, 'key', 'pass', `${KEY_LABEL[key]} → ${actual} (${basisName}대로${specNote})`, wantName)
		: result(
				clause,
				'key',
				'fail',
				`${KEY_LABEL[key]} 후 포커스가 ${basisName}와 다름: 기대 ${wantText} / 실제 ${actual}${specNote}`
			);
}

/**
 * 이름이 화면에 보이는 목록 항목 글자 하나에만 들어 있으면 그 항목 (요소, 순번, 글자). 낱말이 모두 들어 있어야 하고
 * (대소문자·띄어쓰기 무시), 여러 항목에 맞으면 null (추측하지 않음)
 */
export function itemByText(
	name: string,
	obs: Observation,
	scope: readonly [string, ElementDef][]
): [[string, ElementDef], number, string] | null {
	const words = name
		.toLowerCase()
		.split(/[^0-9a-z가-힣]+/)
		.filter((w) => w !== '');
	if (words.length === 0) return null;
	const hits: [[string, ElementDef], number, string][] = [];
	for (const entry of scope) {
		const t = target(obs, entry[0]);
		if (t === undefined || t.visible === 0 || t.itemCount <= 1) continue;
		t.itemTexts.forEach((text, i) => {
			const have = text
				.toLowerCase()
				.split(/[^0-9a-z가-힣]+/)
				.filter((w) => w !== '');
			if (words.every((w) => have.includes(w))) hits.push([entry, i, text]);
		});
	}
	return hits.length === 1 ? (hits[0] ?? null) : null;
}

// ── 보기 옵션 ───────────────────────────────────────────

/**
 * --headed일 때 창 배율(모니터에 1920×1080이 다 보이게)과 키마다 멈춤(보기용, 판정과 무관).
 * headless면 배율 없음·멈춤 0.
 */
export async function viewOptions(
	headed: boolean,
	scale: string,
	slow: string | undefined
): Promise<{ windowScale: number | undefined; pauseMs: number }> {
	let windowScale: number | undefined;
	if (headed) {
		if (scale === 'auto') {
			const screen = await probeScreen();
			windowScale = fitWindowScale(screen) ?? undefined;
			console.log(
				`창 배율 ${windowScale ?? '그대로'} (모니터 ${screen.availWidth}×${screen.availHeight}, 시스템 배율 ${screen.dpr})`
			);
		} else {
			windowScale = Number(scale);
			if (!(windowScale > 0)) throw new Error(`--scale은 양수 또는 auto: ${scale}`);
		}
	}
	const pauseMs = slow === undefined ? (headed ? 800 : 0) : Number(slow);
	if (!(pauseMs >= 0)) throw new Error(`--slow는 0 이상의 ms: ${String(slow)}`);
	return { windowScale, pauseMs };
}

/** "X 미노출"의 X: 없어야 하는 말과 괄호 보충을 뺀 나머지 */
export function absenceSubject(text: string): string {
	return text
		.replace(/\([^()]*\)/g, ' ')
		.replace(/(?:미노출|미제공|노출(?:되지|하지)\s*않\S*|제공(?:되지|하지)\s*않\S*)[\s\S]*$/, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
