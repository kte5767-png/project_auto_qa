import { isRemoteKey } from '@auto-qa/core';
import type { ElementDef, EntryStep, Timing } from './scenario';

/**
 * 앱 프로필 (TC 실행용): 화면설계서 화면마다 그 화면까지 가는 길과, 콜아웃 ↔ 앱 요소 대응.
 * 사람이 정해 승인하는 값이다 (설계 7.11 ②, D-024). 실제 앱용은 `*.local.json`으로 두고 커밋하지 않는다.
 */
export const PROFILE_FORMAT = 'auto-qa/app-profile';

export interface CalloutDef extends ElementDef {
	/** 리포트에 쓸 이름 (없으면 TC의 콜아웃 이름) */
	name?: string;
	/** 콜아웃 안 "타이틀" 요소 선택자 ("표시 내용: 타이틀" 확인용) */
	title?: string;
}

export interface ScreenDef {
	/** 화면 전환 문장에서 이 화면을 부르는 이름 (예: "검색 결과") */
	names?: string[];
	/** 이 화면이 떠 있는지 볼 선택자 */
	detect: string;
	/** 먼저 이 화면까지 간 뒤 entry를 이어서 한다 */
	from?: string;
	/** 요소 이름: 공통 요소 이름, "#N"(이 화면의 N번 콜아웃), "4.2#5"(다른 화면의 콜아웃) */
	entry: EntryStep[];
	callouts: Record<string, CalloutDef>;
}

export interface AppProfile {
	format: typeof PROFILE_FORMAT;
	version: 1;
	name: string;
	url: string;
	focusSelector?: string | null;
	/** 화면설계서 이름 ↔ 문장 속 이름 */
	aliases?: Record<string, string[]>;
	timing?: Partial<Timing>;
	/** 화면 밖 대상 등 공통 요소 (예: GNB) */
	elements?: Record<string, ElementDef>;
	screens: Record<string, ScreenDef>;
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

export function calloutMark(no: string): string {
	const n = Number(no);
	return Number.isInteger(n) && n >= 1 && n <= 20 ? (CIRCLED[n - 1] ?? no) : `(${no})`;
}

/** 관찰할 요소 전체 (공통 + 화면별 콜아웃·타이틀·화면 표시). 이름이 @로 시작하면 포커스 표시에서 뺀다 */
export interface ElementRegistry {
	elements: Record<string, ElementDef>;
	callout(screen: string, no: string): string | undefined;
	title(screen: string, no: string): string | undefined;
	detect(screen: string): string;
	/** 공통 요소 + 이 화면의 콜아웃만 (화면설계서 이동 판정에서 다른 화면의 같은 요소와 섞이지 않게) */
	scoped(screen: string): Record<string, ElementDef>;
	/** 그 화면에서 관찰할 요소: 진입 경로 화면들의 scoped + 모든 화면 표시(@, 화면 전환 확인용) + 그 화면 콜아웃의 타이틀 */
	forScreen(screen: string): Record<string, ElementDef>;
	/** entry의 "#N"(이 화면 N번 콜아웃)·"4.2#5"(다른 화면 콜아웃)를 요소 이름으로 */
	resolve(screen: string, name: string): string;
}

export function buildRegistry(profile: AppProfile): ElementRegistry {
	const elements: Record<string, ElementDef> = { ...(profile.elements ?? {}) };
	const callouts = new Map<string, string>();
	const titles = new Map<string, string>();
	for (const [screen, def] of Object.entries(profile.screens)) {
		elements[`@${screen} 화면`] = { selector: def.detect };
		for (const [no, c] of Object.entries(def.callouts)) {
			const name = `${screen} ${calloutMark(no)} ${c.name ?? ''}`.trim();
			const { title, name: label, ...element } = c;
			elements[name] = {
				...element,
				callout: `${screen}#${no}`,
				names: [...(label === undefined ? [] : [label]), ...(c.names ?? [])]
			};
			callouts.set(`${screen}#${no}`, name);
			if (title !== undefined) {
				elements[`${name} 타이틀`] = { selector: title };
				titles.set(`${screen}#${no}`, `${name} 타이틀`);
			}
		}
	}
	const registryScoped = (screen: string): Record<string, ElementDef> =>
		Object.fromEntries(
			Object.entries(elements).filter(([name, e]) => {
				if (name.startsWith('@')) return false;
				if (e.callout === undefined) return ![...titles.values()].includes(name);
				return e.callout.startsWith(`${screen}#`);
			})
		);
	return {
		elements,
		callout: (screen, no) => callouts.get(`${screen}#${no}`),
		title: (screen, no) => titles.get(`${screen}#${no}`),
		detect: (screen) => `@${screen} 화면`,
		scoped: registryScoped,
		forScreen: (screen) => {
			const out: Record<string, ElementDef> = {};
			for (const [name, e] of Object.entries(elements)) {
				if (name.startsWith('@')) out[name] = e;
			}
			for (const [key, name] of titles) {
				const e = elements[name];
				if (key.startsWith(`${screen}#`) && e !== undefined) out[name] = e;
			}
			// 진입 경로가 거치는 화면(from)의 콜아웃도 관찰해야 진입 단계를 확인할 수 있다
			const chain: string[] = [];
			for (
				let sc: string | undefined = screen;
				sc !== undefined && !chain.includes(sc);
				sc = profile.screens[sc]?.from
			) {
				chain.unshift(sc);
			}
			return Object.assign(out, ...chain.map(registryScoped)) as Record<string, ElementDef>;
		},
		resolve: (screen, name) => {
			if (name.startsWith('#')) return callouts.get(`${screen}${name}`) ?? name;
			if (/^\S+#\S+$/.test(name)) return callouts.get(name) ?? name;
			return name;
		}
	};
}

/** 화면까지 가는 전체 진입 경로 (from을 따라 이어 붙이고, "#N"을 요소 이름으로) */
export function entryPath(profile: AppProfile, registry: ElementRegistry, screen: string): EntryStep[] {
	const chain: string[] = [];
	for (let s: string | undefined = screen; s !== undefined; s = profile.screens[s]?.from) {
		if (chain.includes(s)) throw new Error(`진입 경로가 순환함: ${[...chain, s].join(' → ')}`);
		chain.unshift(s);
	}
	return chain.flatMap((s) =>
		(profile.screens[s]?.entry ?? []).map((step): EntryStep => {
			if ('press' in step) {
				return step.until === undefined ? step : { ...step, until: registry.resolve(s, step.until) };
			}
			if ('waitFor' in step) return { ...step, waitFor: registry.resolve(s, step.waitFor) };
			return step;
		})
	);
}

export function validateProfile(data: unknown): string[] {
	const errors: string[] = [];
	if (typeof data !== 'object' || data === null) return ['최상위 값이 객체가 아님'];
	const p = data as Partial<AppProfile>;
	if (p.format !== PROFILE_FORMAT) errors.push(`format은 "${PROFILE_FORMAT}"이어야 함`);
	if (typeof p.url !== 'string' || p.url === '') errors.push('url 없음');
	if (typeof p.screens !== 'object' || p.screens === null) return [...errors, 'screens 없음'];
	const profile = p as AppProfile;
	const registry = buildRegistry(profile);
	for (const [name, e] of Object.entries(profile.elements ?? {})) {
		if (e.exit !== undefined && !isRemoteKey(e.exit))
			errors.push(`elements.${name}: 모르는 exit 키 ${String(e.exit)}`);
	}
	for (const [screen, def] of Object.entries(profile.screens)) {
		const where = `screens.${screen}`;
		if (typeof def.detect !== 'string' || def.detect === '') errors.push(`${where}: detect 없음`);
		if (def.from !== undefined && !(def.from in profile.screens))
			errors.push(`${where}: from 화면 ${def.from} 없음`);
		for (const [no, c] of Object.entries(def.callouts)) {
			if (typeof c.selector !== 'string' || c.selector === '')
				errors.push(`${where}.callouts.${no}: selector 없음`);
			else if (c.selector.includes(':has(')) errors.push(`${where}.callouts.${no}: :has()는 TV 엔진에서 안 됨`);
		}
		const known = (name: string, at: string): void => {
			if (!(registry.resolve(screen, name) in registry.elements)) errors.push(`${at}: 요소 "${name}" 없음`);
		};
		def.entry.forEach((step, i) => {
			const at = `${where}.entry[${i}]`;
			if ('press' in step) {
				if (!isRemoteKey(step.press)) errors.push(`${at}: 모르는 키 ${String(step.press)}`);
				if (step.else !== undefined && !isRemoteKey(step.else))
					errors.push(`${at}: 모르는 키 ${String(step.else)}`);
				if (step.until !== undefined) known(step.until, at);
			} else if ('waitFor' in step) known(step.waitFor, at);
		});
	}
	return errors;
}
