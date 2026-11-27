/**
 * 자동 프로필 (D-043 ③④ "손 매핑 없이"): 사람이 정한 씨앗(앱 주소·첫 화면까지 가는 길·공통 요소·되돌리기·테스트 데이터)만 두고,
 * 나머지 화면의 진입 경로는 화면 이동 지도에서, 콜아웃 선택자는 자동 연결에서, 화면 표시(detect)는 화면끼리 비교해서 만든다.
 * `tc.ts --auto`가 첫 화면부터 이동 지도를 따라 들어가며 채운다. 여기 함수는 순수 함수다.
 * 만든 프로필은 초안이다 (사람이 승인, D-024). 회사 앱 선택자가 들어가므로 out/ 아래 *.local.json으로만 둔다
 */
import { isAncestorNode } from '@auto-qa/focus';
import type { DomSnapshot } from '@auto-qa/focus';
import { chooseDetect } from '@auto-qa/planner';
import type { AppScreenLink, DetectChoice, ScreenEdge, ScreenGraph } from '@auto-qa/planner';
import { draftCallouts } from './linkReport';
import type { AppProfile, ScreenDef } from './profile';
import type { EntryStep } from './scenario';

export interface AutoOptions {
	/** "결과가 없을 경우"처럼 결과 없는 검색으로 가는 조건 (정규식 원문) */
	noResultWords: string;
	/** 글자 입력 후 확인으로 가는 이동에 넣을 testData 이름 */
	queryKey: string;
	/** 화면 표시 후보로 볼 포커스 묶음의 최소 넓이 (화면 비율) */
	panelAreaRatio: number;
}

export const DEFAULT_AUTO_OPTIONS: AutoOptions = {
	noResultWords: '없을|없는|없음|않을|않는',
	queryKey: 'query',
	panelAreaRatio: 0.3
};

/**
 * 씨앗: 화면설계서 밖에서 정해야 하는 것만 남긴다. 콜아웃에 대응된 공통 요소(사람이 손으로 이은 것)와
 * 이름 대응(aliases), 화면 정의는 뺀다
 */
export function seedOf(profile: AppProfile): AppProfile {
	const elements = Object.fromEntries(
		Object.entries(profile.elements ?? {}).filter(([, e]) => e.callout === undefined)
	);
	const rest: AppProfile = { ...profile, elements, screens: {} };
	delete rest.aliases;
	return rest;
}

/** 검색어: testData에 있으면 그것, 없으면 씨앗 진입 경로에서 확인까지 보낸 글자 (그대로 쓴 값만) */
export function seedQuery(profile: AppProfile, options: AutoOptions = DEFAULT_AUTO_OPTIONS): string | null {
	const given = profile.testData?.[options.queryKey];
	if (given !== undefined) return given;
	for (const def of Object.values(profile.screens)) {
		for (const step of def.entry) {
			if ('type' in step && step.submit === true && !step.type.startsWith('@')) return step.type;
		}
	}
	return null;
}

/**
 * 이동 하나 → 진입 단계. 문장이 글자 입력을 말하고(“검색어 입력된 결과 페이지”, “입력 후 확인”) 앞 화면에 입력란 콜아웃이
 * 있으면 입력란에 글자를 넣고 확인한다 (결과 없음 조건이면 `@no-result`, 아니면 testData 검색어). 아니면 그 콜아웃에서 OK.
 * 못 만들면 이유
 */
export function edgeEntry(
	edge: ScreenEdge,
	at: { inputCallout: string | null; hasQuery: boolean },
	options: AutoOptions = DEFAULT_AUTO_OPTIONS
): EntryStep[] | string {
	const noResult = edge.condition !== null && new RegExp(options.noResultWords).test(edge.condition);
	const typing = edge.typed || edge.action === 'submit';
	if (typing && at.inputCallout !== null && (noResult || at.hasQuery)) {
		return [
			{ focus: `${edge.from}#${at.inputCallout}` },
			{ type: noResult ? '@no-result' : `@data:${options.queryKey}`, submit: true }
		];
	}
	if (noResult) return '결과 없음 화면으로 가려면 글자를 넣을 입력란이 필요한데 앞 화면에서 찾지 못함';
	if (edge.action === 'select') return [{ focus: `${edge.from}#${edge.callout}` }, { press: 'OK' }];
	return at.hasQuery
		? '글자 입력 후 확인으로 가는 이동인데 앞 화면에서 입력란을 찾지 못함'
		: `글자 입력 후 확인으로 가는 이동인데 넣을 검색어(testData.${options.queryKey})가 없음`;
}

/** 입력란 콜아웃: 고른 요소 안에 글자 입력 요소(input·textarea)가 있는 첫 콜아웃 */
export function inputCallout(link: AppScreenLink, snapshot: DomSnapshot): string | null {
	const inputs = snapshot.nodes.filter((n) => n.tag === 'input' || n.tag === 'textarea' || n.role === 'textbox');
	for (const c of link.callouts) {
		const best = c.best;
		if (best === null || c.selector === null || !c.selector.unique) continue;
		if (inputs.some((n) => best.nodes.some((b) => b === n.i || isAncestorNode(snapshot, b, n.i)))) return c.no;
	}
	return null;
}

export interface AutoPlanItem {
	screen: string;
	from: string | null;
	/** 씨앗 진입 (auto면 앞 화면을 읽은 뒤 edgeEntry로 만든다) */
	entry: EntryStep[];
	/** auto: 이동 지도로 만든 진입, seed: 사람이 준 진입 (첫 화면, 또는 이동 지도로 못 가는 화면) */
	source: 'auto' | 'seed';
	edge: ScreenEdge | null;
	note: string;
}

/**
 * 진입 계획: 씨앗 프로필의 첫 화면(from 없음)에서 이동 지도를 따라 넓이 우선으로. 이동 지도로 못 가는 프로필 화면은
 * 앞 화면이 계획에 있으면 프로필의 진입을 쓴다 (몇 개가 씨앗인지 리포트에 센다)
 */
export function planAutoEntries(graph: ScreenGraph, profile: AppProfile): AutoPlanItem[] {
	const plan: AutoPlanItem[] = [];
	const planned = new Set<string>();
	for (const [id, def] of Object.entries(profile.screens)) {
		if (def.from !== undefined) continue;
		plan.push({ screen: id, from: null, entry: def.entry, source: 'seed', edge: null, note: '첫 화면 (씨앗)' });
		planned.add(id);
	}
	for (let head = 0; head < plan.length; head++) {
		const cur = plan[head]?.screen ?? '';
		for (const e of graph.edges) {
			if (e.from !== cur || planned.has(e.to)) continue;
			plan.push({
				screen: e.to,
				from: cur,
				entry: [],
				source: 'auto',
				edge: e,
				note: `${e.from}#${e.callout} ${e.action === 'submit' ? '글자 확인' : 'OK'} (${e.how}${e.derived ? ', 가족 조건' : ''})`
			});
			planned.add(e.to);
		}
	}
	for (let changed = true; changed;) {
		changed = false;
		for (const [id, def] of Object.entries(profile.screens)) {
			if (planned.has(id) || def.from === undefined || !planned.has(def.from)) continue;
			plan.push({
				screen: id,
				from: def.from,
				entry: def.entry,
				source: 'seed',
				edge: null,
				note: '이동 지도로 못 가 프로필 진입을 씀'
			});
			planned.add(id);
			changed = true;
		}
	}
	return plan;
}

/** 화면 표시 후보: 그 화면 콜아웃의 자동 선택자(하나로 좁혀지고 안정적인 것), 다음으로 화면 대부분을 덮는 포커스 묶음 */
export function detectCandidates(
	link: AppScreenLink,
	snapshot: DomSnapshot,
	options: AutoOptions = DEFAULT_AUTO_OPTIONS
): string[] {
	const out: string[] = [];
	for (const c of link.callouts) {
		const s = c.selector;
		if (s !== null && s.unique && s.stable && !out.includes(s.selector)) out.push(s.selector);
	}
	const screenArea = snapshot.viewport.width * snapshot.viewport.height;
	for (const n of snapshot.nodes) {
		if (n.spotlightId === null || /(^|[-_])\d+$/.test(n.spotlightId)) continue;
		if (n.rect.width * n.rect.height < screenArea * options.panelAreaRatio) continue;
		const css = `[data-spotlight-id="${n.spotlightId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
		if (!out.includes(css)) out.push(css);
	}
	return out;
}

/** 화면마다 표시 선택자 (다른 화면 스냅숏과 비교) */
export function chooseDetects(
	snapshots: ReadonlyMap<string, DomSnapshot>,
	links: ReadonlyMap<string, AppScreenLink>,
	options: AutoOptions = DEFAULT_AUTO_OPTIONS
): Map<string, DetectChoice | null> {
	const out = new Map<string, DetectChoice | null>();
	for (const [id, snap] of snapshots) {
		const link = links.get(id);
		const others = new Map([...snapshots].filter(([o]) => o !== id));
		out.set(id, link === undefined ? null : chooseDetect(snap, others, detectCandidates(link, snap, options)));
	}
	return out;
}

/** 자동 프로필 화면 하나 */
export function autoScreen(
	item: AutoPlanItem,
	detect: string,
	link: AppScreenLink | undefined,
	title: string | null
): ScreenDef {
	return {
		...(title === null ? {} : { names: [title] }),
		detect,
		...(item.from === null ? {} : { from: item.from }),
		entry: item.entry,
		callouts: link === undefined ? {} : (draftCallouts([link])[item.screen] ?? {})
	};
}
