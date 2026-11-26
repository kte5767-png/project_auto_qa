import type { FrameAnalysis, NormalizedFrame } from '@auto-qa/figma';

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
import { extractSpecScreen, linkSpecToGui, mergeSpecScreens } from '@auto-qa/spec';
import type { CalloutLink, MergedSpecScreen, SpecGuiLink, SpecScreen } from '@auto-qa/spec';

/**
 * 화면설계서 ↔ GUI 연결 리포트 (P0-5 3단계). 여러 내보내기 파일의 프레임을 모아서 본다.
 * 정답 파일(--truth, 커밋하지 않음)이 있으면 화면 짝·콜아웃 대응 정확도를 잰다.
 *
 * 정답 파일 형식:
 * { "pairs": { "<화면 ID>": "<GUI 프레임 이름>" | null },
 *   "callouts": { "<화면 ID>#<번호>": ["<GUI 요소 id>", …] | null },   // 목록 중 하나면 정답, null은 "GUI에 없음"이 정답
 *   "focus": { "<GUI 프레임 이름>": ["<포커스 요소 id>", …] } }        // 선택: GUI 포커스 추정 정답
 */

export interface FrameSource {
	analysis: FrameAnalysis;
	image: string | null;
}

export interface Truth {
	pairs: Record<string, string | null>;
	callouts: Record<string, string[] | null>;
	focus?: Record<string, string[]>;
}

/** GUI 포커스 추정 정답 대비 (확인 필요 표시도 센다) */
export function measureFocus(
	frames: readonly FrameSource[],
	truth: Truth
): { correct: number; total: number; flagged: number; wrong: string[] } {
	const out = { correct: 0, total: 0, flagged: 0, wrong: [] as string[] };
	for (const f of frames) {
		const accepted = truth.focus?.[f.analysis.frame.name];
		if (f.analysis.kind !== 'gui' || accepted === undefined) continue;
		const p = f.analysis.focus.primary;
		out.total++;
		if (f.analysis.focus.ambiguous) out.flagged++;
		if (p !== null && accepted.includes(p.memberId)) out.correct++;
		else out.wrong.push(`${f.analysis.frame.name}: 결과 ${p === null ? '없음' : `${p.memberId} (${p.source})`}`);
	}
	return out;
}

interface PartLink {
	spec: SpecScreen;
	link: SpecGuiLink;
}

export interface ScreenResult {
	merged: MergedSpecScreen;
	parts: PartLink[];
	/** 번호별 대표 결과 (설명이 있는 장의 결과) */
	callouts: { no: string; label: string | null; ownerFrameId: string; link: CalloutLink | null }[];
}

export interface Measure {
	pairs: { correct: number; total: number; wrong: string[] };
	callouts: { correct: number; total: number; wrong: string[]; unjudged: string[] };
}

const esc = (text: string | null | undefined): string =>
	(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export function linkAll(frames: readonly FrameSource[]): ScreenResult[] {
	const guis = frames.filter((f) => f.analysis.kind === 'gui').map((f) => f.analysis.frame);
	const specFrames = new Map<string, NormalizedFrame>();
	const screens: SpecScreen[] = [];
	for (const f of frames.filter((x) => x.analysis.kind === 'spec')) {
		specFrames.set(f.analysis.frame.id, f.analysis.frame);
		screens.push(extractSpecScreen(f.analysis.frame));
	}
	return mergeSpecScreens(screens).map((merged) => {
		const parts = merged.parts.flatMap((spec) => {
			const frame = specFrames.get(spec.frameId);
			return frame === undefined ? [] : [{ spec, link: linkSpecToGui(spec, frame, guis) }];
		});
		const callouts = merged.callouts.map((c) => {
			const owner = parts.find((p) => p.spec.frameId === c.ownerFrameId);
			return {
				no: c.no,
				label: c.label,
				ownerFrameId: c.ownerFrameId,
				link: owner?.link.callouts.find((l) => l.no === c.no) ?? null
			};
		});
		return { merged, parts, callouts };
	});
}

const keyOf = (r: ScreenResult): string => r.merged.screenId ?? r.merged.title ?? '?';

export function measure(results: readonly ScreenResult[], truth: Truth): Measure {
	const m: Measure = {
		pairs: { correct: 0, total: 0, wrong: [] },
		callouts: { correct: 0, total: 0, wrong: [], unjudged: [] }
	};
	for (const r of results) {
		const key = keyOf(r);
		if (!(key in truth.pairs)) continue;
		const expected = truth.pairs[key] ?? null;
		// 장마다 짝을 찾으므로 모든 장이 맞아야 정답
		const got = [...new Set(r.parts.map((p) => p.link.pair?.guiFrameName ?? null))];
		m.pairs.total++;
		if (got.length === 1 && got[0] === expected) m.pairs.correct++;
		else m.pairs.wrong.push(`${key}: 정답 ${expected ?? '없음'} / 결과 ${got.map((g) => g ?? '없음').join(', ')}`);
		if (expected === null) continue;
		for (const c of r.callouts) {
			const id = `${key}#${c.no}`;
			if (!(id in truth.callouts)) {
				m.callouts.unjudged.push(id);
				continue;
			}
			const accepted = truth.callouts[id] ?? null;
			const element = c.link?.element ?? null;
			const ok = accepted === null ? element === null : element !== null && accepted.includes(element.id);
			m.callouts.total++;
			if (ok) m.callouts.correct++;
			else
				m.callouts.wrong.push(
					`${id} ${c.label ?? ''}: 결과 ${element === null ? '없음' : `${element.name} (${element.id})`}`
				);
		}
	}
	return m;
}

const box = (r: Rect, color: string, width: number, label = '', dash = ''): string =>
	`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${color}" stroke-width="${width}"${dash === '' ? '' : ` stroke-dasharray="${dash}"`}/>` +
	(label === ''
		? ''
		: `<rect x="${r.x}" y="${r.y - 44}" width="${22 + label.length * 22}" height="44" fill="${color}"/><text x="${r.x + 10}" y="${r.y - 10}" font-size="34" font-family="sans-serif" fill="#fff" font-weight="bold">${esc(label)}</text>`);

function image(width: number, height: number, data: string | null, view: Rect, content: string): string {
	const bg =
		data === null
			? `<rect width="${width}" height="${height}" fill="#333"/>`
			: `<image href="data:image/png;base64,${data}" width="${width}" height="${height}"/>`;
	return `<svg viewBox="${view.x} ${view.y - 50} ${view.width} ${view.height + 50}" style="width:49%;border:1px solid #ccc;vertical-align:top">${bg}${content}</svg>`;
}

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#f97316'];

export function renderLinks(
	results: readonly ScreenResult[],
	frames: readonly FrameSource[],
	truth: Truth | null,
	measured: Measure | null
): string {
	const byId = new Map(frames.map((f) => [f.analysis.frame.id, f]));
	const verdict = (key: string, c: ScreenResult['callouts'][number]): string => {
		if (truth === null) return '';
		const id = `${key}#${c.no}`;
		if (!(id in truth.callouts)) return '<td>-</td>';
		const accepted = truth.callouts[id] ?? null;
		const element = c.link?.element ?? null;
		const ok = accepted === null ? element === null : element !== null && accepted.includes(element.id);
		return `<td class="${ok ? 'ok' : 'bad'}">${ok ? '맞음' : '틀림'}</td>`;
	};
	const sections = results.map((r) => {
		const key = keyOf(r);
		const parts = r.parts
			.map(({ spec, link }) => {
				const specSource = byId.get(spec.frameId);
				const gui = link.pair === null ? undefined : byId.get(link.pair.guiFrameId);
				const specView = spec.mockup?.rect ?? {
					x: 0,
					y: 0,
					width: specSource?.analysis.frame.width ?? 100,
					height: specSource?.analysis.frame.height ?? 100
				};
				const specBoxes = spec.callouts
					.map((c, i) =>
						c.target === null ? '' : box(c.target.specRect, COLORS[i % COLORS.length] ?? '#999', 4, c.no)
					)
					.join('');
				const guiBoxes = link.callouts
					.map((c, i) =>
						c.element === null ? '' : box(c.element.rect, COLORS[i % COLORS.length] ?? '#999', 6, c.no)
					)
					.join('');
				const guiFrame = gui?.analysis.frame;
				const candidates = link.candidates
					.map(
						(c) =>
							`${esc(c.guiFrameName)} ${c.score} (글자 ${c.textOverlap}, 이름 ${c.nameSimilarity}, 콜아웃 ${c.calloutFit ?? '-'})`
					)
					.join(' · ');
				return `<h3>${esc(spec.title)} → ${link.pair === null ? '<span class="bad">짝 없음</span>' : esc(link.pair.guiFrameName)}${link.ambiguous ? ' <span class="bad">(확인 필요: 2위와 점수 차 작음)</span>' : ''}</h3>
<p class="small">후보: ${candidates || '-'}</p>
${specSource === undefined ? '' : image(specSource.analysis.frame.width, specSource.analysis.frame.height, specSource.image, specView, specBoxes)}
${guiFrame === undefined || gui === undefined ? '' : image(guiFrame.width, guiFrame.height, gui.image, { x: 0, y: 0, width: guiFrame.width, height: guiFrame.height }, guiBoxes)}`;
			})
			.join('');
		const rows = r.callouts
			.map((c) => {
				const l = c.link;
				const owner = r.parts.find((p) => p.spec.frameId === c.ownerFrameId)?.spec.title ?? '';
				const diffs = (l?.textDiffs ?? [])
					.map((d) => `"${esc(d.spec)}" → ${d.gui === null ? '<b>GUI에 없음</b>' : `"${esc(d.gui)}"`}`)
					.join('<br>');
				return `<tr><td>${esc(c.no)}</td><td>${esc(c.label ?? '(설명 없음)')}</td><td class="small">${esc(owner)}</td>
<td>${l === null ? '-' : l.element === null ? `<span class="bad">${esc(l.reason)}</span>` : `${esc(l.element.name)}<br><span class="small">${esc(l.element.text?.split('\n')[0] ?? '')}</span>`}</td>
<td>${l?.score ?? '-'}<br><span class="small">${l?.element === null ? '' : esc(l?.reason)}</span></td><td>${diffs}</td>${verdict(key, c)}</tr>`;
			})
			.join('');
		return `<section><h2>화면 ${esc(r.merged.screenId ?? '?')} ${esc(r.merged.title)} <small>${r.parts.length}장${r.merged.total === null ? '' : ` / ${r.merged.total}장`}</small></h2>
${r.merged.diagnostics.length > 0 ? `<ul>${r.merged.diagnostics.map((d) => `<li class="small">${esc(d)}</li>`).join('')}</ul>` : ''}
<table><tr><th>번호</th><th>이름</th><th>설명 있는 장</th><th>GUI 요소</th><th>점수</th><th>글자 차이</th>${truth === null ? '' : '<th>정답</th>'}</tr>${rows}</table>
${parts}</section>`;
	});
	const summary =
		measured === null
			? ''
			: `<p><b>화면 짝 ${measured.pairs.correct}/${measured.pairs.total}</b> · <b>콜아웃 → GUI 요소 ${measured.callouts.correct}/${measured.callouts.total}</b>${measured.callouts.unjudged.length > 0 ? ` · 정답 없음 ${measured.callouts.unjudged.length}` : ''}</p>
${[...measured.pairs.wrong, ...measured.callouts.wrong].map((w) => `<p class="bad">${esc(w)}</p>`).join('')}`;
	return `<!doctype html><meta charset="utf-8"><title>P0-5 화면설계서 ↔ GUI 연결</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;max-width:1400px}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}
section{border-top:2px solid #333;margin-top:24px}.bad{color:#c00}.ok{color:#080}.small{font-size:12px;color:#555}small{color:#666;font-weight:normal}</style>
<h1>P0-5 화면설계서 ↔ GUI 연결</h1>
<p>화면설계서 ${results.reduce((n, r) => n + r.parts.length, 0)}장 (화면 ${results.length}개) · GUI 프레임 ${frames.filter((f) => f.analysis.kind === 'gui').length}개. 왼쪽 = 화면설계서 목업의 콜아웃 대상, 오른쪽 = 찾은 GUI 요소 (같은 번호·색)</p>
${summary}
${sections.join('')}`;
}
