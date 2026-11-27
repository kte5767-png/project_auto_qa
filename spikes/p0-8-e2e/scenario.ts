import { isRemoteKey } from '@auto-qa/core';
import type { RemoteKey } from '@auto-qa/core';
import { textValueError } from '@auto-qa/planner';

/**
 * 간단 E2E 시나리오 (사람이 쓴 실행 계획의 축소판, 설계 7.11).
 * 콜아웃 ↔ 앱 요소 대응은 사람이 지정한다. 실제 앱용 파일은 `*.local.json`으로 두고 커밋하지 않는다.
 */
export const SCENARIO_FORMAT = 'auto-qa/e2e-scenario';

export interface ElementDef {
	/** CSS 선택자 (TV 엔진에서도 되는 문법: `:has()` 금지) */
	selector: string;
	/** 이 글자를 포함하는 것만 */
	textIncludes?: string;
	/** 목록 항목 선택자 (요소 안에서) */
	items?: string;
	/** 화면설계서 콜아웃 "화면번호#콜아웃번호" (예: "4.2#1") */
	callout?: string;
	/** 화면설계서 문장에서 부르는 이름 (콜아웃이 아닌 요소·화면 밖 대상, 예: "GNB") */
	names?: string[];
	/** 포커스가 이 요소에 있을 때 화면 안으로 돌아오는 키 (예: GNB → RIGHT). 없으면 그 화면이 안 보일 때 BACK */
	exit?: RemoteKey;
}

export type EntryStep =
	| { press: RemoteKey; until?: string; max?: number; else?: RemoteKey }
	| { waitFor: string; timeoutMs?: number }
	| { waitFocus: true; timeoutMs?: number }
	/**
	 * 글자 입력 (D-043 ①): 포커스된 입력란에 넣는다. 값은 글자 그대로, `@no-result`, `@over-limit:N`, `@data:이름`
	 * (`@auto-qa/planner` resolveTextValue). replace 기본 true(기존 글자를 지움), submit 기본 false(확인 안 보냄).
	 * seed는 무작위 글자의 seed (프로필은 화면 번호를 넣는다)
	 */
	| { type: string; replace?: boolean; submit?: boolean; seed?: string };

export type CheckDef =
	/** 포커스: 요소 이름, 또는 "@spec"(화면설계서 이동 지도로 계산). item = 몇 번째 항목(0부터) */
	| { focus: string; item?: number; clause?: string }
	/** 바뀔 수 있는 글자: 그 자리에 글자가 있는지만 (D-036 ②) */
	| { present: string; clause?: string }
	/** 항목 개수 상한 */
	| { count: string; max: number; clause?: string }
	/** 정해진 문구: 글자 그대로 (UX 문장에 적힌 문구이거나 사람이 "정확히 비교"로 지정한 것) */
	| { text: string; equals: string; clause?: string }
	/** 화면으로 확인하지 않는 조건 (D-037: Pass를 막지 않고 설명에 적는다) */
	| { unchecked: string };

export interface StepDef {
	id: string;
	title: string;
	keys: RemoteKey[];
	/** TC 기대 결과 원문 (참고용) */
	expected?: string;
	checks: CheckDef[];
}

export interface Timing {
	/** 앱 준비·요소 기다리기 최대 시간 (ms) */
	readyTimeoutMs: number;
	/** 조건 확인 간격 (ms) */
	pollMs: number;
	/** 화면 밖으로 나간 포커스를 되돌릴 때 누를 키 수 상한 (BACK·exit 키) */
	maxReturnKeys: number;
	/** 이동 지도에 길이 없을 때 방향으로 찾아갈 키 수 상한 (목표 지향 탐색) */
	maxSearchKeys: number;
	/** 처음 화면으로 되돌릴 때 누를 키 수 상한 (넘으면 앱을 다시 연다, D-039) */
	maxResetKeys: number;
	/** 포커스 없는 층(종료 토스트 등)이 사라지기를 기다리는 최대 시간 (ms) */
	toastWaitMs: number;
}

export const DEFAULT_TIMING: Timing = {
	readyTimeoutMs: 20000,
	pollMs: 200,
	maxReturnKeys: 3,
	maxSearchKeys: 10,
	maxResetKeys: 12,
	toastWaitMs: 4000
};

export interface Scenario {
	format: typeof SCENARIO_FORMAT;
	version: 1;
	name: string;
	url: string;
	/** CSS 클래스 방식 가상 포커스면 그 선택자. 없으면 document.activeElement */
	focusSelector?: string | null;
	/** 화면설계서 이름 ↔ 문장 속 이름 (예: { "Recommended Keywords": ["추천 검색어"] }) */
	aliases?: Record<string, string[]>;
	elements: Record<string, ElementDef>;
	entry: EntryStep[];
	steps: StepDef[];
	/** 글자 입력 `@data:이름`의 값 (앱 데이터를 알아야 하는 값) */
	testData?: Record<string, string>;
	timing?: Partial<Timing>;
}

const CALLOUT_REF = /^([^#\s]+)#(\S+)$/;

export function parseCalloutRef(ref: string): { screen: string; no: string } | null {
	const m = CALLOUT_REF.exec(ref);
	return m === null ? null : { screen: m[1] ?? '', no: m[2] ?? '' };
}

/** 형식 오류 목록. 빈 배열이면 정상 */
export function validateScenario(data: unknown): string[] {
	const errors: string[] = [];
	if (typeof data !== 'object' || data === null) return ['최상위 값이 객체가 아님'];
	const s = data as Partial<Scenario>;
	if (s.format !== SCENARIO_FORMAT) errors.push(`format은 "${SCENARIO_FORMAT}"이어야 함`);
	if (typeof s.url !== 'string' || s.url === '') errors.push('url 없음');
	const elements = s.elements ?? {};
	const known = (name: string, where: string): void => {
		if (!(name in elements)) errors.push(`${where}: 요소 "${name}"가 elements에 없음`);
	};
	for (const [name, e] of Object.entries(elements)) {
		if (typeof e.selector !== 'string' || e.selector === '') errors.push(`elements.${name}: selector 없음`);
		if (e.selector.includes(':has(')) errors.push(`elements.${name}: :has()는 TV 엔진에서 안 됨`);
		if (e.callout !== undefined && parseCalloutRef(e.callout) === null)
			errors.push(`elements.${name}: callout은 "4.2#1" 형식`);
	}
	(s.entry ?? []).forEach((step, i) => {
		const where = `entry[${i}]`;
		if ('press' in step) {
			if (!isRemoteKey(step.press)) errors.push(`${where}: 모르는 키 ${String(step.press)}`);
			if (step.else !== undefined && !isRemoteKey(step.else))
				errors.push(`${where}: 모르는 키 ${String(step.else)}`);
			if (step.until !== undefined) known(step.until, where);
		} else if ('waitFor' in step) known(step.waitFor, where);
		else if ('type' in step) {
			const error = typeof step.type === 'string' ? textValueError(step.type) : '글자가 아님';
			if (error !== null) errors.push(`${where}: ${error}`);
		}
	});
	(s.steps ?? []).forEach((step, i) => {
		const where = `steps[${i}] (${step.id})`;
		for (const k of step.keys) if (!isRemoteKey(k)) errors.push(`${where}: 모르는 키 ${k}`);
		for (const c of step.checks) {
			if ('focus' in c && c.focus !== '@spec') known(c.focus, where);
			if ('present' in c) known(c.present, where);
			if ('count' in c) known(c.count, where);
			if ('text' in c) known(c.text, where);
		}
	});
	return errors;
}
