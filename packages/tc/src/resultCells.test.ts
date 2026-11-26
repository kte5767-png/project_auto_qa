import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RESULT_CELL_OPTIONS,
	inRange,
	listValidations,
	listValuesAt,
	resultCellWrites,
	resultVocabulary
} from './resultCells';
import type { StepResult } from './resultCells';

const SHEET = `<worksheet><sheetData/><dataValidations count="3">
<dataValidation type="list" allowBlank="1" sqref="L2:L9"><formula1>"Passed,In Progress,Fixed"</formula1></dataValidation>
<dataValidation type="list" allowBlank="1" sqref="H2:H88 H90"><formula1>"Passed,Failed,Reopened,Skipped,Not Testable"</formula1></dataValidation>
<dataValidation type="list" sqref="B2"><formula1>Lists!$A$1:$A$5</formula1></dataValidation>
<dataValidation type="whole" sqref="C2"><formula1>1</formula1></dataValidation>
</dataValidations></worksheet>`;

const cell = (row: number) => ({ sheet: 'Search', row, column: 'H', address: `H${row}` });
const vocab = { pass: 'Passed', fail: 'Failed', source: 'list' as const };

describe('listValidations', () => {
	it('목록형만 읽고, 여러 범위와 다른 칸을 가리키는 목록을 구분한다', () => {
		expect(listValidations(SHEET)).toEqual([
			{ ranges: ['L2:L9'], values: ['Passed', 'In Progress', 'Fixed'] },
			{ ranges: ['H2:H88', 'H90'], values: ['Passed', 'Failed', 'Reopened', 'Skipped', 'Not Testable'] },
			{ ranges: ['B2'], values: null }
		]);
	});

	it('칸에 걸린 목록 값을 찾는다', () => {
		const v = listValidations(SHEET);
		expect(listValuesAt(v, 'H10')?.[1]).toBe('Failed');
		expect(listValuesAt(v, 'H90')?.[0]).toBe('Passed');
		expect(listValuesAt(v, 'H89')).toBeNull();
		expect(listValuesAt(v, 'B2')).toBeNull();
	});

	it('범위 안인지 (열·행 모두)', () => {
		expect(inRange('H2', 'H2:H88')).toBe(true);
		expect(inRange('I2', 'H2:H88')).toBe(false);
		expect(inRange('H1', 'H2:H88')).toBe(false);
		expect(inRange('B7', 'B7')).toBe(true);
		expect(inRange('C3', 'A1:D4')).toBe(true);
	});
});

describe('resultVocabulary', () => {
	it('드롭다운 값 중 Pass·Fail에 해당하는 값을 고른다', () => {
		expect(resultVocabulary(['Passed', 'Failed', 'Reopened', 'Skipped', 'Not Testable'])).toEqual(vocab);
		expect(resultVocabulary(['PASS', 'FAIL', 'N/A'])).toMatchObject({ pass: 'PASS', fail: 'FAIL' });
		expect(resultVocabulary(['OK', 'NG'])).toMatchObject({ pass: 'OK', fail: 'NG' });
	});

	it('드롭다운이 없으면 기본값, 있는데 맞는 값이 없으면 null (양식에 없는 값을 쓰지 않음)', () => {
		expect(resultVocabulary(null)).toEqual({ pass: 'Pass', fail: 'Fail', source: 'default' });
		expect(resultVocabulary(['Done', 'Todo'])).toBeNull();
	});
});

describe('resultCellWrites', () => {
	const steps: StepResult[] = [
		{ resultCell: cell(2), outcome: 'pass', reason: '화면으로 확인한 조건 3개 모두 통과', checked: 3 },
		{
			resultCell: cell(3),
			outcome: 'pass',
			reason: '화면으로 확인한 조건 2개 모두 통과\n확인하지 않은 조건: Admin 편성',
			checked: 2
		},
		{ resultCell: cell(4), outcome: 'fail', reason: '추천 검색어 6개 (최대 5개)', checked: 4 },
		{ resultCell: cell(5), outcome: 'needs-review', reason: '▼ 후 포커스가 화면설계서와 다름', checked: 1 },
		{ resultCell: cell(6), outcome: 'needs-review', reason: '화면으로 확인할 수 있는 조건이 없음', checked: 0 }
	];

	it('Pass·Fail은 드롭다운 값, 이유는 이슈 열에. Pass는 이유 칸을 비우고, 확인 필요는 Passed + 표시 + 색, 확인한 조건이 없으면 쓰지 않는다', () => {
		const plan = resultCellWrites(steps, vocab, 'K');
		expect(plan.writes.map((w) => [w.cell.address, w.value, w.highlight])).toEqual([
			['H2', 'Passed', false],
			['H3', 'Passed', false],
			['H4', 'Failed', false],
			['K4', '추천 검색어 6개 (최대 5개)', false],
			['H5', 'Passed', false],
			['K5', '[확인 필요] ▼ 후 포커스가 화면설계서와 다름', true]
		]);
		expect(plan.skipped.map((s) => s.cell.address)).toEqual(['H6']);
	});

	it('passNotes를 켜면 Pass에도 확인하지 않은 조건을 쓴다 ("모두 통과" 요약 줄은 뺌)', () => {
		const plan = resultCellWrites(steps.slice(0, 2), vocab, 'K', {
			...DEFAULT_RESULT_CELL_OPTIONS,
			passNotes: true
		});
		expect(plan.writes.map((w) => [w.cell.address, w.value])).toEqual([
			['H2', 'Passed'],
			['H3', 'Passed'],
			['K3', '확인하지 않은 조건: Admin 편성']
		]);
	});

	it('이유 열이 없으면 결과 칸만 쓰고, 확인 필요는 결과 칸에 색으로 표시한다', () => {
		const plan = resultCellWrites(steps, vocab, null);
		expect(plan.writes.map((w) => [w.cell.address, w.value, w.highlight])).toEqual([
			['H2', 'Passed', false],
			['H3', 'Passed', false],
			['H4', 'Failed', false],
			['H5', 'Passed', true]
		]);
	});
});
