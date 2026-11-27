import { describe, expect, it } from 'vitest';
import { checkToggle, parseToggleConsequence, sameToggle, toggleStates } from './toggle';
import type { ToggleSample } from './toggle';

const s = (state: string, text = '', identity: string | null = 'save@1460,42'): ToggleSample => ({
	identity,
	state,
	text
});

describe('checkToggle', () => {
	it('OK로 상태가 바뀌고 다시 OK로 돌아오면 통과', () => {
		const r = checkToggle(s('1:aria-checked=true'), s('1:aria-checked=false'), s('1:aria-checked=true'), '저장');
		expect(r).toMatchObject({ verdict: 'pass', restored: true });
	});

	it('글자만 바뀌어도(On → Off) 바뀐 것으로 본다', () => {
		expect(checkToggle(s('', 'On'), s('', 'Off'), s('', 'On'), '저장').verdict).toBe('pass');
	});

	it('OK를 눌러도 그대로면 실패', () => {
		const r = checkToggle(s('0:.on', 'On'), s('0:.on', 'On'), null, '저장');
		expect(r.verdict).toBe('fail');
		expect(r.explanation).toContain('바뀌지 않음');
	});

	it('OK 뒤 포커스가 다른 요소로 가면 토글인지 알 수 없음 (확인 필요)', () => {
		expect(checkToggle(s('a'), s('b', '', 'close@10,10'), null, '저장').verdict).toBe('needs-review');
		expect(checkToggle(s('a', '', null), s('a', '', null), null, '저장').verdict).toBe('needs-review');
	});

	it('다시 눌러도 처음 상태로 돌아오지 않으면 확인 필요 (상태를 남겼을 수 있음)', () => {
		const r = checkToggle(s('a'), s('b'), s('c'), '저장');
		expect(r).toMatchObject({ verdict: 'needs-review', restored: false });
	});
});

describe('toggleStates', () => {
	it('글자 On/Off로 켜짐을 정한다', () => {
		expect(toggleStates(s('', 'Save history On'), s('', 'Save history Off'))).toEqual({ a: 'on', b: 'off' });
		expect(toggleStates(s('', 'Off'), s('', 'On'))).toEqual({ a: 'off', b: 'on' });
	});

	it('aria-checked·클래스로도 정한다', () => {
		expect(toggleStates(s('1:aria-checked=false 1:.switch'), s('1:aria-checked=true 1:.switch.on'))).toEqual({
			a: 'off',
			b: 'on'
		});
		expect(toggleStates(s('0:.btn.active'), s('0:.btn'))).toEqual({ a: 'on', b: 'off' });
	});

	it('켜짐·꺼짐을 알 수 없으면 null (추측하지 않음)', () => {
		expect(toggleStates(s('0:.a'), s('0:.b'))).toBeNull();
		// 글자와 클래스가 엇갈림
		expect(toggleStates(s('0:.inactive', 'On'), s('0:.active', 'Off'))).toBeNull();
	});

	it('같은 상태 표시인지', () => {
		expect(sameToggle(s('x', 'On'), s('x', 'On', 'other@0,0'))).toBe(true);
		expect(sameToggle(s('x', 'On'), s('x', 'Off'))).toBe(false);
	});
});

describe('parseToggleConsequence', () => {
	it('"Off한 경우 … 아래 최근 검색어 영역 제공하지 않음" → 꺼짐에서 최근 검색어 영역이 없어야 함', () => {
		expect(
			parseToggleConsequence('Off한 경우 검색 필드 활성화하더라도 아래 최근 검색어 영역 제공하지 않음')
		).toEqual({ state: 'off', shown: false, subject: '최근 검색어 영역', ifBefore: false });
	});

	it('"Off -> On 변경 시 이전 저장된 기록이 있을 경우 저장된 기록 보여줌" → 켜짐에서 보여야 함 (이전 기록이 있을 때만)', () => {
		expect(parseToggleConsequence('Off -> On 변경 시 이전 저장된 기록이 있을 경우 저장된 기록 보여줌')).toEqual({
			state: 'on',
			shown: true,
			subject: '저장된 기록',
			ifBefore: true
		});
	});

	it('On 상태·끄면 같은 다른 말도 읽는다', () => {
		expect(parseToggleConsequence('On 상태에서 자막 표시')).toMatchObject({
			state: 'on',
			shown: true,
			subject: '자막'
		});
		expect(parseToggleConsequence('끄면 알림 배지 미노출')).toMatchObject({ state: 'off', shown: false });
	});

	it('토글 자체·기본값 문장은 결과 문장이 아니다', () => {
		expect(parseToggleConsequence('최근 검색어 저장 On/Off 가능')).toBeNull();
		expect(parseToggleConsequence('최근 검색어 저장 버튼 기본값: On')).toBeNull();
		expect(parseToggleConsequence('상단방향키 포커스 후 확인 버튼 선택 시 팝업 닫힘')).toBeNull();
	});
});
