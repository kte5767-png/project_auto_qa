import { pageExpression } from '@auto-qa/core';
import type { ScriptRunner } from '@auto-qa/core';

/**
 * 포커스된 요소 안에서 칸을 넘치는 글자가 움직이는지(Marquee) 재는 값. 판정은 하지 않는다 — 두 번 재서
 * `compareMotion`으로 비교한다. 움직임 = 넘치는 칸 안 글자 묶음(Range)의 가로 위치 변화.
 * 스크롤(scrollLeft), 안쪽 요소의 transform·margin, text-indent 중 어느 방식으로 움직여도 같은 값으로 잡힌다.
 */
export interface MotionSample {
	/** 포커스 요소가 있는가 */
	focused: boolean;
	/** 포커스 요소 안에서 글자가 칸을 넘치는 요소 수 */
	overflowing: number;
	/** 넘치는 요소마다 글자 묶음의 왼쪽 - 칸의 왼쪽 (px, 소수 첫째 자리) */
	positions: number[];
}

interface MotionInput {
	/** 포커스 요소를 찾는 선택자 (CSS 클래스 방식). null이면 document.activeElement */
	focusSelector: string | null;
	/** 볼 요소 수 상한 */
	max: number;
}

/**
 * 페이지 안에서 실행되는 함수. 소스가 그대로 직렬화되므로 바깥 변수·import를 쓰면 안 된다.
 * 실기기 구형 엔진(webOS 5.x, Chromium 68)에서도 돌도록 ES2017 문법만 쓴다 (`?.`·`??` 금지).
 */
function motionInPage(input: MotionInput): MotionSample {
	let focusEl: Element | null;
	if (input.focusSelector !== null) {
		const found = document.querySelectorAll(input.focusSelector);
		focusEl = found.length === 1 ? (found[0] as Element) : null;
	} else {
		const a = document.activeElement;
		focusEl = a === null || a === document.body || a === document.documentElement ? null : a;
	}
	if (focusEl === null) return { focused: false, overflowing: 0, positions: [] };
	const all = [focusEl].concat(Array.prototype.slice.call(focusEl.querySelectorAll('*')) as Element[]);
	const positions: number[] = [];
	for (let i = 0; i < all.length && positions.length < input.max; i++) {
		const el = all[i] as Element;
		if (!(el instanceof HTMLElement)) continue;
		if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) continue;
		const text = (el.textContent === null ? '' : el.textContent).replace(/\s+/g, ' ').trim();
		if (text === '') continue;
		const range = document.createRange();
		range.selectNodeContents(el);
		const left = range.getBoundingClientRect().left - el.getBoundingClientRect().left;
		positions.push(Math.round(left * 10) / 10);
	}
	return { focused: true, overflowing: positions.length, positions };
}

export function motionScript(focusSelector: string | null, max = 20): string {
	return pageExpression(motionInPage, { focusSelector, max });
}

export function sampleMotion(runner: ScriptRunner, focusSelector: string | null): Promise<MotionSample> {
	return runner.evaluate<MotionSample>(motionScript(focusSelector));
}

/**
 * 두 번 잰 값 비교: 넘치는 글자가 없으면 'none'(Marquee를 확인할 수 없음), 하나라도 minPx 이상 움직였으면 'moved',
 * 아니면 'still'. 요소 수가 달라지면(다시 그려짐) 움직인 것으로 본다
 */
export function compareMotion(a: MotionSample, b: MotionSample, minPx = 2): 'moved' | 'still' | 'none' {
	if (a.overflowing === 0 && b.overflowing === 0) return 'none';
	if (a.positions.length !== b.positions.length) return 'moved';
	return a.positions.some((p, i) => Math.abs(p - (b.positions[i] ?? p)) >= minPx) ? 'moved' : 'still';
}
