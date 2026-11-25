import { describe, expect, it } from 'vitest';
import { cellText, cleanText, columnIndex, columnLetter, lastRow, mergeMaster } from './grid';
import { gridSheet } from './testing';

describe('columnLetter / columnIndex', () => {
	it('엑셀 열 문자와 번호를 서로 바꾼다', () => {
		expect(columnLetter(1)).toBe('A');
		expect(columnLetter(26)).toBe('Z');
		expect(columnLetter(27)).toBe('AA');
		expect(columnLetter(703)).toBe('AAA');
		for (const n of [1, 9, 26, 27, 52, 53, 702, 703]) expect(columnIndex(columnLetter(n))).toBe(n);
	});
});

describe('cleanText', () => {
	it('줄바꿈을 LF로 맞추고 앞뒤 공백을 지운다', () => {
		expect(cleanText('  a\r\nb  ')).toBe('a\nb');
		expect(cleanText('a\u000bb')).toBe('a\nb');
		expect(cleanText(' \n ')).toBeNull();
		expect(cleanText(null)).toBeNull();
	});
});

describe('mergeMaster', () => {
	const sheet = gridSheet(
		'S',
		[
			['a', 'b'],
			['', ''],
			['c', '']
		],
		{
			merges: [{ top: 1, left: 2, bottom: 2, right: 2 }]
		}
	);

	it('병합 영역의 나머지 칸이면 왼쪽 위 칸을 돌려준다', () => {
		expect(mergeMaster(sheet, 2, 2)).toEqual({ row: 1, column: 2 });
	});

	it('왼쪽 위 칸이나 병합 밖 칸이면 null', () => {
		expect(mergeMaster(sheet, 1, 2)).toBeNull();
		expect(mergeMaster(sheet, 3, 1)).toBeNull();
	});

	it('마지막 값이 있는 행과 칸 값을 읽는다', () => {
		expect(lastRow(sheet)).toBe(3);
		expect(cellText(sheet, 3, 1)).toBe('c');
		expect(cellText(sheet, 9, 9)).toBeNull();
	});
});
