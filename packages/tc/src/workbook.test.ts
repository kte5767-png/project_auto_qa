import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellText } from './grid';
import { normalize } from './normalize';
import { suggestProfile } from './suggest';
import { ROW_PER_STEP_HEADER, defined } from './testing';
import { readWorkbook, writeResultCopy } from './workbook';

let dir = '';
let source = '';

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'autoqa-tc-'));
	source = join(dir, 'tc.xlsx');
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Home');
	ws.addRow(ROW_PER_STEP_HEADER);
	ws.addRow(['scenario_v1.0_3.1', 'Home', '이동', 1, '', '(1) GNB 영역', '포커스', '', '']);
	ws.addRow(['', '', '', 2, '', '[OK] 입력', '상세 진입', 'P', '']);
	ws.addRow(['', '', '', 3, '', '[BACK] 입력', '홈 복귀', '', '']);
	// 서식 있는 글자, 수식 결과
	ws.getCell('G2').value = { richText: [{ text: '포커스 ' }, { font: { bold: true }, text: '표시' }] };
	ws.getCell('I2').value = { formula: '"Ma"&"jor"', result: 'Major' };
	ws.mergeCells('F4:F5');
	ws.mergeCells('G4:G5');
	ws.mergeCells('H4:H5');
	const hidden = wb.addWorksheet('VUI', { state: 'hidden' });
	hidden.addRow(['ID']);
	await wb.xlsx.writeFile(source);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('readWorkbook', () => {
	it('값·서식 있는 글자·수식 결과·숨김 상태·병합을 격자로 읽는다', async () => {
		const grid = await readWorkbook(source);
		const [home, vui] = grid.sheets;
		expect(home?.state).toBe('visible');
		expect(vui?.state).toBe('hidden');
		expect(cellText(defined(home), 2, 4)).toBe('1');
		expect(cellText(defined(home), 2, 7)).toBe('포커스 표시');
		expect(cellText(defined(home), 2, 9)).toBe('Major');
		expect(home?.merges).toContainEqual({ top: 4, left: 6, bottom: 5, right: 6 });
	});

	it('병합 영역의 나머지 칸은 비운다 (왼쪽 위 값이 중복되지 않게)', async () => {
		const grid = await readWorkbook(source);
		expect(cellText(defined(grid.sheets[0]), 4, 6)).toBe('[BACK] 입력');
		expect(cellText(defined(grid.sheets[0]), 5, 6)).toBeNull();
	});
});

describe('writeResultCopy', () => {
	it('사본의 결과 칸에 쓰고, 원본은 그대로 둔다', async () => {
		const grid = await readWorkbook(source);
		const { cases } = normalize(grid, suggestProfile(grid));
		const steps = cases.flatMap((c) => c.steps);
		expect(steps.map((s) => s.resultCell?.address)).toEqual(['H2', 'H3', 'H4']);

		const output = join(dir, 'result.xlsx');
		const writes = steps.map((s, i) => ({ cell: defined(s.resultCell), value: `R${i}` }));
		const report = await writeResultCopy(source, output, writes);
		expect(report.written).toBe(2);
		expect(report.skipped.map((c) => c.address)).toEqual(['H3']);
		expect(report.changedParts).toEqual(['xl/worksheets/sheet1.xml']);

		const after = defined((await readWorkbook(output)).sheets[0]);
		expect([cellText(after, 2, 8), cellText(after, 3, 8), cellText(after, 4, 8)]).toEqual(['R0', 'P', 'R2']);
		expect(cellText(after, 5, 8)).toBeNull();
		expect(cellText(after, 2, 7)).toBe('포커스 표시');

		const original = defined((await readWorkbook(source)).sheets[0]);
		expect(cellText(original, 2, 8)).toBeNull();
	});

	it('바꾼 시트 외의 파트는 원본과 같은 내용', async () => {
		const grid = await readWorkbook(source);
		const step = defined(defined(normalize(grid, suggestProfile(grid)).cases[0]).steps[0]);
		const output = join(dir, 'parts.xlsx');
		await writeResultCopy(source, output, [{ cell: defined(step.resultCell), value: 'P' }]);
		const a = await JSZip.loadAsync(await readFile(source));
		const b = await JSZip.loadAsync(await readFile(output));
		expect(Object.keys(b.files)).toEqual(Object.keys(a.files)); // 폴더 항목도 새로 만들지 않음
		for (const name of Object.keys(a.files)) {
			if (name === 'xl/worksheets/sheet1.xml' || defined(a.files[name]).dir) continue;
			expect(await defined(b.file(name)).async('string'), name).toBe(await defined(a.file(name)).async('string'));
		}
	});

	it('overwrite를 켜면 기존 결과도 덮어쓴다', async () => {
		const grid = await readWorkbook(source);
		const step = defined(defined(normalize(grid, suggestProfile(grid)).cases[0]).steps[1]);
		const output = join(dir, 'overwrite.xlsx');
		const { written } = await writeResultCopy(source, output, [{ cell: defined(step.resultCell), value: 'F' }], {
			overwrite: true
		});
		expect(written).toBe(1);
		expect(cellText(defined((await readWorkbook(output)).sheets[0]), 3, 8)).toBe('F');
	});

	it('원본 경로에는 쓰지 않는다', async () => {
		await expect(writeResultCopy(source, source, [])).rejects.toThrow('원본 파일');
	});
});
