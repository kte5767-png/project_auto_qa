/**
 * 엑셀을 읽은 결과를 담는 단순한 격자 모델. 엑셀 라이브러리와 분리해, 해석·정규화는 이 모델 위의 순수 함수로 한다.
 * 행·열 번호는 엑셀과 같이 1부터 센다.
 */

export interface MergeRange {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

export interface GridSheet {
	name: string;
	state: 'visible' | 'hidden' | 'veryHidden';
	/** rows[r - 1][c - 1]. 빈 칸·공백만 있는 칸은 null. 병합 영역의 나머지 칸도 null (값은 왼쪽 위 칸에만) */
	rows: (string | null)[][];
	merges: MergeRange[];
}

export interface Grid {
	sheets: GridSheet[];
}

/** 1 → A, 27 → AA */
export function columnLetter(index: number): string {
	if (!Number.isInteger(index) || index < 1) throw new RangeError(`열 번호는 1 이상의 정수입니다: ${index}`);
	let n = index;
	let letters = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		letters = String.fromCharCode(65 + rem) + letters;
		n = Math.floor((n - 1) / 26);
	}
	return letters;
}

/** A → 1, AA → 27 */
export function columnIndex(letter: string): number {
	if (!/^[A-Z]+$/.test(letter)) throw new RangeError(`열 문자가 올바르지 않습니다: ${letter}`);
	let n = 0;
	for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n;
}

export function cellText(sheet: GridSheet, row: number, column: number): string | null {
	return sheet.rows[row - 1]?.[column - 1] ?? null;
}

export function lastRow(sheet: GridSheet): number {
	for (let r = sheet.rows.length; r >= 1; r--) {
		if (sheet.rows[r - 1]?.some((v) => v !== null) === true) return r;
	}
	return 0;
}

/** 병합 영역 안에서 왼쪽 위가 아닌 칸이면 그 왼쪽 위 칸 좌표, 아니면 null */
export function mergeMaster(sheet: GridSheet, row: number, column: number): { row: number; column: number } | null {
	for (const m of sheet.merges) {
		if (row >= m.top && row <= m.bottom && column >= m.left && column <= m.right) {
			if (row === m.top && column === m.left) return null;
			return { row: m.top, column: m.left };
		}
	}
	return null;
}

/**
 * 공백 정리: 앞뒤 공백 제거, 공백만 있으면 null, 줄바꿈은 유지.
 * 세로 탭(\v, 엑셀 _x000B_)은 Word의 줄 나눔(Shift+Enter)을 붙여 넣은 것이라 줄바꿈으로 본다.
 */
export function cleanText(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const text = value
		.replace(/\r\n?|\v/g, '\n')
		.replace(/[ \t\u00a0]+\n/g, '\n')
		.trim();
	return text === '' ? null : text;
}
