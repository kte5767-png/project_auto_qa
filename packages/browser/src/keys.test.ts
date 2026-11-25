import { describe, expect, it } from 'vitest';
import { WEBOS_KEY_MAP, cdpKeyEvents, parseKeySequence } from './keys';

describe('cdpKeyEvents', () => {
	it('keydown/keyup에 같은 keyCode와 key를 넣는다 (webOS Back 461)', () => {
		const [down, up] = cdpKeyEvents(WEBOS_KEY_MAP.BACK);
		expect(down).toEqual({
			type: 'rawKeyDown',
			windowsVirtualKeyCode: 461,
			nativeVirtualKeyCode: 461,
			key: 'GoBack'
		});
		expect(up.type).toBe('keyUp');
		expect(up.windowsVirtualKeyCode).toBe(461);
	});

	it('방향키는 표준 키 코드를 쓴다', () => {
		expect(cdpKeyEvents(WEBOS_KEY_MAP.DOWN)[0].windowsVirtualKeyCode).toBe(40);
		expect(cdpKeyEvents(WEBOS_KEY_MAP.DOWN)[0].key).toBe('ArrowDown');
	});
});

describe('parseKeySequence', () => {
	it('반복 표기와 구분자를 처리한다', () => {
		expect(parseKeySequence('RIGHT*2 down, ok')).toEqual(['RIGHT', 'RIGHT', 'DOWN', 'OK']);
	});

	it('빈 문자열은 빈 목록', () => {
		expect(parseKeySequence('  ')).toEqual([]);
	});

	it('알 수 없는 키는 오류', () => {
		expect(() => parseKeySequence('JUMP')).toThrow(/JUMP/);
	});

	it('반복 횟수 범위를 검사한다', () => {
		expect(() => parseKeySequence('UP*0')).toThrow();
		expect(() => parseKeySequence('UP*101')).toThrow();
	});
});
