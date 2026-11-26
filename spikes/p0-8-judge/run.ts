/**
 * P0-8 판정 규칙 스파이크 (D-037)
 *
 *   pnpm spike:judge <TC.xlsx> [--screen 4] [--all] [--truth 정답.local.json] [--out 폴더]
 *
 * TC 기대 결과를 조건으로 나누고 조건마다 판정 방법(코드 / AI / 확인 불가)을 정한다.
 * 기본은 자동화 라벨이 auto인 단계만 본다(--all이면 모두). 정답이 있으면 조건별 판정 방법 정확도를 잰다.
 * 결과에는 회사 TC 문장이 들어가므로 out/(커밋 안 함)에만 쓴다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { splitClauses } from '@auto-qa/judge';
import type { CheckMethod, Clause } from '@auto-qa/judge';
import { normalize, readWorkbook, suggestProfile } from '@auto-qa/tc';

const TRUTH_FORMAT = 'auto-qa-judge-truth';

interface Truth {
	format: string;
	version: number;
	/** "시트!행" → 조건 순번(1부터) → 판정 방법 ("code" | "ai" | "none" | "code+none" 처럼 여러 개는 +로) */
	steps: Record<string, Record<string, string>>;
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		screen: { type: 'string', default: '' },
		all: { type: 'boolean', default: false },
		truth: { type: 'string' },
		out: { type: 'string', default: join(import.meta.dirname, 'out') }
	}
});
const cwd = process.env['INIT_CWD'] ?? process.cwd();

/** 조건의 판정 방법 묶음 (정렬해 "+"로 잇는다) */
function methods(c: Clause): string {
	return [...new Set(c.checks.map((k) => k.method))].sort().join('+');
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function main(): Promise<void> {
	const file = positionals[0];
	if (file === undefined) throw new Error('TC 엑셀 경로를 주세요: pnpm spike:judge <TC.xlsx>');
	const grid = await readWorkbook(resolve(cwd, file));
	const result = normalize(grid, suggestProfile(grid));
	const truth: Truth | null =
		values.truth === undefined ? null : (JSON.parse(await readFile(resolve(cwd, values.truth), 'utf8')) as Truth);
	if (truth !== null && truth.format !== TRUTH_FORMAT)
		throw new Error(`정답 파일 형식이 아님 (format: ${TRUTH_FORMAT})`);

	const prefix = values.screen;
	const lines: string[] = ['# 판정 규칙 스파이크 (P0-8, D-037)', ''];
	const byMethod = new Map<string, number>();
	const byKind = new Map<string, number>();
	let steps = 0;
	let clauses = 0;
	let stepsAllNone = 0;
	let labelled = 0;
	let correct = 0;
	const wrong: string[] = [];

	for (const c of result.cases) {
		const screen = c.specRef?.screenId ?? '';
		if (prefix !== '' && screen !== prefix && !screen.startsWith(`${prefix}.`)) continue;
		for (const s of c.steps) {
			if (!values.all && s.automation !== 'auto') continue;
			if (s.expected === null || s.expected.trim() === '') continue;
			steps++;
			const key = `${c.sheet}!${s.row}`;
			const parts = splitClauses(s.expected);
			if (parts.length > 0 && parts.every((p) => p.checks.every((k) => k.method === 'none'))) stepsAllNone++;
			lines.push(
				`## ${key} [${screen}] ${cell(c.title ?? '')}`,
				'',
				'| # | 묶음 | 조건 | 판정 방법 | 근거 | 정답 |',
				'|---|---|---|---|---|---|'
			);
			parts.forEach((p, i) => {
				clauses++;
				const m = methods(p);
				for (const k of p.checks) {
					byMethod.set(k.method, (byMethod.get(k.method) ?? 0) + 1);
					byKind.set(k.kind, (byKind.get(k.kind) ?? 0) + 1);
				}
				const want = truth?.steps[key]?.[String(i + 1)];
				let mark = '';
				if (want !== undefined) {
					labelled++;
					if (want === m) {
						correct++;
						mark = '✓';
					} else {
						mark = `✗ ${want}`;
						wrong.push(`- ${key} #${i + 1} "${p.text.slice(0, 80)}" → ${m} (정답 ${want})`);
					}
				}
				lines.push(
					`| ${i + 1} | ${cell(p.section ?? '')} | ${cell(p.text)} | ${p.checks.map((k) => `${k.kind}:${k.method}`).join(', ')} | ${cell(p.checks.map((k) => k.reason).join(' / '))} | ${mark} |`
				);
			});
			lines.push('');
		}
	}

	const pct = (n: number, d: number): string => (d === 0 ? '-' : `${n}/${d} (${Math.round((n / d) * 100)}%)`);
	const method = (m: CheckMethod): number => byMethod.get(m) ?? 0;
	const totalChecks = method('code') + method('ai') + method('none');
	const summary = [
		`단계 ${steps}개, 조건 ${clauses}개, 판정 항목 ${totalChecks}개 — 코드 ${pct(method('code'), totalChecks)}, AI ${pct(method('ai'), totalChecks)}, 확인 불가 ${pct(method('none'), totalChecks)}`,
		`종류: ${[...byKind.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([k, n]) => `${k} ${n}`)
			.join(', ')}`,
		`화면으로 확인할 조건이 없는 단계: ${stepsAllNone}개 (→ 확인 필요)`,
		truth === null ? '정답 없음 (--truth로 정확도 측정)' : `조건별 판정 방법 정확: ${pct(correct, labelled)}`
	];
	lines.splice(2, 0, ...summary.map((s) => `- ${s}`), '');
	if (wrong.length > 0) lines.push('## 틀린 분류', '', ...wrong, '');

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const out = join(resolve(cwd, values.out), stamp);
	await mkdir(out, { recursive: true });
	await writeFile(join(out, 'judge.md'), `${lines.join('\n')}\n`);
	for (const s of summary) console.log(s);
	if (wrong.length > 0) console.log(`\n틀린 분류\n${wrong.join('\n')}`);
	console.log(`\n→ ${join(out, 'judge.md')}`);
}

await main();
