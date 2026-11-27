import type { Verdict } from './verdict';

/**
 * 토글 판정: "On/Off 가능". 포커스된 요소에서 OK를 눌러 상태 표시(aria·체크·클래스·글자)가 바뀌는지,
 * 한 번 더 눌러 처음 상태로 돌아오는지 본다 (돌려 놓아야 다음 단계가 같은 상태에서 시작한다).
 */

export interface ToggleSample {
	/** 포커스 요소를 가리키는 값 (상태와 무관한 것: 위치·id). 없으면 null */
	identity: string | null;
	/** 상태 표시 */
	state: string;
	text: string;
}

export interface ToggleResult {
	verdict: Verdict;
	explanation: string;
	/** 처음 상태로 돌아왔는가 */
	restored: boolean;
}

const changed = (a: ToggleSample, b: ToggleSample): boolean => a.state !== b.state || a.text !== b.text;
const label = (s: ToggleSample): string => (s.text !== '' ? `"${s.text}"` : s.state === '' ? '(표시 없음)' : s.state);

/** first: 첫 OK 뒤, second: 두 번째 OK 뒤 (첫 OK에서 포커스가 옮겨 가 누르지 않았으면 null) */
export function checkToggle(
	before: ToggleSample,
	first: ToggleSample,
	second: ToggleSample | null,
	where: string
): ToggleResult {
	if (before.identity === null || first.identity !== before.identity) {
		return {
			verdict: 'needs-review',
			explanation: `${where}: OK 뒤 포커스가 다른 곳으로 옮겨 가 토글인지 알 수 없음`,
			restored: false
		};
	}
	if (!changed(before, first)) {
		return {
			verdict: 'fail',
			explanation: `${where}: OK를 눌러도 상태가 바뀌지 않음 (${label(before)})`,
			restored: true
		};
	}
	if (second === null || second.identity !== before.identity || changed(before, second)) {
		return {
			verdict: 'needs-review',
			explanation: `${where}: OK로 바뀐 뒤(${label(before)} → ${label(first)}) 다시 OK를 눌러도 처음 상태로 돌아오지 않음`,
			restored: false
		};
	}
	return {
		verdict: 'pass',
		explanation: `${where}: OK로 상태가 바뀌고(${label(before)} → ${label(first)}) 다시 OK로 돌아옴`,
		restored: true
	};
}

export type ToggleState = 'on' | 'off';

export interface ToggleWords {
	/** 켜짐을 뜻하는 낱말 (글자·aria 값·클래스, 소문자) */
	on: string[];
	off: string[];
}

export const DEFAULT_TOGGLE_WORDS: ToggleWords = {
	on: ['on', 'true', 'active', 'checked', 'selected', 'enabled', '켜짐', '켬'],
	off: ['off', 'false', 'inactive', 'unchecked', 'unselected', 'disabled', '꺼짐', '끔']
};

const tokensOf = (s: ToggleSample): string[] =>
	`${s.text} ${s.state}`
		.toLowerCase()
		.split(/[^a-z0-9가-힣]+/)
		.filter((t) => t !== '');

/** 같은 상태 표시인가 */
export function sameToggle(a: ToggleSample, b: ToggleSample): boolean {
	return !changed(a, b);
}

/**
 * OK 전후의 서로 다른 두 상태 표시 중 어느 쪽이 켜짐인가: 한쪽에만 있는 낱말(글자 On/Off, aria-checked=true/false,
 * 클래스 on·active 등)로 정한다. 두 쪽 낱말이 엇갈리거나 없으면 null (추측하지 않음)
 */
export function toggleStates(
	a: ToggleSample,
	b: ToggleSample,
	words: ToggleWords = DEFAULT_TOGGLE_WORDS
): { a: ToggleState; b: ToggleState } | null {
	const ta = tokensOf(a);
	const tb = tokensOf(b);
	const onlyA = ta.filter((t) => !tb.includes(t));
	const onlyB = tb.filter((t) => !ta.includes(t));
	const count = (xs: readonly string[], ws: readonly string[]): number => xs.filter((t) => ws.includes(t)).length;
	const score = count(onlyA, words.on) + count(onlyB, words.off) - count(onlyA, words.off) - count(onlyB, words.on);
	if (score === 0) return null;
	return score > 0 ? { a: 'on', b: 'off' } : { a: 'off', b: 'on' };
}

/**
 * 켜고 끈 상태에 따른 결과 문장 ("Off한 경우 … 최근 검색어 영역 제공하지 않음", "Off -> On 변경 시 이전 저장된 기록이
 * 있을 경우 저장된 기록 보여줌"): 어느 상태에서, 무엇이, 보여야 하는지/없어야 하는지
 */
export interface ToggleConsequence {
	state: ToggleState;
	/** 보여야 하는가 (false: 보이지 않아야 함) */
	shown: boolean;
	/** 결과를 볼 대상 이름 (문장에서 뽑음) */
	subject: string;
	/** "이전 저장된 기록이 있을 경우": 바꾸기 전에 대상이 보였을 때만 해당 */
	ifBefore: boolean;
}

export interface ConsequenceOptions {
	/** 없어야 함 (정규식 원문) */
	hidePatterns: string[];
	/** 보여야 함 (정규식 원문, hide 다음에 본다) */
	showPatterns: string[];
	/** 바꾸기 전 상태에 기대는 조건 */
	beforePatterns: string[];
	/** 대상 앞의 위치 말 ("아래 최근 검색어 영역") */
	placeWords: string[];
}

export const DEFAULT_CONSEQUENCE_OPTIONS: ConsequenceOptions = {
	hidePatterns: ['(?:제공|노출|표시)(?:하지|되지)\\s*않', '미(?:제공|노출|표시)', '보이지\\s*않', '사라짐', '숨김'],
	showPatterns: ['보여\\s*(?:줌|준다|주며|짐|진다)', '노출', '표시', '제공'],
	beforePatterns: ['이전', '기존', '있을\\s*경우', '있으면'],
	placeWords: ['아래', '위', '하단', '상단', '좌측', '우측', '왼쪽', '오른쪽']
};

/** 상태 조건: "Off -> On 변경 시"(바뀐 뒤 상태), "Off한 경우", "On 상태에서", "끄면" */
function consequenceState(text: string): ToggleState | null {
	const change = /\b(on|off)\s*(?:->|→|에서)\s*(on|off)\b/i.exec(text);
	if (change !== null) return (change[2] ?? '').toLowerCase() === 'on' ? 'on' : 'off';
	const cond = /\b(on|off)\b\s*(?:[가-힣]{1,4}\s*)?(?:경우|때|\s시|상태)/i.exec(text);
	if (cond !== null) return (cond[1] ?? '').toLowerCase() === 'on' ? 'on' : 'off';
	if (/켜면|켠\s*경우|켰을\s*때/.test(text)) return 'on';
	if (/끄면|끈\s*경우|껐을\s*때/.test(text)) return 'off';
	return null;
}

export function parseToggleConsequence(
	text: string,
	options: ConsequenceOptions = DEFAULT_CONSEQUENCE_OPTIONS
): ToggleConsequence | null {
	const line = text.replace(/\s+/g, ' ').trim();
	const state = consequenceState(line);
	if (state === null) return null;
	// 대상은 마지막 조건(경우·때·시) 뒤, "~하더라도" 뒤에서 결과 낱말 앞까지
	const conds = [...line.matchAll(/(?:경우|때|\s시|상태에서)\s+/g)];
	const lastCond = conds[conds.length - 1];
	let rest = lastCond === undefined ? line : line.slice((lastCond.index ?? 0) + lastCond[0].length);
	rest = rest.replace(/^.*?(?:하더라도|더라도|해도|하여도)\s+/, '');
	const place = new RegExp(`^(?:${options.placeWords.join('|')})(?:의|에|쪽)?\\s+`);
	rest = rest.replace(place, '');
	const find = (patterns: readonly string[]): RegExpExecArray | null => {
		let best: RegExpExecArray | null = null;
		for (const p of patterns) {
			const m = new RegExp(p).exec(rest);
			if (m !== null && (best === null || m.index < best.index)) best = m;
		}
		return best;
	};
	const hide = find(options.hidePatterns);
	const show = hide === null ? find(options.showPatterns) : null;
	const verb = hide ?? show;
	if (verb === null) return null;
	const subject = rest
		.slice(0, verb.index)
		.replace(/(?:이|가|을|를|은|는|에|이\s*있으면)\s*$/, '')
		.trim();
	if (subject === '') return null;
	const ifBefore = options.beforePatterns.some((p) => new RegExp(p).test(line.slice(0, lastCond?.index ?? 0)));
	return { state, shown: hide === null, subject, ifBefore };
}
