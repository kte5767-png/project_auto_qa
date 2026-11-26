import { describe, expect, it } from 'vitest';
import { DEFAULT_STABLE_OPTIONS } from './driver';
import { stableWaitScript } from './stable';

function embeddedOptions(script: string): unknown {
	const match = /\)\((\{.*\})\);\}\)\(\)$/.exec(script);
	if (match?.[1] === undefined) throw new Error('인자를 찾지 못함');
	return JSON.parse(match[1]);
}

describe('stableWaitScript', () => {
	it('기본값을 채워 넣는다', () => {
		expect(embeddedOptions(stableWaitScript())).toEqual(DEFAULT_STABLE_OPTIONS);
	});

	it('일부 값만 바꿀 수 있다', () => {
		expect(embeddedOptions(stableWaitScript({ quietMs: 300 }))).toEqual({
			...DEFAULT_STABLE_OPTIONS,
			quietMs: 300
		});
	});

	it('흐르는 글자(마키) 안의 변경·애니메이션은 무시한다 (기본 선택자, 빈 문자열이면 끔)', () => {
		expect(DEFAULT_STABLE_OPTIONS.ignore).toContain('marquee');
		expect(embeddedOptions(stableWaitScript({ ignore: '' }))).toMatchObject({ ignore: '' });
		expect(stableWaitScript()).toContain('closest');
	});

	it('구형 엔진 대비: getAnimations가 없을 때의 분기가 들어 있다', () => {
		const script = stableWaitScript();
		expect(script).toContain('getAnimations');
		expect(script).toContain('transitionend');
		expect(script).toContain('legacy');
	});
});
