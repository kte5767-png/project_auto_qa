/**
 * P0-8 경로 계산 스파이크 (D-036)
 *
 *   pnpm spike:route <내보내기.json ...> [--truth 정답.local.json] [--alias "문장 속 이름=콜아웃 이름" ...] [--out 폴더]
 *   pnpm spike:route                       # 합성 화면설계서로 흐름만 확인
 *
 * 화면설계서 콜아웃의 키 동작 문장을 이동으로 해석하고(이동 지도), 정답이 있으면 해석 정확도를 잰다.
 * 콜아웃 사이(첫 항목 → 첫 항목) 경로가 몇 개나 계산되는지도 센다.
 * 결과에는 회사 화면설계서 문장이 들어가므로 out/(커밋 안 함)에만 쓴다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeExport, normalizeFrame, parseExport } from '@auto-qa/figma';
import type { NormalizedFrame } from '@auto-qa/figma';
import {
	DEFAULT_KEYMAP_OPTIONS,
	DEFAULT_ROUTE_OPTIONS,
	buildKeyMap,
	describeEffect,
	navScreenFromSpec,
	planRoute
} from '@auto-qa/planner';
import type { KeyAction, NavScreen } from '@auto-qa/planner';
import { extractSpecScreen, mergeSpecScreens } from '@auto-qa/spec';
import type { SpecScreen } from '@auto-qa/spec';
import { sampleSpecPage } from '@auto-qa/spec/testing';

const TRUTH_FORMAT = 'auto-qa-route-truth';

interface Truth {
	format: string;
	version: number;
	/** 화면 번호 → "콜아웃:키" → 기대 해석 (describeEffect 형식) */
	screens: Record<string, Record<string, string>>;
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		truth: { type: 'string' },
		/** 사람이 정한 다른 이름 "문장 속 이름=콜아웃 이름" (여러 번) */
		alias: { type: 'string', multiple: true, default: [] },
		out: { type: 'string', default: join(import.meta.dirname, 'out') }
	}
});
const cwd = process.env['INIT_CWD'] ?? process.cwd();

/** 이름으로 못 정한 동작은 키 방향 후보로 바꿔 본 해석 */
function withEstimate(a: KeyAction): string {
	const e = a.effect;
	if ((e.kind === 'element' || e.kind === 'unknown') && a.estimate !== null) {
		return `move:${a.estimate.to}:first${e.kind === 'element' && e.memory ? '+memory' : ''}`;
	}
	return describeEffect(e);
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function load(): Promise<{ screens: NavScreen[]; files: string[] }> {
	const specs: SpecScreen[] = [];
	const frames = new Map<string, NormalizedFrame>();
	const files = positionals.map((p) => resolve(cwd, p));
	if (files.length === 0) {
		const frame = normalizeFrame(sampleSpecPage());
		frames.set(frame.id, frame);
		specs.push(extractSpecScreen(frame));
	}
	for (const f of files) {
		const data = parseExport(JSON.parse(await readFile(f, 'utf8')));
		for (const a of analyzeExport(data)) {
			if (a.kind !== 'spec') continue;
			frames.set(a.frame.id, a.frame);
			specs.push(extractSpecScreen(a.frame));
		}
	}
	const screens = mergeSpecScreens(specs)
		.map((m) => navScreenFromSpec(m, frames))
		.filter((s) => s.callouts.some((c) => Object.keys(c.keys).length > 0));
	return { screens, files };
}

async function main(): Promise<void> {
	const { screens, files } = await load();
	let truth: Truth | null = null;
	if (values.truth !== undefined) {
		const t = JSON.parse(await readFile(resolve(cwd, values.truth), 'utf8')) as Truth;
		if (t.format !== TRUTH_FORMAT) throw new Error(`정답 파일 형식이 아님 (format: ${TRUTH_FORMAT})`);
		truth = t;
	}

	const aliases: Record<string, string[]> = {};
	for (const a of values.alias) {
		const [said, name] = a.split('=').map((x) => x.trim());
		if (said === undefined || name === undefined || said === '' || name === '')
			throw new Error(`--alias 형식: "문장 속 이름=콜아웃 이름" (${a})`);
		(aliases[name] ??= []).push(said);
	}
	const keymapOptions = { ...DEFAULT_KEYMAP_OPTIONS, aliases };

	const lines: string[] = ['# 경로 계산 스파이크 (P0-8, D-036)', ''];
	lines.push(files.length === 0 ? '입력: 합성 화면설계서' : `입력: ${files.length}개 파일`, '');
	if (values.alias.length > 0) lines.push(`사람이 정한 다른 이름: ${values.alias.length}개`, '');
	let total = 0;
	let strictOk = 0;
	let estimateOk = 0;
	const kinds = new Map<string, number>();
	const wrong: string[] = [];
	let pairs = 0;
	let routedStrict = 0;
	let routedEstimated = 0;

	for (const screen of screens) {
		const id = screen.screenId ?? '?';
		const map = buildKeyMap(screen, keymapOptions);
		const expected = truth?.screens[id] ?? {};
		lines.push(`## ${id} ${screen.title ?? ''}`, '');
		lines.push('| 콜아웃 | 키 | 문장 | 해석 | 키 방향 후보 | 정답 | 근거 |', '|---|---|---|---|---|---|---|');
		for (const a of map) {
			const strict = describeEffect(a.effect);
			kinds.set(a.effect.kind, (kinds.get(a.effect.kind) ?? 0) + 1);
			const want = expected[`${a.from}:${a.key}`];
			let mark = '';
			if (want !== undefined) {
				total++;
				const okStrict = strict === want;
				const okEstimate = withEstimate(a) === want;
				if (okStrict) strictOk++;
				if (okEstimate) estimateOk++;
				mark = okStrict ? '✓' : okEstimate ? '△ (후보로 맞음)' : `✗ ${want}`;
				if (!okStrict)
					wrong.push(
						`- ${id} ${a.from}번 ${a.key}: "${a.text}" → ${strict} (정답 ${want}${okEstimate ? ', 키 방향 후보는 맞음' : ''})`
					);
			}
			lines.push(
				`| ${a.from} | ${a.key} | ${cell(a.text)} | ${strict}${a.endNoop ? ' (끝에서 멈춤)' : ''} | ${a.estimate?.to ?? ''} | ${mark} | ${cell(a.reason)} |`
			);
		}
		lines.push('');

		// 콜아웃 사이 경로 (첫 항목 → 첫 항목)
		const nos = screen.callouts.filter((c) => Object.keys(c.keys).length > 0).map((c) => c.no);
		const rows: string[] = [];
		for (const from of nos) {
			for (const to of nos) {
				if (from === to) continue;
				pairs++;
				const strict = planRoute(map, { callout: from, position: 1 }, { callout: to, position: 1 }, [], {
					...DEFAULT_ROUTE_OPTIONS,
					allowEstimated: false
				});
				const est = planRoute(map, { callout: from, position: 1 }, { callout: to, position: 1 });
				if (strict.ok) routedStrict++;
				if (est.ok) routedEstimated++;
				rows.push(
					`| ${from} → ${to} | ${strict.ok ? strict.keys.join(' ') : '없음'} | ${est.ok ? `${est.keys.join(' ')}${est.estimated ? ' (추정 포함)' : ''}` : cell(est.reason)} |`
				);
			}
		}
		if (rows.length > 0) {
			lines.push('| 경로 | 이름으로 정한 길만 | 키 방향 후보 포함 |', '|---|---|---|', ...rows, '');
		}
	}

	const pct = (n: number, d: number): string => (d === 0 ? '-' : `${n}/${d} (${Math.round((n / d) * 100)}%)`);
	const summary = [
		`화면 ${screens.length}개, 키 동작 ${[...kinds.values()].reduce((a, b) => a + b, 0)}줄 — ${[...kinds.entries()].map(([k, n]) => `${k} ${n}`).join(', ')}`,
		truth === null
			? '정답 없음 (--truth로 정확도 측정)'
			: `해석 정확: ${pct(strictOk, total)}, 키 방향 후보까지: ${pct(estimateOk, total)}`,
		`콜아웃 사이 경로: 이름으로 정한 길만 ${pct(routedStrict, pairs)}, 키 방향 후보 포함 ${pct(routedEstimated, pairs)}`
	];
	lines.splice(3, 0, ...summary.map((s) => `- ${s}`), '');
	if (wrong.length > 0) lines.push('## 틀린 해석', '', ...wrong, '');

	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const out = join(resolve(cwd, values.out), stamp);
	await mkdir(out, { recursive: true });
	await writeFile(join(out, 'routes.md'), `${lines.join('\n')}\n`);
	for (const s of summary) console.log(s);
	if (wrong.length > 0) console.log(`\n틀린 해석\n${wrong.join('\n')}`);
	console.log(`\n→ ${join(out, 'routes.md')}`);
}

await main();
