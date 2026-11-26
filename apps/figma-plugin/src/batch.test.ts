import { describe, expect, it } from 'vitest';
import { exportFileName, planBatches } from './batch';

describe('planBatches', () => {
	it('N개씩 나누고 마지막 묶음은 남은 만큼', () => {
		expect(planBatches(45, 20)).toEqual([
			{ part: 1, parts: 3, from: 0, to: 20 },
			{ part: 2, parts: 3, from: 20, to: 40 },
			{ part: 3, parts: 3, from: 40, to: 45 }
		]);
	});

	it('묶음 크기 0 이하면 한 파일', () => {
		expect(planBatches(355, 0)).toEqual([{ part: 1, parts: 1, from: 0, to: 355 }]);
	});

	it('시작 번호부터 이어서 (멈춘 뒤 다시)', () => {
		expect(planBatches(45, 20, 21)).toEqual([
			{ part: 1, parts: 2, from: 20, to: 40 },
			{ part: 2, parts: 2, from: 40, to: 45 }
		]);
		expect(planBatches(45, 20, 99)).toEqual([]);
		expect(planBatches(0, 20)).toEqual([]);
	});
});

describe('exportFileName', () => {
	const at = '2026-11-27T01:02:03.456Z';

	it('한 파일이면 예전 이름 그대로', () => {
		expect(exportFileName('Travel GUI', at, null)).toBe('Travel_GUI-auto-qa-20261127T010203.json');
		expect(exportFileName('Travel GUI', at, { part: 1, parts: 1, from: 0, to: 3 })).toBe(
			'Travel_GUI-auto-qa-20261127T010203.json'
		);
	});

	it('나눈 파일은 번호를 붙이고 자릿수를 맞춘다 (커밋 제외 이름 유지)', () => {
		const name = exportFileName('Travel GUI', at, { part: 3, parts: 18, from: 40, to: 60 });
		expect(name).toBe('Travel_GUI-auto-qa-20261127T010203-p03of18.json');
		expect(name).toMatch(/-auto-qa-.*\.json$/);
		expect(exportFileName('x', at, { part: 7, parts: 120, from: 0, to: 1 })).toBe(
			'x-auto-qa-20261127T010203-p007of120.json'
		);
	});
});
