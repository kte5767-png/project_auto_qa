import { pageExpression } from '@auto-qa/core';
import type { ScriptRunner } from '@auto-qa/core';

/**
 * 글자 입력란이 보여 주는 모양 (TC 입력란 조건 확인용). 판정은 하지 않는다.
 * 지금 DOM 포커스가 입력란에 있으면 그것, 아니면 화면에 보이는 첫 글자 입력란(검색 뒤 결과 화면의 검색창)을 본다.
 */
export interface FieldView {
	/** 입력란을 찾았는가 */
	found: boolean;
	/** DOM 포커스가 그 입력란에 있는가 */
	focused: boolean;
	value: string;
	/** maxlength 속성 (없으면 null) */
	maxLength: number | null;
	scrollLeft: number;
	scrollWidth: number;
	clientWidth: number;
	/** computed text-overflow */
	textOverflow: string;
}

/**
 * 페이지 안에서 실행되는 함수. 소스가 그대로 직렬화되므로 바깥 변수·import를 쓰면 안 된다.
 * 실기기 구형 엔진(webOS 5.x, Chromium 68)에서도 돌도록 ES2017 문법만 쓴다 (`?.`·`??` 금지).
 */
function fieldInPage(): FieldView {
	const TYPES = ['text', 'search', 'url', 'tel', 'email', ''];
	const isText = (el: Element | null): boolean => {
		if (el === null) return false;
		const tag = el.tagName.toLowerCase();
		if (tag === 'textarea') return true;
		if (tag !== 'input') return false;
		return TYPES.indexOf((el.getAttribute('type') || '').toLowerCase()) >= 0;
	};
	const visible = (el: Element): boolean => {
		const r = el.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return false;
		const cs = window.getComputedStyle(el);
		return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
	};
	let el: Element | null = isText(document.activeElement) ? document.activeElement : null;
	const focused = el !== null;
	if (el === null) {
		const all = Array.prototype.slice.call(document.querySelectorAll('input, textarea')) as Element[];
		for (let i = 0; i < all.length && el === null; i++) {
			const c = all[i] as Element;
			if (isText(c) && visible(c)) el = c;
		}
	}
	if (el === null) {
		return {
			found: false,
			focused: false,
			value: '',
			maxLength: null,
			scrollLeft: 0,
			scrollWidth: 0,
			clientWidth: 0,
			textOverflow: ''
		};
	}
	const input = el as HTMLInputElement;
	const max = input.getAttribute('maxlength');
	return {
		found: true,
		focused,
		value: input.value,
		maxLength: max === null || max === '' || isNaN(Number(max)) ? null : Number(max),
		scrollLeft: Math.round(input.scrollLeft),
		scrollWidth: input.scrollWidth,
		clientWidth: input.clientWidth,
		textOverflow: window.getComputedStyle(input).textOverflow
	};
}

export function fieldScript(): string {
	return pageExpression(fieldInPage, null);
}

export function readField(runner: ScriptRunner): Promise<FieldView> {
	return runner.evaluate<FieldView>(fieldScript());
}

/** 글자가 칸을 넘치는가 */
export function fieldOverflows(v: FieldView): boolean {
	return v.scrollWidth > v.clientWidth + 1;
}

/** 넘칠 때 끝(최근에 넣은 글자)이 보이게 스크롤돼 있는가 */
export function fieldShowsEnd(v: FieldView, tolerancePx = 2): boolean {
	return v.scrollLeft + v.clientWidth >= v.scrollWidth - tolerancePx;
}
