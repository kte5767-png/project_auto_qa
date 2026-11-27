import { describe, expect, it } from 'vitest';
import { checkToggle } from './toggle';
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
