/**
 * 콜아웃 ↔ 앱 요소 자동 연결 채점 (D-043 ③). `tc.ts --link`가 프로필 화면마다 들어가 화면 요소를 읽고
 * (@auto-qa/planner linkScreenToApp) 자동으로 고른 요소를 사람이 적은 프로필 대응(정답)과 비교한다.
 * 진입 경로는 아직 프로필의 것을 쓴다 (④에서 자동으로). 여기 함수는 순수 함수다
 */
import { isAncestorNode } from '@auto-qa/focus';
import type { DomSnapshot, SnapshotProbe } from '@auto-qa/focus';
import { DEFAULT_APP_LINK_OPTIONS, sameCandidateBox, unionRect } from '@auto-qa/planner';
import type { AppCalloutLink, AppLinkCandidate, AppLinkOptions, AppScreenLink } from '@auto-qa/planner';
import { calloutMark } from './profile';
import type { ElementRegistry } from './profile';

export const LINK_REPORT_FORMAT = 'auto-qa/link-report';

const TRUTH = 'truth:';
const AUTO = 'auto:';

/** 정답 선택자: 그 화면 콜아웃에 대응된 프로필 요소 (화면 콜아웃 + 공통 요소의 callout) */
export function truthProbes(registry: ElementRegistry, screen: string): SnapshotProbe[] {
	const out: SnapshotProbe[] = [];
	for (const [name, e] of Object.entries(registry.elements)) {
		if (name.startsWith('@') || e.callout === undefined || !e.callout.startsWith(`${screen}#`)) continue;
		const no = e.callout.slice(screen.length + 1);
		out.push({
			name: `${TRUTH}${no}`,
			selector: e.selector,
			...(e.textIncludes === undefined ? {} : { textIncludes: e.textIncludes })
		});
	}
	return out;
}

/** 고른 선택자 검증용 probe (다시 읽은 화면에서 하나만, 같은 자리에 맞는가) */
export function autoProbes(link: AppScreenLink): SnapshotProbe[] {
	return link.callouts.flatMap((c) =>
		c.selector === null ? [] : [{ name: `${AUTO}${c.no}`, selector: c.selector.selector }]
	);
}

export type LinkGrade =
	/** 정답과 같은 상자 */
	| 'match'
	/** 정답을 감싸거나 정답 안에 있음 (겹침이 기준 미만) */
	| 'related'
	| 'wrong'
	/** 자동으로 고르지 못함 */
	| 'none'
	/** 정답 없음 (프로필에 대응이 없거나 정답 요소가 화면에 안 보임) — 채점에서 뺀다 */
	| 'no-truth';

export interface LinkRow {
	screen: string;
	no: string;
	name: string | null;
	grade: LinkGrade;
	auto: {
		selector: string | null;
		items: string | null;
		unique: boolean;
		stable: boolean;
		verified: boolean | null;
		score: number;
	} | null;
	ambiguous: boolean;
	/** 정답 선택자 (프로필) */
	truth: string | null;
	/** 정답이 다음 후보 안에 있었는가 (AI가 후보 중에서 고르면 맞출 수 있는가) */
	truthInAlternatives: boolean;
	reason: string;
}

const nodesWith = (snapshot: DomSnapshot, probe: string): number[] =>
	snapshot.nodes.filter((n) => n.probes.includes(probe)).map((n) => n.i);

/** 다시 읽은 화면에서 고른 선택자가 고른 요소 수만큼, 같은 자리(첫 요소의 태그·위치)에 맞는가 */
function verified(first: DomSnapshot, again: DomSnapshot | null, c: AppCalloutLink): boolean | null {
	if (again === null || c.selector === null) return null;
	const hits = nodesWith(again, `${AUTO}${c.no}`);
	const want = first.nodes[c.selector.node];
	const got = again.nodes[hits[0] ?? -1];
	if (want === undefined || got === undefined || hits.length !== c.selector.count) return false;
	const r = want.rect;
	const g = got.rect;
	return got.tag === want.tag && r.x === g.x && r.y === g.y && r.width === g.width && r.height === g.height;
}

/**
 * 화면 하나 채점. snapshot = 정답 probe를 붙여 읽은 화면, again = 고른 선택자 probe로 다시 읽은 화면 (없으면 검증 안 함).
 * 정답 선택자가 여러 요소(목록 항목)에 맞으면 그 요소들을 감싸는 사각형과 비교한다
 */
export function gradeScreen(
	screen: string,
	link: AppScreenLink,
	snapshot: DomSnapshot,
	again: DomSnapshot | null,
	probes: readonly SnapshotProbe[],
	options: AppLinkOptions = DEFAULT_APP_LINK_OPTIONS
): LinkRow[] {
	return link.callouts.map((c) => {
		const probe = probes.find((p) => p.name === `${TRUTH}${c.no}`);
		const truth = nodesWith(snapshot, `${TRUTH}${c.no}`);
		const rects = truth.map((t) => snapshot.nodes[t]?.rect).filter((r) => r !== undefined);
		const truthBox = {
			nodes: truth,
			rect: rects.length === 0 ? { x: 0, y: 0, width: 0, height: 0 } : unionRect(rects)
		};
		const auto =
			c.best === null
				? null
				: {
						selector: c.selector?.selector ?? null,
						items: c.selector?.items ?? null,
						unique: c.selector?.unique ?? false,
						stable: c.selector?.stable ?? false,
						verified: verified(snapshot, again, c),
						score: c.best.score
					};
		const fits = (x: { nodes: number[]; rect: AppLinkCandidate['rect'] }): boolean =>
			sameCandidateBox(snapshot, x, truthBox, options.sameBoxIou);
		const base = {
			screen,
			no: c.no,
			name: c.name,
			auto,
			ambiguous: c.ambiguous,
			truth: probe?.selector ?? null,
			truthInAlternatives: truth.length > 0 && c.alternatives.some(fits),
			reason: c.reason
		};
		if (truth.length === 0) return { ...base, grade: 'no-truth' };
		if (c.best === null) return { ...base, grade: 'none' };
		if (c.sameBox.some(fits)) return { ...base, grade: 'match' };
		const near = (a: number, t: number): boolean =>
			a === t || isAncestorNode(snapshot, a, t) || isAncestorNode(snapshot, t, a);
		if (c.best.nodes.some((a) => truth.some((t) => near(a, t)))) return { ...base, grade: 'related' };
		return { ...base, grade: 'wrong' };
	});
}

export interface LinkSummary {
	graded: number;
	match: number;
	related: number;
	wrong: number;
	none: number;
	noTruth: number;
	ambiguous: number;
	/** 틀렸거나 못 고른 것 중 정답이 다음 후보에 있던 수 */
	recoverable: number;
	selectorsVerified: number;
}

export function summarize(rows: readonly LinkRow[]): LinkSummary {
	const count = (g: LinkGrade): number => rows.filter((r) => r.grade === g).length;
	return {
		graded: rows.filter((r) => r.grade !== 'no-truth').length,
		match: count('match'),
		related: count('related'),
		wrong: count('wrong'),
		none: count('none'),
		noTruth: count('no-truth'),
		ambiguous: rows.filter((r) => r.ambiguous).length,
		recoverable: rows.filter((r) => (r.grade === 'wrong' || r.grade === 'none') && r.truthInAlternatives).length,
		selectorsVerified: rows.filter((r) => r.auto?.verified === true).length
	};
}

const GRADE_LABEL: Record<LinkGrade, string> = {
	match: '일치',
	related: '감쌈·포함',
	wrong: '다름',
	none: '못 고름',
	'no-truth': '정답 없음'
};

const pct = (n: number, d: number): string => (d === 0 ? '-' : `${n}/${d} (${Math.round((n / d) * 100)}%)`);
const cell = (t: string): string => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function linkReportText(rows: readonly LinkRow[], errors: readonly string[]): string[] {
	const s = summarize(rows);
	const lines = [
		'# 콜아웃 ↔ 앱 요소 자동 연결 채점',
		'',
		`- 일치 ${pct(s.match, s.graded)} · 감쌈·포함 ${s.related} · 다름 ${s.wrong} · 못 고름 ${s.none} (정답 없음 ${s.noTruth}개는 뺌)`,
		`- 애매함 표시 ${s.ambiguous}개 · 틀린 것 중 정답이 다음 후보에 있던 것 ${s.recoverable}개 (AI가 후보 중에서 고르면 맞출 수 있는 것)`,
		`- 고른 선택자를 다시 읽은 화면에서 확인: ${s.selectorsVerified}개가 하나만·같은 자리에 맞음`,
		'',
		'| 화면 | 콜아웃 | 결과 | 자동 선택자 (점수) | 정답 선택자 | 근거 |',
		'|---|---|---|---|---|---|'
	];
	for (const r of rows) {
		const auto =
			r.auto === null
				? '-'
				: `\`${r.auto.selector ?? '?'}\`${r.auto.items === null ? '' : ` 항목 \`${r.auto.items}\``} (${r.auto.score}${r.auto.unique ? '' : ', 하나로 못 좁힘'}${r.auto.stable ? '' : ', 바뀌는 이름'}${r.auto.verified === false ? ', 검증 실패' : ''})`;
		lines.push(
			`| ${r.screen} | ${calloutMark(r.no)} ${cell(r.name ?? '')} | ${GRADE_LABEL[r.grade]}${r.ambiguous ? ' · 애매함' : ''} | ${cell(auto)} | ${r.truth === null ? '-' : `\`${cell(r.truth)}\``} | ${cell(r.reason)} |`
		);
	}
	if (errors.length > 0) lines.push('', '## 들어가지 못한 화면', '', ...errors.map((e) => `- ${e}`));
	return lines;
}

export interface DraftCallout {
	selector: string;
	items?: string;
	name?: string;
}

/** 자동 연결 결과로 만든 프로필 콜아웃 초안 (사람이 승인하는 값, D-024). 하나로 좁힌 선택자만 */
export function draftCallouts(links: readonly AppScreenLink[]): Record<string, Record<string, DraftCallout>> {
	const out: Record<string, Record<string, DraftCallout>> = {};
	for (const l of links) {
		const screen = l.screenId ?? '';
		for (const c of l.callouts) {
			if (c.selector === null || !c.selector.unique) continue;
			(out[screen] ??= {})[c.no] = {
				selector: c.selector.selector,
				...(c.selector.items === undefined ? {} : { items: c.selector.items }),
				...(c.name === null ? {} : { name: c.name })
			};
		}
	}
	return out;
}
