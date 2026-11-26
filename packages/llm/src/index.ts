export type { JsonSchema } from './schema';
export { validateJson } from './schema';
export { assertLocalEndpoint, isLocalHost } from './host';
export type {
	ChatMetrics,
	ChatRequest,
	ChatResult,
	LlmClient,
	LlmMessage,
	ModelDetails,
	ModelInfo,
	RunningModel
} from './types';
export type { OllamaOptions } from './ollama';
export { extractJson, LlmError, OllamaClient } from './ollama';
export type { CalloutKeys, CaseFile, JudgeCase, LlmCase, PlanCase, PlanKey, Task, Verdict } from './bench/cases';
export { CASE_FORMAT, CASE_VERSION, parseCaseFile, PLAN_KEYS, VERDICTS } from './bench/cases';
export { JUDGE_SCHEMA, messagesFor, PLAN_SCHEMA, PROMPT_VERSION, schemaFor } from './bench/prompts';
export type { CaseScore, Decision } from './bench/score';
export { decisionKey, decisionOf, keySimilarity, scoreCase } from './bench/score';
export type {
	CallRecord,
	CompareOptions,
	CompareResult,
	LoadedCase,
	ModelRun,
	ModelSummary,
	Progress
} from './bench/compare';
export { compareModels, DEFAULT_COMPARE_OPTIONS, rankModels, summarize } from './bench/compare';
export type { ReportMeta } from './bench/report';
export { renderReport } from './bench/report';
