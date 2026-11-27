/**
 * 일부러 틀린 TC 사본 만들기 (Fail 검출률 측정). 원본 QA 결과가 모두 Pass이면 일치율만으로는
 * "무엇이든 Pass를 주는 엔진"과 구별이 안 된다. 그래서 원래 실행(--baseline)에서 Pass였던 조건을
 * 단계마다 종류별로 하나씩 앱과 다르게 바꾼 TC 사본을 만들고, 그 사본을 같은 앱에 돌려 엔진이 Fail로 잡는지 본다.
 * 종류(--kinds): key(동작 없음 ↔ 이동), count(최대 N개 → 보인 개수보다 작게), exact-text(정해진 문구 → 다른 문구)
 *
 *   pnpm spike:tc-mutate <TC.xlsx> --baseline out/tc-<시각>/result.json --out <틀린 TC.xlsx> [--sheet Search] [--kinds key,count,exact-text]
 *   pnpm spike:tc-run <틀린 TC.xlsx> --profile … --spec … --mutations <틀린 TC.xlsx>.mutations.json
 *   pnpm spike:tc-run --score out/tc-<시각>/result.json --mutations <틀린 TC.xlsx>.mutations.json
 *
 * 원본은 읽기만 한다. 바꾼 것은 기대 결과 칸의 조건 줄뿐이고(바꾼 목록: <out>.mutations.json), 앱·데이터와 무관하다.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { keyLines, mutateCount, mutateExactText, mutateKeyLine } from '@auto-qa/judge';
import type { KeyMutation, ValueMutation } from '@auto-qa/judge';
import { normalize, readWorkbook, suggestProfile, writeResultCopy } from '@auto-qa/tc';
import type { CellRef, ResultWrite, TcCase } from '@auto-qa/tc';

export const MUTATIONS_FORMAT = 'auto-qa/tc-mutations';

export type MutationKind = 'key' | 'count' | 'exact-text';

export const MUTATION_KINDS: readonly MutationKind[] = ['key', 'count', 'exact-text'];

export interface MutationEntry {
	key: string;
	/** 바꾼 조건 종류 — 실행 결과에서 같은 종류·같은 조건 글자를 찾는다 */
	kind: MutationKind;
	cell: CellRef;
	op: KeyMutation['op'] | ValueMutation['op'];
	before: string;
	after: string;
}

export interface MutationManifest {
	format: typeof MUTATIONS_FORMAT;
	version: 1;
	source: string;
	baseline: string;
	createdAt: string;
	mutations: MutationEntry[];
	/** 바꾸지 못한 단계와 이유 (측정에서 빠진다) */
	skipped: { key: string; reason: string }[];
}

interface BaselineStep {
	key: string;
	status: string;
	results: {
		clause: string;
		kind: string;
		verdict: string | null;
		value?: string | number | null;
		observed?: number;
	}[];
}

/** 같은 화면의 콜아웃 이름 (콜아웃 번호 순) — "동작 없음"을 다른 콜아웃으로 가라고 바꿀 때 쓴다 */
function calloutLabels(cases: readonly TcCase[]): Map<string, { callout: string; label: string }[]> {
	const out = new Map<string, { callout: string; label: string }[]>();
	for (const c of cases) {
		const screen = c.specRef?.screenId ?? '';
		if (screen === '') continue;
		const list = out.get(screen) ?? [];
		for (const s of c.steps) {
			const ref = s.targetRef;
			if (ref === null || ref.label.trim() === '' || list.some((l) => l.callout === ref.callout)) continue;
			list.push(ref);
		}
		list.sort((a, b) => a.callout.localeCompare(b.callout, undefined, { numeric: true }));
		out.set(screen, list);
	}
	return out;
}

/**
 * 단계마다 종류별로 Pass였던 조건 하나씩 바꾼다. 같은 칸에 여러 종류를 바꾸면 차례로 겹쳐 쓴다
 * (키 줄을 바꾸면 그 줄에 붙은 아래 줄만 지우므로 다른 줄의 조건은 그대로 남는다).
 */
export function planMutations(
	cases: readonly TcCase[],
	baseline: readonly BaselineStep[],
	expectedColumn: (sheet: string) => string | undefined,
	sheet: string | null,
	kinds: readonly MutationKind[] = ['key']
): { mutations: (MutationEntry & { text: string })[]; skipped: { key: string; reason: string }[] } {
	const labels = calloutLabels(cases);
	const byKey = new Map(baseline.map((b) => [b.key, b]));
	const mutations: (MutationEntry & { text: string })[] = [];
	const skipped: { key: string; reason: string }[] = [];
	for (const c of cases) {
		if (sheet !== null && c.sheet !== sheet) continue;
		for (const s of c.steps) {
			const key = `${c.sheet}!${s.row}`;
			const b = byKey.get(key);
			if (b === undefined) continue;
			const passed = b.results.filter((r) => r.verdict === 'pass' && kinds.includes(r.kind as MutationKind));
			if (passed.length === 0) {
				skipped.push({ key, reason: `원래 실행에서 Pass인 조건이 없음 (${kinds.join(', ')})` });
				continue;
			}
			const column = expectedColumn(c.sheet);
			if (column === undefined) {
				skipped.push({ key, reason: '기대 결과 열을 모름' });
				continue;
			}
			const cell: CellRef = { sheet: c.sheet, row: s.row, column, address: `${column}${s.row}` };
			let text = s.expected ?? '';
			const done: (MutationEntry & { text: string })[] = [];
			for (const kind of kinds) {
				const m = mutateOne(kind, text, passed, labels, c, s.targetRef?.callout ?? null);
				if (m === null) continue;
				text = m.text;
				done.push({ key, kind, cell, op: m.op, before: m.before, after: m.after, text });
			}
			if (done.length === 0) {
				skipped.push({ key, reason: 'Pass인 조건을 바꿀 수 없음 (다른 콜아웃 이름·보인 개수·문구 없음)' });
				continue;
			}
			// 한 칸에는 모두 겹친 마지막 글자를 쓴다
			mutations.push(...done.map((d) => ({ ...d, text })));
		}
	}
	return { mutations, skipped };
}

function mutateOne(
	kind: MutationKind,
	expected: string,
	passed: BaselineStep['results'],
	labels: Map<string, { callout: string; label: string }[]>,
	c: TcCase,
	callout: string | null
): KeyMutation | ValueMutation | null {
	const mine = passed.filter((r) => r.kind === kind);
	if (kind === 'key') {
		const clauses = new Set(mine.map((r) => r.clause));
		const others = (labels.get(c.specRef?.screenId ?? '') ?? [])
			.filter((l) => l.callout !== callout)
			.map((l) => l.label);
		for (const line of keyLines(expected)) {
			if (!clauses.has(line.clause)) continue;
			const m = mutateKeyLine(expected, line, others);
			if (m !== null) return m;
		}
		return null;
	}
	for (const r of mine) {
		let m: ValueMutation | null = null;
		if (kind === 'count' && r.observed !== undefined) m = mutateCount(expected, r.clause, r.observed);
		if (kind === 'exact-text' && typeof r.value === 'string') m = mutateExactText(expected, r.clause, r.value);
		if (m !== null) return m;
	}
	return null;
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			baseline: { type: 'string' },
			out: { type: 'string' },
			sheet: { type: 'string' },
			kinds: { type: 'string', default: 'key' },
			force: { type: 'boolean', default: false }
		}
	});
	const cwd = process.env['INIT_CWD'] ?? process.cwd();
	const input = positionals[0];
	if (input === undefined || values.baseline === undefined || values.out === undefined) {
		throw new Error(
			'사용법: tc-mutate <TC.xlsx> --baseline <result.json> --out <틀린 TC.xlsx> [--sheet Search] [--kinds key,count,exact-text]'
		);
	}
	const kinds = values.kinds
		.split(',')
		.map((k) => k.trim())
		.filter((k) => k !== '');
	const unknown = kinds.filter((k) => !MUTATION_KINDS.includes(k as MutationKind));
	if (kinds.length === 0 || unknown.length > 0) {
		throw new Error(`--kinds는 ${MUTATION_KINDS.join(', ')} 중에서 고릅니다 (모름: ${unknown.join(', ')})`);
	}
	const source = resolve(cwd, input);
	const out = resolve(cwd, values.out);
	if (source === out) throw new Error('원본에는 쓰지 않습니다. --out에 다른 경로를 주세요.');
	if (existsSync(out) && !values.force) throw new Error(`이미 있는 파일입니다 (덮어쓰려면 --force): ${out}`);

	const grid = await readWorkbook(source);
	const profile = suggestProfile(grid);
	const { cases } = normalize(grid, profile);
	const saved = JSON.parse(await readFile(resolve(cwd, values.baseline), 'utf8')) as { steps?: BaselineStep[] };
	const plan = planMutations(
		cases,
		saved.steps ?? [],
		(sheet) => profile.sheets.find((p) => p.sheet === sheet)?.columns.expected,
		values.sheet ?? null,
		kinds as MutationKind[]
	);
	// 한 칸을 여러 종류로 바꿨으면 같은 글자가 여러 번 나온다 — 칸마다 한 번만 쓴다
	const byCell = new Map<string, ResultWrite>();
	for (const m of plan.mutations) byCell.set(`${m.cell.sheet}!${m.cell.address}`, { cell: m.cell, value: m.text });
	const writes = [...byCell.values()];
	const report = await writeResultCopy(source, out, writes, { overwrite: true });
	const manifest: MutationManifest = {
		format: MUTATIONS_FORMAT,
		version: 1,
		source: basename(source),
		baseline: basename(resolve(cwd, values.baseline, '..')),
		createdAt: new Date().toISOString(),
		mutations: plan.mutations.map((m) => ({
			key: m.key,
			kind: m.kind,
			cell: m.cell,
			op: m.op,
			before: m.before,
			after: m.after
		})),
		skipped: plan.skipped
	};
	await writeFile(`${out}.mutations.json`, `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(`틀린 TC: ${out} (바꾼 단계 ${plan.mutations.length}개, 쓴 칸 ${report.written}개)`);
	for (const m of plan.mutations) console.log(`  ${m.key} ${m.kind}/${m.op}: ${m.before} → ${m.after}`);
	for (const s of plan.skipped) console.log(`  ${s.key} 건너뜀: ${s.reason}`);
	console.log(`바꾼 목록: ${out}.mutations.json`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	main().catch((e: unknown) => {
		console.error(e instanceof Error ? e.message : e);
		process.exit(1);
	});
}
