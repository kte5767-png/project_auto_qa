import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeExport, elementById, isShown, parseExport } from '@auto-qa/figma';
import type { FigmaExport, FrameAnalysis } from '@auto-qa/figma';
import { sampleExport, sampleHomeFrame } from '@auto-qa/figma/testing';
import { extractSpecScreen } from '@auto-qa/spec';
import type { SpecScreen } from '@auto-qa/spec';
import { sampleGuiFrame, sampleSpecPage } from '@auto-qa/spec/testing';
import { linkAll, measure, renderLinks } from './link';
import type { FrameSource, Truth } from './link';

/**
 * P0-5 Figma 내보내기 스파이크.
 *   pnpm spike:figma <내보내기.json...> [--out 폴더]
 *   pnpm spike:figma --sample          # 합성 데이터로 확인
 *   pnpm spike:figma <화면설계서.json> <GUI.json> [--truth 정답.local.json]
 * 파일마다 out/<이름>/ 에 analysis.json, report.html 을 만든다. out/ 은 커밋하지 않는다 (디자인 내용이 들어 있음).
 * 화면설계서와 GUI 프레임이 모두 있으면 out/link/ 에 연결 리포트를 만든다 (파일 여러 개를 합쳐서 본다).
 * 정답 파일은 회사 디자인 정보가 들어 있으므로 *.local.json 으로 두고 커밋하지 않는다.
 */

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: 'string', default: join(import.meta.dirname, 'out') },
		sample: { type: 'boolean', default: false },
		truth: { type: 'string' }
	}
});

/** pnpm 스크립트는 패키지 폴더에서 돌므로, 상대 경로는 명령을 친 폴더(INIT_CWD) 기준으로 푼다 */
const fromCwd = (path: string): string => resolve(process.env.INIT_CWD ?? process.cwd(), path);

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
		anchors: a.anchors,
		spec: a.kind === 'spec' ? extractSpecScreen(a.frame) : null
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

function specOverlay(a: FrameAnalysis, spec: SpecScreen, image: string | null): string {
	const f = a.frame;
	const box = (r: { x: number; y: number; width: number; height: number }, color: string, width: number, dash = '') =>
		`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${color}" stroke-width="${width}"${dash === '' ? '' : ` stroke-dasharray="${dash}"`}/>`;
	const mid = (r: { x: number; y: number; width: number; height: number }): [number, number] => [
		r.x + r.width / 2,
		r.y + r.height / 2
	];
	const parts: string[] = [];
	if (spec.mockup !== null) parts.push(box(spec.mockup.rect, '#3b82f6', 4, '16 8'));
	for (const c of spec.callouts) {
		if (c.target !== null) parts.push(box(c.target.specRect, '#22c55e', 5));
		if (c.markerRect !== null) {
			parts.push(box(c.markerRect, '#ef4444', 4));
			if (c.target !== null) {
				const [x1, y1] = mid(c.markerRect);
				const [x2, y2] = mid(c.target.specRect);
				parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ef4444" stroke-width="3"/>`);
			}
		}
		if (c.descriptionMarkerRect !== null) parts.push(box(c.descriptionMarkerRect, '#a855f7', 4));
	}
	const bg =
		image === null
			? `<rect width="${f.width}" height="${f.height}" fill="#f4f4f4"/>`
			: `<image href="data:image/png;base64,${image}" width="${f.width}" height="${f.height}"/>`;
	return `<svg viewBox="0 0 ${f.width} ${f.height}" style="width:100%;max-width:960px;border:1px solid #ccc">${bg}${parts.join('')}</svg>`;
}

function renderSpec(a: FrameAnalysis, spec: SpecScreen, image: string | null): string {
	const keyNames: Record<string, string> = { up: '▲', down: '▼', left: '◀', right: '▶', ok: 'OK', back: 'Back' };
	const rows = spec.callouts
		.map((c) => {
			const t = c.target;
			const keys = Object.entries(c.description?.keys ?? {})
				.map(([k, v]) => `${keyNames[k] ?? k} ${esc(v)}`)
				.join('<br>');
			return `<tr><td>${esc(c.no)}</td><td>${esc(c.label ?? '(설명 없음)')}</td>
<td>${t === null ? '-' : `${t.method} (${t.confidence})<br>${esc(t.text?.split('\n')[0] ?? t.name)}`}</td>
<td>${t === null ? '-' : `${t.screenRect.x}, ${t.screenRect.y}, ${t.screenRect.width}×${t.screenRect.height}`}</td><td>${keys}</td></tr>`;
		})
		.join('');
	return `${specOverlay(a, spec, image)}
<p class="legend"><span style="color:#3b82f6">■ 목업</span> <span style="color:#ef4444">■ 목업 마커 → 대상</span> <span style="color:#22c55e">■ 대상</span> <span style="color:#a855f7">■ 설명 마커</span></p>
<h3>화면 ${esc(spec.screenId ?? '?')} ${esc(spec.title ?? '')}${spec.modified ? ' <small>(M)</small>' : ''}</h3>
<p>상위: ${spec.parents.map((p) => `${esc(p.screenId)} ${esc(p.title)}`).join(', ') || '-'} · 쪽 ${esc(spec.pageNumber ?? '-')} · 목업 배율 ×${spec.mockup?.scale ?? '-'}</p>
<p>진입 조건: ${spec.entryConditions.map(esc).join(' / ') || '-'}${spec.defaultFocus === null ? '' : ` · <b>Default Focus</b>: ${esc(spec.defaultFocus)}`}</p>
<table><tr><th>번호</th><th>이름</th><th>대상 (방법·신뢰도)</th><th>화면 좌표</th><th>키 동작</th></tr>${rows}</table>
<p>버전: ${spec.versions.map((v) => `v${esc(v.version)} ${esc(v.changes.join(' '))}`).join(' / ') || '-'}</p>
<p>추가 설명: ${spec.notes.map(esc).join(' / ') || '-'} · 음성 안내 ${spec.audioGuidance.length}줄 (보류) · 경계 밖 메모 ${spec.offFrameNotes.length}</p>
${spec.diagnostics.length > 0 ? `<ul>${spec.diagnostics.map((d) => `<li class="bad">${esc(d)}</li>`).join('')}</ul>` : ''}`;
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
${s.spec === null ? '' : renderSpec(a, s.spec, image)}
${a.kind !== 'gui' ? '' : `<p class="legend"><span style="color:#ef4444">■ 포커스 추정</span> <span style="color:#f97316">■ 다른 후보</span> <span>점선 = 반복 묶음(색별)</span></p>`}
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

/** 모든 파일의 프레임 (같은 id는 나중 파일 것) — 연결 리포트용 */
const allFrames = new Map<string, FrameSource>();

async function run(name: string, data: FigmaExport): Promise<void> {
	const out = join(resolve(values.out), name);
	await mkdir(out, { recursive: true });
	const analyses = analyzeExport(data);
	analyses.forEach((a, i) => allFrames.set(a.frame.id, { analysis: a, image: data.frames[i]?.image?.data ?? null }));
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
		const spec = a.kind === 'spec' ? extractSpecScreen(a.frame) : null;
		const specText =
			spec === null
				? ''
				: ` 화면 ${spec.screenId ?? '?'} 콜아웃 ${spec.callouts.length} (대상 ${spec.callouts.filter((c) => c.target !== null).length}, 설명 ${spec.callouts.filter((c) => c.description !== null).length}) 진단 ${spec.diagnostics.length}`;
		console.log(
			`  ${a.kind.padEnd(7)} ${a.frame.name} — 요소 ${a.counts.total}, 묶음 ${a.groups.length}, 앵커 ${a.anchors.length}${focus}${specText}`
		);
	}
	console.log(`  → ${join(out, 'report.html')}`);
}

if (values.sample) {
	const data = sampleExport([
		sampleHomeFrame(),
		sampleSpecPage(),
		sampleGuiFrame('keyboard'),
		sampleGuiFrame('closed')
	]);
	await mkdir(resolve(values.out), { recursive: true });
	await writeFile(join(resolve(values.out), 'sample-export.json'), JSON.stringify(data));
	await run('sample', data);
}
for (const file of positionals) {
	const path = fromCwd(file);
	const data = parseExport(JSON.parse(await readFile(path, 'utf8')));
	await run(basename(path, extname(path)).replace(/[^\w.-]+/g, '_'), data);
}

const frames = [...allFrames.values()];
if (frames.some((f) => f.analysis.kind === 'spec') && frames.some((f) => f.analysis.kind === 'gui')) {
	const truth =
		values.truth === undefined ? null : (JSON.parse(await readFile(fromCwd(values.truth), 'utf8')) as Truth);
	const results = linkAll(frames);
	const measured = truth === null ? null : measure(results, truth);
	const out = join(resolve(values.out), 'link');
	await mkdir(out, { recursive: true });
	await writeFile(join(out, 'report.html'), renderLinks(results, frames, truth, measured));
	await writeFile(
		join(out, 'link.json'),
		`${JSON.stringify(
			results.map((r) => ({
				screen: r.merged.screenId,
				title: r.merged.title,
				diagnostics: r.merged.diagnostics,
				parts: r.parts.map((p) => ({ title: p.spec.title, pair: p.link.pair, candidates: p.link.candidates })),
				callouts: r.callouts
			})),
			null,
			'\t'
		)}\n`
	);
	console.log('\n화면설계서 ↔ GUI 연결');
	for (const r of results) {
		const pairs = [
			...new Set(
				r.parts.map((p) => `${p.link.pair?.guiFrameName ?? '짝 없음'}${p.link.ambiguous ? ' (확인 필요)' : ''}`)
			)
		].join(', ');
		const found = r.callouts.filter((c) => c.link?.element != null).length;
		console.log(
			`  ${r.merged.screenId ?? '?'} ${r.merged.title ?? ''} (${r.parts.length}장) → ${pairs} · 콜아웃 ${found}/${r.callouts.length} 대응`
		);
	}
	if (measured !== null) {
		console.log(
			`  정확도: 화면 짝 ${measured.pairs.correct}/${measured.pairs.total}, 콜아웃 → GUI 요소 ${measured.callouts.correct}/${measured.callouts.total}`
		);
		for (const w of [...measured.pairs.wrong, ...measured.callouts.wrong]) console.log(`    틀림 ${w}`);
		if (measured.callouts.unjudged.length > 0)
			console.log(`    정답 없음: ${measured.callouts.unjudged.join(', ')}`);
	}
	console.log(`  → ${join(out, 'report.html')}`);
}
