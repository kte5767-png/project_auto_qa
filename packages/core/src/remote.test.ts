import { describe, expect, it } from 'vitest';
import { REMOTE_KEYS, WEBOS_KEY_MAP, cdpKeyEvents, isRemoteKey, keyboardEnterEvents, parseKeySequence } from './remote';

describe('cdpKeyEvents', () => {
	it('keydown/keyup에 같은 keyCode와 key를 넣는다 (webOS Back 461)', () => {
		const back = WEBOS_KEY_MAP.BACK;
		if (back === null) throw new Error('BACK 정의 없음');
		const [down, up] = cdpKeyEvents(back);
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
		const down = WEBOS_KEY_MAP.DOWN;
		if (down === null) throw new Error('DOWN 정의 없음');
		expect(cdpKeyEvents(down)[0].windowsVirtualKeyCode).toBe(40);
		expect(cdpKeyEvents(down)[0].key).toBe('ArrowDown');
	});

	it('키보드 확인(Enter)은 리모컨 OK와 달리 글자 "\\r"가 붙는다 (keypress가 생김)', () => {
		const [down, up] = keyboardEnterEvents();
		expect(down).toMatchObject({ type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
		expect(up).toMatchObject({ type: 'keyUp', key: 'Enter' });
		expect(up.text).toBeUndefined();
		const ok = WEBOS_KEY_MAP.OK;
		expect(ok === null ? 'x' : cdpKeyEvents(ok)[0].text).toBeUndefined();
	});

	it('HOME은 시스템 키라 페이지 키 이벤트가 없다', () => {
		expect(WEBOS_KEY_MAP.HOME).toBeNull();
	});

	it('모든 리모컨 키가 매핑에 들어 있다', () => {
		expect(Object.keys(WEBOS_KEY_MAP).sort()).toEqual([...REMOTE_KEYS].sort());
	});
});

describe('parseKeySequence', () => {
	it('반복 표기와 구분자를 처리한다', () => {
		expect(parseKeySequence('RIGHT*2 down, ok')).toEqual(['RIGHT', 'RIGHT', 'DOWN', 'OK']);
	});

	it('HOME도 키로 받는다', () => {
		expect(parseKeySequence('home back')).toEqual(['HOME', 'BACK']);
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

describe('isRemoteKey', () => {
	it('대문자 키 이름만 받는다', () => {
		expect(isRemoteKey('OK')).toBe(true);
		expect(isRemoteKey('ok')).toBe(false);
		expect(isRemoteKey('ENTER')).toBe(false);
	});
});
