import { PAGE_SCRIPT_ECMA_VERSION } from '@auto-qa/core';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { compareMotion, motionScript, sampleMotion } from './motion';

describe('motionScript', () => {
	it('구형 TV 엔진(ES2017)에서 파싱되는 문법만 쓴다', () => {
		expect(() => parse(motionScript('.focused'), { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
		expect(motionScript(null)).toContain('"focusSelector":null');
	});

	it('주어진 실행기로 평가한다', async () => {
		const seen: string[] = [];
		const sample = await sampleMotion(
			{
				evaluate: <T>(e: string): Promise<T> => {
					seen.push(e);
					return Promise.resolve({ focused: true, overflowing: 1, positions: [0] } as T);
				}
			},
			null
		);
		expect(sample.overflowing).toBe(1);
		expect(seen).toHaveLength(1);
	});
});

describe('compareMotion', () => {
	const s = (positions: number[]): { focused: boolean; overflowing: number; positions: number[] } => ({
		focused: true,
		overflowing: positions.length,
		positions
	});

	it('넘치는 글자가 없으면 확인할 수 없음', () => {
		expect(compareMotion(s([]), s([]))).toBe('none');
	});

	it('넘치는 글자의 위치가 기준 이상 바뀌면 움직임', () => {
		expect(compareMotion(s([0, 0]), s([0, -12.5]))).toBe('moved');
		expect(compareMotion(s([0]), s([0, 3]))).toBe('moved');
	});

	it('바뀌지 않으면(또는 기준 미만이면) 멈춤', () => {
		expect(compareMotion(s([0]), s([1]))).toBe('still');
		expect(compareMotion(s([4]), s([4]), 2)).toBe('still');
	});
});
