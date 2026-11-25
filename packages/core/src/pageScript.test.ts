import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { PAGE_SCRIPT_ECMA_VERSION, pageExpression } from './pageScript';
import { stableWaitScript } from './stable';

/** 구형 TV 엔진(ES2017)에서 파싱되는지 확인한다 */
function parsesOnOldEngine(script: string): boolean {
	try {
		parse(script, { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION });
		return true;
	} catch {
		return false;
	}
}

describe('pageExpression', () => {
	it('함수에 JSON 인자를 넣어 바로 실행하는 식을 만든다', () => {
		const expr = pageExpression((n: { a: number }) => n.a * 2, { a: 21 });
		expect(new Function(`return ${expr}`)()).toBe(42);
	});

	it('esbuild keepNames의 __name 호출을 지역 함수로 받아 준다', () => {
		// keepNames가 넣는 형태를 흉내 낸 함수 소스
		const fn = new Function(
			'arg',
			'const inner = __name(function (x) { return x + 1; }, "inner"); return inner(arg);'
		) as (arg: number) => number;
		const expr = pageExpression(fn, 1);
		expect(new Function(`return ${expr}`)()).toBe(2);
		expect('__name' in globalThis).toBe(false);
	});
});

describe('구형 엔진 문법 검사', () => {
	it('검사기는 ES2020 문법(?., ??)을 거부한다', () => {
		expect(parsesOnOldEngine('var a = b?.c;')).toBe(false);
		expect(parsesOnOldEngine('var a = b ?? c;')).toBe(false);
		expect(parsesOnOldEngine('var a = {...b};')).toBe(false);
		expect(parsesOnOldEngine('var a = (b) => b + 1;')).toBe(true);
	});

	it('안정화 대기 스크립트는 ES2017로 파싱된다', () => {
		expect(parsesOnOldEngine(stableWaitScript())).toBe(true);
	});
});
