import { unescapeXml } from './xlsxPatch';
import type { CellRef } from './types';

/**
 * 판정 결과를 TC 양식 그대로 쓰기 위한 순수 함수 (D-040).
 * - 결과 열(P/F)에는 그 칸의 드롭다운(데이터 유효성 목록) 값을 쓴다 (예: Passed / Failed)
 * - 이유는 이슈 설명 열(예: Issue Detail)에 쓴다. Fail은 이유, 확인 필요는 Passed + 이유 앞에 표시, Pass는 비움
 * - 화면으로 확인한 조건이 없는 단계·실행하지 않은 단계는 쓰지 않는다
 */

export interface ListValidation {
	/** sqref를 나눈 범위들 (예: ["H2:H88", "H90"]) */
	ranges: string[];
	/** 목록 값. 다른 칸을 가리키는 목록(=$A$1:$A$5)이면 null */
	values: string[] | null;
}

/** 시트 XML의 목록형 데이터 유효성 */
export function listValidations(sheetXml: string): ListValidation[] {
	const out: ListValidation[] = [];
	const re = /<(?:\w+:)?dataValidation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?dataValidation>)/g;
	for (const m of sheetXml.matchAll(re)) {
		const attrs = m[1] ?? '';
		if (!/\btype="list"/.test(attrs)) continue;
		const sqref = /\bsqref="([^"]*)"/.exec(attrs)?.[1] ?? /<(?:\w+:)?sqref>([^<]*)</.exec(m[2] ?? '')?.[1] ?? '';
		const formula = /<(?:\w+:)?formula1>([\s\S]*?)<\/(?:\w+:)?formula1>/.exec(m[2] ?? '')?.[1];
		const text = formula === undefined ? null : unescapeXml(formula).trim();
		const values =
			text !== null && text.startsWith('"') && text.endsWith('"')
				? text
						.slice(1, -1)
						.split(',')
						.map((v) => v.trim())
						.filter((v) => v !== '')
				: null;
		out.push({ ranges: sqref.split(/\s+/).filter((r) => r !== ''), values });
	}
	return out;
}

function parseAddress(address: string): { col: number; row: number } {
	const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(address.toUpperCase());
	if (m === null) throw new Error(`칸 주소가 아닙니다: ${address}`);
	let col = 0;
	for (const ch of m[1] ?? '') col = col * 26 + ch.charCodeAt(0) - 64;
	return { col, row: Number(m[2]) };
}

/** 칸이 범위(H2:H88 또는 H5)에 들어 있는지 */
export function inRange(address: string, range: string): boolean {
	const [a, b] = range.split(':');
	if (a === undefined || a === '') return false;
	const p = parseAddress(address);
	const s = parseAddress(a);
	const e = b === undefined ? s : parseAddress(b);
	return (
		p.col >= Math.min(s.col, e.col) &&
		p.col <= Math.max(s.col, e.col) &&
		p.row >= Math.min(s.row, e.row) &&
		p.row <= Math.max(s.row, e.row)
	);
}

/** 칸에 걸린 목록 값 (없으면 null) */
export function listValuesAt(validations: readonly ListValidation[], address: string): string[] | null {
	for (const v of validations) if (v.values !== null && v.ranges.some((r) => inRange(address, r))) return v.values;
	return null;
}

export interface ResultWords {
	pass: readonly RegExp[];
	fail: readonly RegExp[];
}

/** 드롭다운 값 중 Pass·Fail에 해당하는 것을 찾는 규칙 (설정) */
export const DEFAULT_RESULT_WORDS: ResultWords = {
	pass: [/^pass(ed)?$/i, /^p$/i, /^ok$/i, /^통과$/, /^합격$/, /^성공$/],
	fail: [/^fail(ed)?$/i, /^f$/i, /^ng$/i, /^실패$/, /^불합격$/]
};

export interface ResultVocabulary {
	pass: string;
	fail: string;
	/** 값을 어디서 정했는지 (리포트용) */
	source: 'list' | 'default';
}

/**
 * 결과 칸에 쓸 Pass·Fail 값. 드롭다운이 있으면 그 값 중에서 고르고, 없으면 기본값.
 * 드롭다운에 Pass·Fail에 해당하는 값이 없으면 null (양식에 없는 값을 쓰지 않는다)
 */
export function resultVocabulary(
	listValues: readonly string[] | null,
	words: ResultWords = DEFAULT_RESULT_WORDS,
	fallback: { pass: string; fail: string } = { pass: 'Pass', fail: 'Fail' }
): ResultVocabulary | null {
	if (listValues === null) return { ...fallback, source: 'default' };
	const find = (patterns: readonly RegExp[]): string | undefined =>
		listValues.find((v) => patterns.some((p) => p.test(v.trim())));
	const pass = find(words.pass);
	const fail = find(words.fail);
	if (pass === undefined || fail === undefined) return null;
	return { pass, fail, source: 'list' };
}

export type StepOutcome = 'pass' | 'fail' | 'needs-review';

export interface StepResult {
	/** 결과 칸 (TC 정규화의 resultCell) */
	resultCell: CellRef;
	outcome: StepOutcome;
	/** 판정 설명 (Pass는 passNotes일 때만 확인하지 않은 조건을 쓴다) */
	reason: string;
	/** 화면으로 확인한 조건 수. 0이면 쓰지 않는다 */
	checked: number;
}

export interface ResultCellOptions {
	/** 확인 필요 표시 (이유 앞에 붙인다) */
	reviewTag: string;
	/** 이 줄로 시작하는 설명은 이유 칸에 쓰지 않는다 (Pass의 "모두 통과" 요약 등) */
	dropLines: readonly RegExp[];
	/**
	 * Pass에도 이유 칸에 남은 설명(확인하지 않은 조건)을 쓸지. 기본 false — 고객이 볼 때 이슈가 없으면
	 * 이유 칸은 비운다(사용자 결정 2026-11-27, D-040). 확인하지 않은 조건은 리포트에 남는다
	 */
	passNotes: boolean;
}

export const DEFAULT_RESULT_CELL_OPTIONS: ResultCellOptions = {
	reviewTag: '[확인 필요]',
	dropLines: [/^화면으로 확인한 조건 \d+개 모두 통과$/],
	passNotes: false
};

export interface ResultCellWrite {
	cell: CellRef;
	value: string;
	/** 확인 필요 표시 칸 (색을 칠할 칸) */
	highlight: boolean;
}

export interface ResultCellPlan {
	writes: ResultCellWrite[];
	/** 쓰지 않은 단계 (확인한 조건 없음) */
	skipped: { cell: CellRef; reason: string }[];
}

/**
 * 단계 판정 → 결과 칸·이유 칸 쓰기 목록.
 * @param issueColumn 이유를 쓸 열 문자 (없으면 결과 칸만 쓰고 이유는 리포트에만 남는다)
 */
export function resultCellWrites(
	steps: readonly StepResult[],
	vocabulary: ResultVocabulary,
	issueColumn: string | null,
	options: ResultCellOptions = DEFAULT_RESULT_CELL_OPTIONS
): ResultCellPlan {
	const plan: ResultCellPlan = { writes: [], skipped: [] };
	for (const s of steps) {
		if (s.checked === 0) {
			plan.skipped.push({ cell: s.resultCell, reason: '화면으로 확인한 조건이 없음' });
			continue;
		}
		const value = s.outcome === 'fail' ? vocabulary.fail : vocabulary.pass;
		const review = s.outcome === 'needs-review';
		// 이유 칸이 없으면 확인 필요 표시는 결과 칸 색으로만 남는다
		plan.writes.push({ cell: s.resultCell, value, highlight: review && issueColumn === null });
		const lines = s.reason
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l !== '' && !options.dropLines.some((p) => p.test(l)));
		if (review) lines.unshift(options.reviewTag);
		if (s.outcome === 'pass' && !options.passNotes) continue;
		if (lines.length === 0 || issueColumn === null) continue;
		const address = `${issueColumn}${s.resultCell.row}`;
		plan.writes.push({
			cell: { sheet: s.resultCell.sheet, row: s.resultCell.row, column: issueColumn, address },
			value: review ? `${lines[0]} ${lines.slice(1).join('\n')}`.trim() : lines.join('\n'),
			highlight: review
		});
	}
	return plan;
}
