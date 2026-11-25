import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
	cellText,
	columnIndex,
	normalize,
	readWorkbook,
	suggestProfile,
	summarize,
	writeResultCopy
} from '@auto-qa/tc';
import type { Grid, NormalizeResult, Summary, TcCase, TcProfile } from '@auto-qa/tc';

/**
 * P0-7 TC 엑셀 정규화 스파이크.
 *   pnpm spike:tc <파일.xlsx...> [--profile 확인한-프로필.json] [--out 폴더]
 * 파일마다 out/<이름>/ 에 profile.json(제안), cases.json, summary.json, result-probe.xlsx, report.html 을 만든다.
 * out/ 은 커밋하지 않는다 (회사 TC 내용이 들어 있음).
 */

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		profile: { type: 'string' },
		out: { type: 'string', default: join(import.meta.dirname, 'out') }
	}
});

if (positionals.length === 0) {
	console.error('사용법: pnpm spike:tc <파일.xlsx...> [--profile profile.json] [--out 폴더]');
	process.exit(1);
}
if (values.profile !== undefined && positionals.length > 1) {
	console.error('--profile 은 파일 하나와 함께만 쓸 수 있습니다.');
	process.exit(1);
}

interface ProbeResult {
	written: number;
	/** 기존 P/F 등 값이 있던 칸 (사본이라 덮어써서 위치를 확인) */
	existing: number;
	formula: string[];
	changedParts: string[];
	/** 쓴 표시가 기대한 칸에서 그대로 읽힌 수 */
	verified: number;
	misplaced: string[];
	/** 결과 칸 말고 값이 바뀐 칸 */
	changedOther: string[];
	sharedResultCells: string[];
}

/** 결과 칸에 단계마다 다른 표시를 써 보고, 다시 읽어 위치와 나머지 칸 보존을 확인한다 */
async function probeResultCells(source: string, output: string, grid: Grid, cases: TcCase[]): Promise<ProbeResult> {
	const steps = cases.flatMap((c) => c.steps);
	const byAddress = new Map<string, number>();
	for (const s of steps) {
		if (s.resultCell === null) continue;
		const key = `${s.resultCell.sheet}!${s.resultCell.address}`;
		byAddress.set(key, (byAddress.get(key) ?? 0) + 1);
	}
	const sharedResultCells = [...byAddress].filter(([, n]) => n > 1).map(([k]) => k);
	const writes = steps.flatMap((s) =>
		s.resultCell === null ? [] : [{ cell: s.resultCell, value: `AUTOQA ${s.resultCell.sheet}!${s.row}` }]
	);
	const report = await writeResultCopy(source, output, writes, { overwrite: true });
	const skippedKeys = new Set(report.formula.map((c) => `${c.sheet}!${c.address}`));

	const after = await readWorkbook(output);
	let verified = 0;
	const misplaced: string[] = [];
	const resultKeys = new Set<string>();
	for (const w of writes) {
		const key = `${w.cell.sheet}!${w.cell.address}`;
		resultKeys.add(`${w.cell.sheet}!${w.cell.row}:${columnIndex(w.cell.column)}`);
		if (skippedKeys.has(key)) continue;
		const sheet = after.sheets.find((s) => s.name === w.cell.sheet);
		const actual = sheet === undefined ? null : cellText(sheet, w.cell.row, columnIndex(w.cell.column));
		if (actual === w.value) verified++;
		else misplaced.push(`${key}: ${actual ?? '(빈 칸)'}`);
	}
	const changedOther: string[] = [];
	for (const before of grid.sheets) {
		const sheet = after.sheets.find((s) => s.name === before.name);
		const rows = Math.max(before.rows.length, sheet?.rows.length ?? 0);
		for (let r = 1; r <= rows; r++) {
			const cols = Math.max(before.rows[r - 1]?.length ?? 0, sheet?.rows[r - 1]?.length ?? 0);
			for (let c = 1; c <= cols; c++) {
				if (resultKeys.has(`${before.name}!${r}:${c}`)) continue;
				const a = cellText(before, r, c);
				const b = sheet === undefined ? null : cellText(sheet, r, c);
				if (a !== b && changedOther.length < 20) changedOther.push(`${before.name}!${r}:${c}`);
			}
		}
	}
	return {
		written: report.written,
		existing: steps.filter((s) => s.existingResult !== null).length,
		formula: [...skippedKeys],
		changedParts: report.changedParts,
		verified,
		misplaced,
		changedOther,
		sharedResultCells
	};
}

const esc = (text: string | null | undefined): string =>
	(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const pct = (n: number, d: number): string => (d === 0 ? '-' : `${Math.round((n / d) * 100)}%`);

function renderReport(
	file: string,
	profile: TcProfile,
	result: NormalizeResult,
	summary: Summary,
	probe: ProbeResult
): string {
	const sheetRows = summary.sheets
		.map((s) => {
			const p = profile.sheets.find((x) => x.sheet === s.sheet);
			const l = s.labels;
			return `<tr class="${s.included ? '' : 'off'}"><td>${esc(s.sheet)}</td><td>${s.kind}</td><td>${s.included ? '포함' : '제외'}</td>
<td>${s.cases}</td><td>${s.steps}</td><td>${l.auto}</td><td>${l.manual}</td><td>${l.deferred}</td>
<td>${s.references.resolved}/${s.references.total}${s.references.ambiguous > 0 ? ` (모호 ${s.references.ambiguous})` : ''}</td>
<td>${s.specRefs}</td><td>${s.targetRefs}</td><td>${s.diagnostics}</td>
<td>${p === undefined ? '' : Math.round(p.confidence * 100)}%</td><td class="ev">${(p?.evidence ?? []).map(esc).join('<br>')}</td></tr>`;
		})
		.join('');
	const t = summary.total;
	const ruleCounts = new Map<string, number>();
	for (const s of result.cases.flatMap((c) => c.steps)) {
		const key = `${s.automation} · ${s.automationRule} — ${s.automationReason}`;
		ruleCounts.set(key, (ruleCounts.get(key) ?? 0) + 1);
	}
	const rules = [...ruleCounts]
		.sort((a, b) => b[1] - a[1])
		.map(([k, n]) => `<li>${esc(k)}: ${n}</li>`)
		.join('');
	const diags = result.diagnostics
		.map((d) => `<li>${esc(d.sheet)}!${d.row} [${d.kind}] ${esc(d.message)}</li>`)
		.join('');
	// 시트마다 앞 2개 TC를 펼쳐 수작업 대조용으로 보여 준다
	const samples = profile.sheets
		.filter((p) => p.include)
		.flatMap((p) => result.cases.filter((c) => c.sheet === p.sheet).slice(0, 2))
		.map((c) => {
			const steps = c.steps
				.map(
					(
						s
					) => `<tr><td>${s.row}${s.rowSpan > 1 ? `~${s.row + s.rowSpan - 1}` : ''}</td><td>${esc(s.stepNo)}</td>
<td>${esc(s.precondition)}</td><td>${s.actions.map((a) => `<div>• ${esc(a)}</div>`).join('')}${s.targetRef === null ? '' : `<div class="ref">콜아웃 (${esc(s.targetRef.callout)}) ${esc(s.targetRef.label)}</div>`}${s.references.map((r) => `<div class="ref">→ 단계 ${esc(r.stepNo)} = ${r.row ?? '없음'}행${r.ambiguous ? ' (모호)' : ''}</div>`).join('')}</td>
<td>${esc(s.expected)}</td><td>${s.resultCell?.address ?? '-'}${s.existingResult === null ? '' : ` (${esc(s.existingResult)})`}</td><td>${s.automation}</td></tr>`
				)
				.join('');
			return `<details><summary>${esc(c.key)} · ${esc(c.id)} · ${esc(c.title)} · 단계 ${c.steps.length}${c.specRef?.screenId == null ? '' : ` · 화면설계서 ${esc(c.specRef.screenId)}`}</summary>
<table><tr><th>행</th><th>단계</th><th>사전 조건</th><th>조작</th><th>기대 결과</th><th>결과 칸</th><th>라벨</th></tr>${steps}</table></details>`;
		})
		.join('');
	return `<!doctype html><meta charset="utf-8"><title>P0-7 TC 정규화 — ${esc(file)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;max-width:1400px}table{border-collapse:collapse;width:100%;margin:8px 0}
td,th{border:1px solid #ccc;padding:4px 6px;vertical-align:top;text-align:left;white-space:pre-wrap}tr.off{color:#999}
.ev{font-size:12px;color:#555}.ref{font-size:12px;color:#06c}.ok{color:#080}.bad{color:#c00}details{margin:6px 0}summary{cursor:pointer}</style>
<h1>P0-7 TC 정규화 — ${esc(file)}</h1>
<p>TC <b>${t.cases}</b> · 단계 <b>${t.steps}</b> · 자동 ${t.labels.auto} · 수동 ${t.labels.manual} · 보류 ${t.labels.deferred}
· 자동화 가능 ${pct(t.labels.auto + t.labels.proxy, t.steps)} · 진단 ${t.diagnostics}</p>
<h2>결과 칸 쓰기 확인</h2>
<p class="${probe.misplaced.length === 0 && probe.changedOther.length === 0 && probe.formula.length === 0 ? 'ok' : 'bad'}">
사본(result-probe.xlsx)에 ${probe.written}칸 쓰기 → 같은 위치에서 ${probe.verified}칸 확인 (${pct(probe.verified, probe.written)}),
위치 어긋남 ${probe.misplaced.length}칸, 결과 칸 외 변경 ${probe.changedOther.length}칸, 수식이라 건너뜀 ${probe.formula.length}칸,
결과 칸을 함께 쓰는 단계 ${probe.sharedResultCells.length}곳. 기존 결과가 있던 칸 ${probe.existing}칸(사본이라 덮어씀).
바뀐 zip 파트: ${probe.changedParts.map(esc).join(', ')} (나머지 파트는 원본과 같음)</p>
${[...probe.misplaced, ...probe.changedOther, ...probe.sharedResultCells, ...probe.formula].length === 0 ? '' : `<ul>${[...probe.misplaced.map((m) => `어긋남 ${m}`), ...probe.changedOther.map((m) => `변경 ${m}`), ...probe.sharedResultCells.map((m) => `공유 ${m}`), ...probe.formula.map((m) => `수식 ${m}`)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`}
<h2>시트별 (프로필 제안)</h2>
<table><tr><th>시트</th><th>종류</th><th>포함</th><th>TC</th><th>단계</th><th>자동</th><th>수동</th><th>보류</th><th>앞 단계 참조</th><th>화면설계서 ID</th><th>콜아웃 참조</th><th>진단</th><th>신뢰도</th><th>근거</th></tr>${sheetRows}</table>
<h2>자동화 라벨 규칙별</h2><ul>${rules}</ul>
<h2>진단 (${result.diagnostics.length})</h2><ul>${diags || '<li>없음</li>'}</ul>
<h2>수작업 대조용 표본 (시트마다 앞 2개 TC)</h2>${samples}`;
}

const outRoot = resolve(values.out);
for (const file of positionals) {
	const path = resolve(file);
	const name = basename(path, extname(path)).replace(/[^\w.-]+/g, '_');
	const out = join(outRoot, name);
	await mkdir(out, { recursive: true });

	const grid = await readWorkbook(path);
	const suggested = suggestProfile(grid);
	const profile =
		values.profile === undefined
			? suggested
			: (JSON.parse(await readFile(resolve(values.profile), 'utf8')) as TcProfile);
	const result = normalize(grid, profile);
	const summary = summarize(profile, result);
	const probe = await probeResultCells(path, join(out, 'result-probe.xlsx'), grid, result.cases);

	await writeFile(join(out, 'profile.json'), `${JSON.stringify(suggested, null, '\t')}\n`);
	await writeFile(join(out, 'cases.json'), `${JSON.stringify(result, null, '\t')}\n`);
	await writeFile(join(out, 'summary.json'), `${JSON.stringify({ summary, probe }, null, '\t')}\n`);
	await writeFile(join(out, 'report.html'), renderReport(basename(path), profile, result, summary, probe));

	const t = summary.total;
	console.log(`\n${basename(path)}`);
	for (const s of summary.sheets) {
		console.log(
			`  ${s.included ? '✓' : '·'} ${s.sheet.padEnd(28)} ${s.kind.padEnd(16)} TC ${String(s.cases).padStart(3)} 단계 ${String(s.steps).padStart(4)}`
		);
	}
	console.log(
		`  합계 TC ${t.cases} · 단계 ${t.steps} · 자동 ${t.labels.auto} / 수동 ${t.labels.manual} / 보류 ${t.labels.deferred} · 진단 ${t.diagnostics}`
	);
	console.log(
		`  결과 칸: ${probe.verified}/${probe.written} 확인, 어긋남 ${probe.misplaced.length}, 다른 칸 변경 ${probe.changedOther.length}, 수식 ${probe.formula.length}, 공유 ${probe.sharedResultCells.length} (기존 결과 ${probe.existing}칸은 사본에서 덮어씀)`
	);
	console.log(`  → ${join(out, 'report.html')}`);
}
