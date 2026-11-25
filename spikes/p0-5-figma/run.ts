import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeExport, elementById, isShown, parseExport } from '@auto-qa/figma';
import type { FigmaExport, FrameAnalysis } from '@auto-qa/figma';
import { sampleExport, sampleHomeFrame, sampleSpecFrame } from '@auto-qa/figma/testing';

/**
 * P0-5 Figma 내보내기 스파이크.
 *   pnpm spike:figma <내보내기.json...> [--out 폴더]
 *   pnpm spike:figma --sample          # 합성 데이터로 확인
 * 파일마다 out/<이름>/ 에 analysis.json, report.html 을 만든다. out/ 은 커밋하지 않는다 (디자인 내용이 들어 있음).
 */

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: 'string', default: join(import.meta.dirname, 'out') },
		sample: { type: 'boolean', default: false }
	}
});

if (positionals.length === 0 && !values.sample) {
	console.error('사용법: pnpm spike:figma <내보내기.json...> [--out 폴더] | --sample');
	process.exit(1);
}

const esc = (text: string | null | undefined): string =>
	(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#eab308', '#14b8a6', '#ec4899', '#64748b', '#f97316'];

function summary(a: FrameAnalysis) {
	const f = a.frame;
	const name = (id: string) => elementById(f, id)?.name ?? id;
	const texts = { fixed: 0, data: 0, ordinal: 0 };
	for (const t of a.textClasses.values()) texts[t.class]++;
	return {
		frame: { id: f.id, name: f.name, page: f.pageName, width: f.width, height: f.height },
		kind: a.kind,
		kindReason: a.kindReason,
		counts: a.counts,
		texts,
		groups: a.groups.map((g) => ({ ...g, parentName: name(g.parentId), memberNames: g.memberIds.map(name) })),
		focus: {
			primary:
				a.focus.primary === null ? null : { ...a.focus.primary, memberName: name(a.focus.primary.memberId) },
			ambiguous: a.focus.ambiguous,
			candidates: a.focus.candidates.map((c) => ({ ...c, memberName: name(c.memberId) })),
			skipped: a.focus.skipped
		},
		anchors: a.anchors
	};
}

function overlay(a: FrameAnalysis, image: string | null): string {
	const f = a.frame;
	const rect = (id: string, color: string, width: number, dash = '') => {
		const e = elementById(f, id);
		if (e === undefined) return '';
		const r = e.rect;
		return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${color}" stroke-width="${width}"${dash === '' ? '' : ` stroke-dasharray="${dash}"`}><title>${esc(e.name)}</title></rect>`;
	};
	const groups = a.groups
		.map((g, i) => g.memberIds.map((id) => rect(id, COLORS[i % COLORS.length] ?? '#999', 3, '12 6')).join(''))
		.join('');
	const candidates = a.focus.candidates
		.slice(1)
		.map((c) => rect(c.memberId, '#f97316', 6))
		.join('');
	const primary = a.focus.primary === null ? '' : rect(a.focus.primary.memberId, '#ef4444', 10);
	const bg =
		image === null
			? `<rect width="${f.width}" height="${f.height}" fill="#222"/>`
			: `<image href="data:image/png;base64,${image}" width="${f.width}" height="${f.height}"/>`;
	return `<svg viewBox="0 0 ${f.width} ${f.height}" style="width:100%;max-width:960px;border:1px solid #ccc">${bg}${groups}${candidates}${primary}</svg>`;
}

function renderFrame(a: FrameAnalysis, image: string | null): string {
	const s = summary(a);
	const f = a.frame;
	const textExamples = (cls: string) =>
		[...a.textClasses]
			.filter(([, v]) => v.class === cls)
			.map(([id]) => elementById(f, id))
			.filter((e) => e !== undefined && isShown(e))
			.slice(0, 12)
			.map((e) => esc(e?.text?.characters.split('\n')[0] ?? ''))
			.join(' · ');
	const focus = s.focus.primary;
	return `<section>
<h2>${esc(f.name)} <small>(${esc(f.pageName)}, ${f.width}×${f.height})</small></h2>
<p>종류: <b>${s.kind}</b> — ${esc(s.kindReason)} · 요소 ${s.counts.total} (보임 ${s.counts.shown}, 걸침 ${s.counts.partial}, 경계 밖 ${s.counts.clipped}, 숨김 ${s.counts.hidden})</p>
${a.kind === 'gui' ? overlay(a, image) : ''}
<p class="legend"><span style="color:#ef4444">■ 포커스 추정</span> <span style="color:#f97316">■ 다른 후보</span> <span>점선 = 반복 묶음(색별)</span></p>
${
	a.kind !== 'gui'
		? ''
		: focus === null
			? '<p class="bad">포커스 요소를 찾지 못함</p>'
			: `<h3>포커스 추정${s.focus.ambiguous ? ' <span class="bad">(확인 필요: 비슷한 후보 있음)</span>' : ''}</h3>
<p><b>${esc(focus.memberName)}</b> 점수 ${focus.score} — 기준 멤버 ${esc(elementById(f, focus.typicalId)?.name)}</p>
<ul>${focus.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
<p>기대 포커스 스타일: ${esc(JSON.stringify(focus.style))}</p>
${
	s.focus.candidates.length > 1
		? `<p>다른 후보: ${s.focus.candidates
				.slice(1)
				.map((c) => `${esc(c.memberName)} (${c.score}: ${esc(c.evidence.join(', '))})`)
				.join(' / ')}</p>`
		: ''
}`
}
<h3>반복 묶음 ${s.groups.length}개</h3>
<table><tr><th>부모</th><th>멤버</th><th>배치</th><th>간격</th><th>화면에 보이는 수</th></tr>
${s.groups.map((g, i) => `<tr><td><span style="color:${COLORS[i % COLORS.length]}">■</span> ${esc(g.parentName)}</td><td>${g.memberIds.length}</td><td>${g.axis}</td><td>${g.gap ?? '-'}</td><td>${g.shownCount}</td></tr>`).join('')}</table>
<h3>글자 분류</h3>
<p>고정 ${s.texts.fixed}: ${textExamples('fixed')}</p>
<p>예시 데이터 ${s.texts.data}: ${textExamples('data')}</p>
<p>순번 ${s.texts.ordinal}: ${textExamples('ordinal')}</p>
<h3>앵커 ${s.anchors.length}개</h3>
<p>${s.anchors.map((x) => `${x.reason}: ${esc(x.label.split('\n')[0])}`).join(' · ')}</p>
</section>`;
}

async function run(name: string, data: FigmaExport): Promise<void> {
	const out = join(resolve(values.out), name);
	await mkdir(out, { recursive: true });
	const analyses = analyzeExport(data);
	await writeFile(
		join(out, 'analysis.json'),
		`${JSON.stringify({ file: data.file, warnings: data.warnings, frames: analyses.map(summary) }, null, '\t')}\n`
	);
	const html = `<!doctype html><meta charset="utf-8"><title>P0-5 Figma — ${esc(data.file.name)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;max-width:1100px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left}
section{border-top:2px solid #333;margin-top:24px}.bad{color:#c00}.legend{font-size:12px}small{color:#666;font-weight:normal}</style>
<h1>P0-5 Figma 내보내기 확인 — ${esc(data.file.name)}</h1>
<p>프레임 ${data.frames.length}개 · 플러그인 ${esc(data.plugin.version)} · ${esc(data.exportedAt)}${data.warnings.length > 0 ? ` · <span class="bad">경고 ${data.warnings.length}</span>` : ''}</p>
${data.warnings.length > 0 ? `<ul>${data.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
${analyses.map((a, i) => renderFrame(a, data.frames[i]?.image?.data ?? null)).join('')}`;
	await writeFile(join(out, 'report.html'), html);

	console.log(`\n${data.file.name} (${data.frames.length}프레임)`);
	for (const a of analyses) {
		const p = a.focus.primary;
		const focus =
			a.kind !== 'gui'
				? ''
				: p === null
					? ' 포커스 없음'
					: ` 포커스 ${elementById(a.frame, p.memberId)?.name ?? p.memberId} (${p.score}${a.focus.ambiguous ? ', 확인 필요' : ''})`;
		console.log(
			`  ${a.kind.padEnd(7)} ${a.frame.name} — 요소 ${a.counts.total}, 묶음 ${a.groups.length}, 앵커 ${a.anchors.length}${focus}`
		);
	}
	console.log(`  → ${join(out, 'report.html')}`);
}

if (values.sample) {
	const data = sampleExport([sampleHomeFrame(), sampleSpecFrame()]);
	await mkdir(resolve(values.out), { recursive: true });
	await writeFile(join(resolve(values.out), 'sample-export.json'), JSON.stringify(data));
	await run('sample', data);
}
for (const file of positionals) {
	const path = resolve(file);
	const data = parseExport(JSON.parse(await readFile(path, 'utf8')));
	await run(basename(path, extname(path)).replace(/[^\w.-]+/g, '_'), data);
}
