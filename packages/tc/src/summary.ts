import type { NormalizeResult } from './normalize';
import type { AutomationLabel, SheetKind, TcProfile } from './types';

export interface SheetSummary {
	sheet: string;
	kind: SheetKind;
	included: boolean;
	cases: number;
	steps: number;
	labels: Record<AutomationLabel, number>;
	/** 결과 칸이 있는 단계 */
	resultCells: number;
	specRefs: number;
	targetRefs: number;
	references: { total: number; resolved: number; ambiguous: number };
	diagnostics: number;
}

export interface Summary {
	sheets: SheetSummary[];
	total: Omit<SheetSummary, 'sheet' | 'kind' | 'included'>;
	/** 자동 + 대리 검증 비율 (단계 기준) */
	automatableRatio: number;
}

const emptyLabels = (): Record<AutomationLabel, number> => ({
	auto: 0,
	proxy: 0,
	manual: 0,
	deferred: 0,
	'out-of-scope': 0
});

export function summarize(profile: TcProfile, result: NormalizeResult): Summary {
	const sheets: SheetSummary[] = profile.sheets.map((p) => {
		const cases = result.cases.filter((c) => c.sheet === p.sheet);
		const steps = cases.flatMap((c) => c.steps);
		const labels = emptyLabels();
		for (const s of steps) labels[s.automation]++;
		const refs = steps.flatMap((s) => s.references);
		return {
			sheet: p.sheet,
			kind: p.kind,
			included: p.include,
			cases: cases.length,
			steps: steps.length,
			labels,
			resultCells: steps.filter((s) => s.resultCell !== null).length,
			specRefs: cases.filter((c) => c.specRef?.screenId != null).length,
			targetRefs: steps.filter((s) => s.targetRef !== null).length,
			references: {
				total: refs.length,
				resolved: refs.filter((r) => r.row !== null).length,
				ambiguous: refs.filter((r) => r.ambiguous).length
			},
			diagnostics: result.diagnostics.filter((d) => d.sheet === p.sheet).length
		};
	});
	const total = {
		cases: 0,
		steps: 0,
		labels: emptyLabels(),
		resultCells: 0,
		specRefs: 0,
		targetRefs: 0,
		references: { total: 0, resolved: 0, ambiguous: 0 },
		diagnostics: 0
	};
	for (const s of sheets) {
		total.cases += s.cases;
		total.steps += s.steps;
		total.resultCells += s.resultCells;
		total.specRefs += s.specRefs;
		total.targetRefs += s.targetRefs;
		total.references.total += s.references.total;
		total.references.resolved += s.references.resolved;
		total.references.ambiguous += s.references.ambiguous;
		total.diagnostics += s.diagnostics;
		for (const key of Object.keys(total.labels) as AutomationLabel[]) total.labels[key] += s.labels[key];
	}
	const automatable = total.labels.auto + total.labels.proxy;
	return { sheets, total, automatableRatio: total.steps === 0 ? 0 : automatable / total.steps };
}
