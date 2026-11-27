import { describe, expect, it } from 'vitest';
import { checkGrid, gridLayout } from './layout';
import type { ItemRect } from './layout';

/** 합성 배치: 카드 388×216, 칸 간격 400, 줄 간격 236 */
const card = (col: number, row: number): ItemRect => [210 + col * 400, 246 + row * 236, 388, 216];

describe('checkGrid', () => {
	it('2줄 이상 × 2칸 이상이면 그리드 (통과)', () => {
		const rects = [card(0, 0), card(1, 0), card(2, 0), card(3, 0), card(0, 1)];
		expect(gridLayout(rects, 1920)).toEqual({ rows: 2, columns: 4, beyondRight: 0 });
		expect(checkGrid(rects, 1920, '결과').verdict).toBe('pass');
	});

	it('한 줄로 화면 밖까지 이어지면 가로 목록 (실패)', () => {
		const rects = [0, 1, 2, 3, 4].map((i) => card(i, 0));
		const r = checkGrid(rects, 1920, '결과');
		expect(r.verdict).toBe('fail');
		expect(r.explanation).toContain('가로 목록');
	});

	it('한 칸씩 세로로 놓이면 실패', () => {
		expect(checkGrid([card(0, 0), card(0, 1), card(0, 2)], 1920, '결과').verdict).toBe('fail');
	});

	it('한 줄에 다 들어가거나 항목이 1개면 알 수 없음', () => {
		expect(checkGrid([card(0, 0), card(1, 0), card(2, 0)], 1920, '결과').verdict).toBeNull();
		expect(checkGrid([card(0, 0)], 1920, '결과').verdict).toBeNull();
	});

	it('위쪽 좌표가 조금 달라도(높이 절반 안) 같은 줄로 본다', () => {
		const rects: ItemRect[] = [card(0, 0), [610, 256, 388, 216], card(0, 1), card(1, 1)];
		expect(gridLayout(rects, 1920)).toMatchObject({ rows: 2, columns: 2 });
	});
});
