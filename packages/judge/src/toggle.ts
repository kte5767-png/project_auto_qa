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
