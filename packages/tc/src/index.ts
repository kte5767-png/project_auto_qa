export type { Grid, GridSheet, MergeRange } from './grid';
export { cellText, cleanText, columnIndex, columnLetter, lastRow, mergeMaster } from './grid';
export type {
	AutomationLabel,
	CellRef,
	ColumnRole,
	Diagnostic,
	SheetKind,
	SheetProfile,
	SpecRef,
	StepReference,
	TcCase,
	TcProfile,
	TcStep
} from './types';
export { matchHeaderRow, roleColumns, suggestProfile, suggestSheetProfile } from './suggest';
export type { NormalizeResult } from './normalize';
export { normalize, parseSpecRef, parseTargetRef, splitNumbered } from './normalize';
export type { AutomationContext, AutomationRule } from './labels';
export { DEFAULT_AUTOMATION_RULES, classifyStep } from './labels';
export type { SheetSummary, Summary } from './summary';
export { summarize } from './summary';
export type { ResultWrite, ResultWriteOptions, ResultWriteReport } from './workbook';
export {
	DEFAULT_HIGHLIGHT_COLOR,
	backupPath,
	readListValidations,
	readWorkbook,
	writeResultCopy,
	writeResultInPlace
} from './workbook';
export type {
	ListValidation,
	ResultCellOptions,
	ResultCellPlan,
	ResultCellWrite,
	ResultVocabulary,
	ResultWords,
	StepOutcome,
	StepResult
} from './resultCells';
export {
	DEFAULT_RESULT_CELL_OPTIONS,
	DEFAULT_RESULT_WORDS,
	inRange,
	listValidations,
	listValuesAt,
	resultCellWrites,
	resultVocabulary
} from './resultCells';
export type { PatchStatus } from './xlsxPatch';
export { addFillStyle, addMergeCells, cellStyle, setCellText, sheetPartPaths, workbookPartPath } from './xlsxPatch';
