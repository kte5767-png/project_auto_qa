import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { cleanText } from './grid';
import type { Grid, GridSheet, MergeRange } from './grid';
import type { CellRef } from './types';
import {
	parseSharedStrings,
	relationshipTargets,
	resolvePart,
	setCellText,
	sheetPartPaths,
	workbookPartPath
} from './xlsxPatch';

/**
 * 엑셀 파일 ↔ 격자 모델 (부수 효과는 이 파일에만). 읽기는 exceljs, 결과 쓰기는 원본 보존 XML 패치 (D-021, D-025, D-028).
 */

function cellToText(value: ExcelJS.CellValue): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') {
		if ('richText' in value) return value.richText.map((part) => part.text).join('');
		if ('formula' in value || 'sharedFormula' in value) {
			const result = (value as { result?: ExcelJS.CellValue }).result;
			return result === undefined ? null : cellToText(result);
		}
		if ('text' in value && typeof value.text === 'string') return value.text;
		if ('error' in value) return String(value.error);
	}
	return null;
}

function parseRange(range: string): MergeRange | null {
	const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
	if (match === null) return null;
	const col = (letters: string): number => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
	return {
		left: col(match[1] ?? 'A'),
		top: Number(match[2]),
		right: col(match[3] ?? 'A'),
		bottom: Number(match[4])
	};
}

function toGridSheet(ws: ExcelJS.Worksheet): GridSheet {
	const rows: (string | null)[][] = [];
	ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
		const cells: (string | null)[] = [];
		row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
			// 병합 영역의 나머지 칸은 왼쪽 위 값을 그대로 보여 주므로 비운다 (값은 왼쪽 위에만)
			if (cell.isMerged && cell.master.address !== cell.address) return;
			cells[colNumber - 1] = cleanText(cellToText(cell.value));
		});
		rows[rowNumber - 1] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? null);
	});
	for (let i = 0; i < rows.length; i++) rows[i] ??= [];
	const merges = ((ws.model as { merges?: string[] }).merges ?? [])
		.map(parseRange)
		.filter((m): m is MergeRange => m !== null);
	const state = ws.state === 'hidden' || ws.state === 'veryHidden' ? ws.state : 'visible';
	return { name: ws.name, state, rows, merges };
}

export async function readWorkbook(path: string): Promise<Grid> {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.readFile(path);
	return { sheets: workbook.worksheets.map(toGridSheet) };
}

export interface ResultWrite {
	cell: CellRef;
	value: string;
}

export interface ResultWriteReport {
	written: number;
	/** 이미 값이 있어 건너뛴 칸 (overwrite가 아닐 때) */
	skipped: CellRef[];
	/** 수식 칸이라 건너뛴 칸 */
	formula: CellRef[];
	/** 바꾼 zip 파트 (나머지 파트는 원본 바이트 그대로) */
	changedParts: string[];
}

/**
 * 원본을 그대로 두고 사본에 결과를 쓴다 (D-028). 엑셀 라이브러리로 다시 저장하지 않고,
 * 사본 zip에서 해당 시트 XML의 결과 칸만 바꾼다. 이미 값이 있는 칸은 overwrite가 true일 때만 덮어쓴다.
 */
export async function writeResultCopy(
	sourcePath: string,
	outputPath: string,
	writes: readonly ResultWrite[],
	options: { overwrite?: boolean } = {}
): Promise<ResultWriteReport> {
	if (resolve(sourcePath) === resolve(outputPath)) {
		throw new Error('원본 파일에는 쓰지 않습니다. 다른 출력 경로를 지정해 주세요.');
	}
	const zip = await JSZip.loadAsync(await readFile(sourcePath));
	const text = async (path: string): Promise<string> => {
		const file = zip.file(path);
		if (file === null) throw new Error(`xlsx 안에 ${path}가 없습니다`);
		return file.async('string');
	};
	const workbookPath = workbookPartPath(await text('_rels/.rels'));
	const relsPath = `${dirname(workbookPath) === '.' ? '' : `${dirname(workbookPath)}/`}_rels/${basename(workbookPath)}.rels`;
	const sheetPaths = sheetPartPaths(workbookPath, await text(workbookPath), await text(relsPath));
	const sharedPath = [...relationshipTargets(await text(relsPath))].find(([type]) =>
		type.endsWith('/sharedStrings')
	)?.[1];
	const sharedStrings =
		sharedPath === undefined ? [] : parseSharedStrings(await text(resolvePart(dirname(workbookPath), sharedPath)));

	const report: ResultWriteReport = { written: 0, skipped: [], formula: [], changedParts: [] };
	const bySheet = new Map<string, ResultWrite[]>();
	for (const w of writes) bySheet.set(w.cell.sheet, [...(bySheet.get(w.cell.sheet) ?? []), w]);
	for (const [sheet, sheetWrites] of bySheet) {
		const path = sheetPaths.get(sheet);
		if (path === undefined) throw new Error(`시트가 없습니다: ${sheet}`);
		let xml = await text(path);
		let changed = false;
		for (const w of sheetWrites) {
			const result = setCellText(xml, w.cell.address, w.value, { ...options, sharedStrings });
			if (result.status === 'skipped-existing') report.skipped.push(w.cell);
			else if (result.status === 'skipped-formula') report.formula.push(w.cell);
			else {
				xml = result.xml;
				changed = true;
				report.written++;
			}
		}
		if (changed) {
			zip.file(path, xml, { createFolders: false }); // 원본에 없는 폴더 항목을 만들지 않는다
			report.changedParts.push(path);
		}
	}
	const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
	await writeFile(outputPath, buffer);
	return report;
}
