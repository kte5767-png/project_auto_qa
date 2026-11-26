import { columnLetter } from './grid';
import type { GridSheet } from './grid';
import type { CellRef } from './types';
import type { ResultWrite } from './workbook';

/**
 * 자동 판정 결과는 원본 P/F 열이 아니라 표의 맨 뒤에 따로 쓴다 (D-034).
 * 헤더 행에서 값이 있는 가장 오른쪽 칸(병합이면 병합의 오른쪽 끝) 다음부터 `자동 판정`·`판정 설명`·`판정 근거`.
 * 이미 같은 헤더가 있으면(전에 쓴 사본을 다시 검수) 그 열을 다시 쓴다.
 */
export const END_COLUMN_HEADERS = ['자동 판정', '판정 설명', '판정 근거'] as const;

export interface EndColumns {
	sheet: string;
	headerRow: number;
	/** 열 번호 (1부터), 헤더 순서대로 */
	columns: number[];
	/** 이미 헤더가 있어 다시 쓰는 경우 */
	reused: boolean;
}

export function endColumns(
	sheet: GridSheet,
	headerRow: number,
	headers: readonly string[] = END_COLUMN_HEADERS
): EndColumns {
	const row = sheet.rows[headerRow - 1] ?? [];
	const first = headers[0];
	const found = first === undefined ? -1 : row.findIndex((v) => v?.trim() === first);
	if (found >= 0) {
		return { sheet: sheet.name, headerRow, columns: headers.map((_, i) => found + 1 + i), reused: true };
	}
	let last = 0;
	row.forEach((v, i) => {
		if (v !== null) last = Math.max(last, i + 1);
	});
	for (const m of sheet.merges) {
		if (headerRow >= m.top && headerRow <= m.bottom && m.left <= last && m.right > last) last = m.right;
	}
	return { sheet: sheet.name, headerRow, columns: headers.map((_, i) => last + 1 + i), reused: false };
}

export interface StepValues {
	/** 단계 첫 행 */
	row: number;
	/** 병합으로 이어진 행 수 */
	rowSpan: number;
	/** 헤더 순서대로 값 */
	values: string[];
	/** 스타일을 따라 할 칸 (보통 원본 결과 칸). 없으면 행·열 스타일 */
	styleFrom?: string | null;
}

export interface EndColumnPlan {
	writes: ResultWrite[];
	/** 단계가 여러 행에 걸치면 새 열도 같은 범위로 병합 */
	merges: { sheet: string; ref: string }[];
}

const cellRef = (sheet: string, row: number, column: number): CellRef => {
	const letter = columnLetter(column);
	return { sheet, row, column: letter, address: `${letter}${row}` };
};

export function endColumnWrites(
	target: EndColumns,
	steps: readonly StepValues[],
	options: { headers?: readonly string[]; headerStyleFrom?: string | null } = {}
): EndColumnPlan {
	const headers = options.headers ?? END_COLUMN_HEADERS;
	const writes: ResultWrite[] = [];
	const merges: EndColumnPlan['merges'] = [];
	target.columns.forEach((col, i) => {
		writes.push({
			cell: cellRef(target.sheet, target.headerRow, col),
			value: headers[i] ?? '',
			styleFrom: options.headerStyleFrom ?? null
		});
	});
	for (const s of steps) {
		target.columns.forEach((col, i) => {
			writes.push({
				cell: cellRef(target.sheet, s.row, col),
				value: s.values[i] ?? '',
				styleFrom: s.styleFrom ?? null
			});
			if (s.rowSpan > 1) {
				const letter = columnLetter(col);
				merges.push({ sheet: target.sheet, ref: `${letter}${s.row}:${letter}${s.row + s.rowSpan - 1}` });
			}
		});
	}
	return { writes, merges };
}
