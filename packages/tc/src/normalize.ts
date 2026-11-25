import { cellText, cleanText, columnLetter, lastRow, mergeMaster } from './grid';
import type { Grid, GridSheet } from './grid';
import { DEFAULT_AUTOMATION_RULES, classifyStep } from './labels';
import type { AutomationRule } from './labels';
import { roleColumns } from './suggest';
import type { ColumnRole, Diagnostic, SheetProfile, SpecRef, StepReference, TcCase, TcProfile, TcStep } from './types';

/**
 * 공통 TC 모델로 정규화 (설계 7.10, D-021). 확인된 TC 프로필대로만 읽는다 (같은 입력 → 같은 결과).
 * - TC: 묶기 기준 칸(ID·제목 등)에 값이 있는 행에서 시작, 아래 행은 이어받는다.
 * - 단계: 조작 또는 기대 결과가 있는 행. 결과(P/F)는 행마다 있으므로 단계마다 결과 칸을 둔다.
 */

export interface NormalizeResult {
	cases: TcCase[];
	diagnostics: Diagnostic[];
}

/** "1. A\n2. B" → ["A", "B"]. 번호가 없는 줄은 앞 항목에 붙인다 */
export function splitNumbered(text: string | null): string[] {
	if (text === null) return [];
	const items: string[] = [];
	for (const line of text.split('\n')) {
		const match = /^\s*\d+\s*[.)]\s*(.*)$/.exec(line);
		if (match !== null) items.push((match[1] ?? '').trim());
		else if (items.length > 0) items[items.length - 1] = `${items[items.length - 1]}\n${line}`.trim();
		else items.push(line.trim());
	}
	return items.filter((item) => item !== '');
}

export function parseSpecRef(id: string | null, pattern: string | null): SpecRef | null {
	if (id === null || pattern === null) return null;
	const match = new RegExp(pattern, 'i').exec(id);
	if (match === null) return null;
	const rest = (match[2] ?? '').replace(/[._\s]+$/, '');
	const screen = /^(\d+(?:\.\d+)*)/.exec(rest);
	return { raw: rest, version: match[1] ?? null, screenId: screen?.[1] ?? null };
}

export function parseTargetRef(action: string | null, pattern: string | null): TcStep['targetRef'] {
	if (action === null || pattern === null) return null;
	const firstLine = action.split('\n')[0] ?? '';
	const match = new RegExp(pattern).exec(firstLine.trim());
	if (match === null) return null;
	const label = (match[2] ?? '').replace(/\s*영역\s*$/, '').trim();
	return { callout: match[1] ?? '', label };
}

function read(sheet: GridSheet, row: number, column: number | undefined): string | null {
	if (column === undefined) return null;
	if (mergeMaster(sheet, row, column) !== null) return null;
	return cleanText(cellText(sheet, row, column));
}

function isMergeContinuation(sheet: GridSheet, row: number, cols: Partial<Record<ColumnRole, number>>): boolean {
	const keys = [cols.action, cols.expected].filter((c): c is number => c !== undefined);
	return keys.length > 0 && keys.every((c) => mergeMaster(sheet, row, c) !== null);
}

function normalizeSheet(
	sheet: GridSheet,
	profile: SheetProfile,
	rules: readonly AutomationRule[],
	diagnostics: Diagnostic[]
): TcCase[] {
	const cols = roleColumns(profile);
	const end = lastRow(sheet);
	const maxMapped = Math.max(...Object.values(cols));
	const referenceRe = profile.referencePattern === null ? null : new RegExp(profile.referencePattern, 'gi');
	const cases: TcCase[] = [];
	let current: TcCase | null = null;

	for (let r = profile.headerRow + 1; r <= end; r++) {
		if (current !== null && isMergeContinuation(sheet, r, cols)) {
			const last = current.steps[current.steps.length - 1];
			if (last !== undefined) last.rowSpan++;
			current.lastRow = r;
			continue;
		}
		const value = (role: ColumnRole): string | null => read(sheet, r, cols[role]);
		const action = value('action');
		const expected = value('expected');
		const starts = profile.groupStart.some((role) => value(role) !== null);
		const content = action !== null || expected !== null;

		if (!content && !starts) {
			const stray = (sheet.rows[r - 1] ?? []).slice(0, maxMapped).some((v) => cleanText(v) !== null);
			if (stray) {
				diagnostics.push({
					sheet: sheet.name,
					row: r,
					kind: 'unmapped-content',
					message: '조작·기대 결과가 없는데 다른 칸에 값이 있어 단계로 읽지 않음'
				});
			}
			continue;
		}

		if (starts || current === null) {
			if (!starts) {
				diagnostics.push({
					sheet: sheet.name,
					row: r,
					kind: 'no-group-start',
					message: '첫 TC 앞에 ID·제목 없이 시작하는 행'
				});
			}
			const id = value('id');
			current = {
				key: `${sheet.name}!${r}`,
				sheet: sheet.name,
				id,
				title: value('title'),
				category: value('category'),
				firstRow: r,
				lastRow: r,
				specRef: parseSpecRef(id, profile.specIdPattern),
				steps: []
			};
			cases.push(current);
		}
		current.lastRow = r;
		if (!content) continue;

		const resultColumn = cols.result;
		let resultCell: TcStep['resultCell'] = null;
		if (resultColumn !== undefined) {
			const master = mergeMaster(sheet, r, resultColumn);
			const row = master?.row ?? r;
			const column = columnLetter(master?.column ?? resultColumn);
			resultCell = { sheet: sheet.name, row, column, address: `${column}${row}` };
		}

		const references: StepReference[] = [];
		if (referenceRe !== null && action !== null) {
			for (const match of action.matchAll(referenceRe)) {
				const stepNo = match[1] ?? '';
				const candidates = current.steps.filter((s) => s.stepNo === stepNo);
				const nearest = candidates[candidates.length - 1];
				const ambiguous = candidates.length > 1;
				references.push({ stepNo, row: nearest?.row ?? null, ambiguous });
				if (nearest === undefined) {
					diagnostics.push({
						sheet: sheet.name,
						row: r,
						kind: 'unresolved-reference',
						message: `"${match[0]}": 같은 TC 위쪽에서 단계 ${stepNo}를 찾지 못함`
					});
				} else if (ambiguous) {
					diagnostics.push({
						sheet: sheet.name,
						row: r,
						kind: 'ambiguous-reference',
						message: `"${match[0]}": 단계 ${stepNo}가 위에 ${candidates.length}개 → 가장 가까운 ${nearest.row}행으로 연결`
					});
				}
			}
		}

		const precondition = value('precondition');
		const note = value('note');
		const automation = classifyStep(
			{ sheet: sheet.name, caseTitle: current.title, precondition, action, expected, note },
			rules
		);
		current.steps.push({
			row: r,
			rowSpan: 1,
			stepNo: value('step'),
			caseNo: value('caseNo'),
			precondition,
			action,
			actions: profile.stepFormat === 'numbered-list' ? splitNumbered(action) : action === null ? [] : [action],
			expected,
			expectedItems: splitNumbered(expected),
			note,
			resultCell,
			existingResult: resultColumn === undefined ? null : read(sheet, resultCell?.row ?? r, resultColumn),
			references,
			targetRef: parseTargetRef(action, profile.targetRefPattern),
			automation: automation.label,
			automationRule: automation.rule,
			automationReason: automation.reason
		});
	}
	return cases;
}

export function normalize(
	grid: Grid,
	profile: TcProfile,
	rules: readonly AutomationRule[] = DEFAULT_AUTOMATION_RULES
): NormalizeResult {
	const diagnostics: Diagnostic[] = [];
	const cases: TcCase[] = [];
	for (const sheetProfile of profile.sheets) {
		if (!sheetProfile.include) continue;
		const sheet = grid.sheets.find((s) => s.name === sheetProfile.sheet);
		if (sheet === undefined) {
			diagnostics.push({
				sheet: sheetProfile.sheet,
				row: 0,
				kind: 'unmapped-content',
				message: '프로필의 시트가 파일에 없음'
			});
			continue;
		}
		cases.push(...normalizeSheet(sheet, sheetProfile, rules, diagnostics));
	}
	return { cases, diagnostics };
}
