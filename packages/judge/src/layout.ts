import type { Verdict } from './verdict';

/**
 * 목록 배치 판정: "그리드(타일) 형태로 리스트 제공". 보이는 항목의 사각형만 보고 줄·칸을 센다 (DOM 값, 결정적).
 * - 2줄 이상 × 한 줄에 2칸 이상 → 그리드 (Pass)
 * - 2줄 이상인데 한 칸씩 → 세로 목록 (Fail)
 * - 한 줄인데 화면 오른쪽 밖까지 이어짐 → 가로 목록 (Fail)
 * - 한 줄에 다 들어감·항목 1개 이하 → 그리드인지 알 수 없음 (확인 불가)
 */

export type ItemRect = readonly [number, number, number, number];

export interface GridOptions {
	/** 같은 줄로 보는 위쪽 좌표 차이 (항목 높이에 대한 비율) */
	rowTolerance: number;
}

export const DEFAULT_GRID_OPTIONS: GridOptions = { rowTolerance: 0.5 };

export interface GridLayout {
	rows: number;
	/** 가장 많은 칸이 있는 줄의 칸 수 */
	columns: number;
	/** 화면 오른쪽 밖으로 나간 항목 수 */
	beyondRight: number;
}

export interface GridResult {
	/** 알 수 없으면 null */
	verdict: Verdict | null;
	explanation: string;
	layout: GridLayout;
}

export function gridLayout(
	rects: readonly ItemRect[],
	viewportWidth: number,
	options = DEFAULT_GRID_OPTIONS
): GridLayout {
	const sorted = [...rects].filter((r) => r[2] > 0 && r[3] > 0).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
	const rows: ItemRect[][] = [];
	for (const r of sorted) {
		const row = rows.at(-1);
		const first = row?.[0];
		if (row !== undefined && first !== undefined && r[1] - first[1] <= first[3] * options.rowTolerance) row.push(r);
		else rows.push([r]);
	}
	return {
		rows: rows.length,
		columns: rows.reduce((m, r) => Math.max(m, r.length), 0),
		beyondRight: sorted.filter((r) => r[0] + r[2] > viewportWidth + 1).length
	};
}

export function checkGrid(
	rects: readonly ItemRect[],
	viewportWidth: number,
	where: string,
	options = DEFAULT_GRID_OPTIONS
): GridResult {
	const layout = gridLayout(rects, viewportWidth, options);
	const n = rects.length;
	const shape = `${layout.rows}줄 × 최대 ${layout.columns}칸`;
	if (n < 2) return { verdict: null, explanation: `${where} 항목이 ${n}개라 배치를 알 수 없음`, layout };
	if (layout.rows >= 2 && layout.columns >= 2)
		return { verdict: 'pass', explanation: `${where} 항목 ${n}개가 ${shape} (그리드)`, layout };
	if (layout.rows >= 2)
		return { verdict: 'fail', explanation: `${where} 항목 ${n}개가 한 칸씩 세로로 놓임 (${shape})`, layout };
	if (layout.beyondRight > 0) {
		return {
			verdict: 'fail',
			explanation: `${where} 항목 ${n}개가 한 줄로 화면 밖까지 이어짐 (가로 목록, 화면 밖 ${layout.beyondRight}개)`,
			layout
		};
	}
	return {
		verdict: null,
		explanation: `${where} 항목 ${n}개가 한 줄에 다 들어가 그리드인지 알 수 없음`,
		layout
	};
}
