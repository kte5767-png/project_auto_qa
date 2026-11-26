import { normalizeFrame } from '@auto-qa/figma';
import { describe, expect, it } from 'vitest';
import { extractSpecScreen } from './extract';
import { mergeSpecScreens, pagePart } from './merge';
import { sampleSpecPage } from './testing';
import type { SpecScreen } from './types';

const base = extractSpecScreen(normalizeFrame(sampleSpecPage()));
const noDescription = (c: SpecScreen['callouts'][number]) => ({ ...c, label: null, description: null });

/** 한 화면을 두 장으로: 1/2에는 1~3번 설명, 2/2에는 1~3번(설명 없음) + 4~6번 */
const part1: SpecScreen = {
	...base,
	frameId: 'p1',
	title: '샘플 화면 - 진입 시(1/2)',
	callouts: base.callouts.filter((c) => Number(c.no) <= 3)
};
const part2: SpecScreen = {
	...base,
	frameId: 'p2',
	title: '샘플 화면 - 진입 시 (2/2)',
	callouts: base.callouts.map((c) => (Number(c.no) <= 3 ? noDescription(c) : c))
};

describe('pagePart', () => {
	it('제목 끝의 (n/m)을 떼어 낸다', () => {
		expect(pagePart('Search Field - VKB 닫힘(1/2)')).toEqual({
			base: 'Search Field - VKB 닫힘',
			part: 1,
			total: 2
		});
		expect(pagePart('검색 완료 ( 2 / 3 )')).toEqual({ base: '검색 완료', part: 2, total: 3 });
		expect(pagePart('검색어 자동 완성')).toBeNull();
		expect(pagePart(null)).toBeNull();
	});
});

describe('mergeSpecScreens', () => {
	it('나뉜 장을 화면 하나로 합치고, 콜아웃은 설명이 있는 장을 기준으로 삼는다', () => {
		const [merged, ...rest] = mergeSpecScreens([part2, part1]);
		expect(rest).toEqual([]);
		expect(merged?.title).toBe('샘플 화면 - 진입 시');
		expect(merged?.parts.map((p) => p.frameId)).toEqual(['p1', 'p2']);
		expect(merged?.missingParts).toEqual([]);
		expect(merged?.callouts.map((c) => [c.no, c.ownerFrameId, c.parts.length])).toEqual([
			['1', 'p1', 2],
			['2', 'p1', 2],
			['3', 'p1', 2],
			['4', 'p2', 1],
			['5', 'p2', 1],
			['6', 'p2', 1]
		]);
		expect(merged?.callouts[0]?.label).toBe('Search 영역');
		expect(merged?.diagnostics).toEqual(['콜아웃 6: 어느 장에도 설명이 없음']);
	});

	it('없는 장을 알려 준다', () => {
		const [merged] = mergeSpecScreens([part1]);
		expect(merged?.total).toBe(2);
		expect(merged?.missingParts).toEqual([2]);
		expect(merged?.diagnostics).toContain('없는 장: 2/2');
	});

	it('같은 프레임은 한 번만, 같은 장이 둘이면 나중 것을 쓴다', () => {
		const again: SpecScreen = { ...part1, frameId: 'p1-copy', frameName: '사본' };
		const [merged] = mergeSpecScreens([part1, part1, again, part2]);
		expect(merged?.parts.map((p) => p.frameId)).toEqual(['p1-copy', 'p2']);
		expect(merged?.diagnostics).toContain('같은 장이 여러 번 있음: 1장 (나중 프레임 사본 사용)');
	});

	it('장마다 설명이 다르면 진단으로 남긴다', () => {
		const conflicting: SpecScreen = {
			...part2,
			callouts: part2.callouts.map((c) =>
				c.no === '1' ? ({ ...base.callouts[0], no: '1', label: '다른 이름' } as typeof c) : c
			)
		};
		const [merged] = mergeSpecScreens([part1, conflicting]);
		expect(merged?.diagnostics).toContain('콜아웃 1 설명이 장마다 다름: "Search 영역" / "다른 이름"');
	});

	it('다른 화면은 따로 둔다', () => {
		const other: SpecScreen = { ...base, frameId: 'x', screenId: '9.9', title: '다른 화면' };
		expect(mergeSpecScreens([other, part1, part2]).map((m) => m.screenId)).toEqual([base.screenId, '9.9']);
	});
});
