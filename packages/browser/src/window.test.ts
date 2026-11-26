import { describe, expect, it } from 'vitest';
import { fitWindowScale } from './window';

describe('fitWindowScale', () => {
	it('Windows 150% 노트북(1920×1080, 작업 표시줄 48px): 1920×1080 화면이 다 보이게 줄인다', () => {
		expect(fitWindowScale({ availWidth: 1280, availHeight: 688, dpr: 1.5 })).toBe(0.85);
	});

	it('시스템 배율 그대로 다 보이면 바꾸지 않는다', () => {
		expect(fitWindowScale({ availWidth: 2560, availHeight: 1400, dpr: 1 })).toBeNull();
		expect(fitWindowScale({ availWidth: 2560, availHeight: 1400, dpr: 1.25 })).toBeNull();
	});

	it('세로가 모자라면 세로 기준, 아주 작아도 하한 이상', () => {
		expect(fitWindowScale({ availWidth: 1920, availHeight: 1040, dpr: 1 })).toBe(0.85);
		expect(fitWindowScale({ availWidth: 200, availHeight: 100, dpr: 1 })).toBe(0.25);
	});
});
