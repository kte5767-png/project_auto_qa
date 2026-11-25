import type { GridSheet, MergeRange } from './grid';

/** 테스트용 격자 시트. 행은 1행부터, 빈 칸은 null 또는 '' */
export function gridSheet(
	name: string,
	rows: (string | null)[][],
	options: { merges?: MergeRange[]; state?: GridSheet['state'] } = {}
): GridSheet {
	return {
		name,
		state: options.state ?? 'visible',
		rows: rows.map((row) => row.map((v) => (v === '' ? null : v))),
		merges: options.merges ?? []
	};
}

/** 행마다 한 단계인 형식 (ID·분류·제목·단계·사전 조건·조작·기대 결과·P/F·심각도) */
export const ROW_PER_STEP_HEADER = [
	'Test Case ID',
	'Category',
	'Title',
	'Step',
	'Precondition',
	'Action',
	'Expected',
	'P/F',
	'Severity'
];

/** 한 칸 안에 번호 목록으로 절차를 쓰는 형식 (ID 비어 있음, 제목으로 묶음) */
export const NUMBERED_HEADER = [
	'ID',
	'Title',
	'#',
	'Precondition',
	'Seq.',
	'Test Procedure',
	'Expected Result',
	'비고',
	'P/F'
];

/** 테스트에서 값이 있어야 하는 곳: 없으면 바로 실패 */
export function defined<T>(value: T | null | undefined, label = '값'): T {
	if (value === null || value === undefined) throw new Error(`${label}이 없습니다`);
	return value;
}
