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
export type { ResultWrite, ResultWriteReport } from './workbook';
export { readWorkbook, writeResultCopy } from './workbook';
export type { PatchStatus } from './xlsxPatch';
export { setCellText, sheetPartPaths, workbookPartPath } from './xlsxPatch';
