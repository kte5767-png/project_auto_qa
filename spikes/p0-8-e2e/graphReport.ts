/**
 * 화면 이동 지도 채점 (D-043 ④ 진입 경로 자동 계산의 첫 단계). 화면설계서에서 읽은 이동 지도(@auto-qa/planner
 * buildScreenGraph)를 사람이 적은 프로필의 진입 경로(from·entry)와 비교한다. 여기 함수는 순수 함수다
 */
import type { EdgeAction, ScreenEdge, ScreenGraph, ScreenReference, UnresolvedMove } from '@auto-qa/planner';
import { parseCalloutRef } from './scenario';
import type { AppProfile, ElementRegistry } from './profile';

export const GRAPH_REPORT_FORMAT = 'auto-qa/graph-report';

/** 프로필 진입 경로가 말하는 이동: 앞 화면(from)의 어느 콜아웃에서 무엇을 해서 이 화면에 오는가 */
export interface ProfileMove {
	screen: string;
	/** 앞 화면. 없으면 앱 첫 화면에서 바로 오는 길 (화면설계서 밖) */
	from: string | null;
	/** 마지막 OK·확인 전에 포커스를 맞춘 콜아웃 (프로필 요소가 콜아웃에 대응돼 있을 때만) */
	via: { screen: string; no: string } | null;
	/** via를 알아낸 요소 이름 (콜아웃에 대응 안 된 공통 요소면 이름만) */
	element: string | null;
	action: EdgeAction | null;
	/** 넣은 글자 (`@no-result` 등) */
	typed: string | null;
	/** 진입 경로가 BACK으로 끝남 (검색 뒤 돌아와 상태를 바꾼 화면 등) */
	back: boolean;
}

export function profileMoves(profile: AppProfile, registry: ElementRegistry): ProfileMove[] {
	return Object.entries(profile.screens).map(([screen, def]): ProfileMove => {
		let until: string | null = null;
		let via: ProfileMove['via'] = null;
		let element: string | null = null;
		let action: EdgeAction | null = null;
		let typed: string | null = null;
		let back = false;
		for (const step of def.entry) {
			if ('press' in step) {
				back = step.press === 'BACK';
				if (step.until !== undefined) until = registry.resolve(screen, step.until);
				if (step.press === 'OK' && until !== null) {
					action = 'select';
					element = until;
					const e = registry.elements[until];
					via = e?.callout === undefined ? null : parseCalloutRef(e.callout);
				}
			} else if ('type' in step) {
				typed = step.type;
				back = false;
				if (step.submit === true) {
					action = 'submit';
					// 글자를 넣은 곳은 그 직전에 포커스를 맞춘 요소 (없으면 이미 포커스된 입력란)
					element = until;
					const e = until === null ? undefined : registry.elements[until];
					via = e?.callout === undefined ? null : parseCalloutRef(e.callout);
				}
			}
		}
		return { screen, from: def.from ?? null, via, element, action, typed, back };
	});
}

export type GraphGrade =
	/** 이동 지도에 같은 앞 화면·같은 콜아웃의 이동이 있음 */
	| 'match'
	/** 같은 앞 화면에서 오는 이동은 있으나 프로필이 콜아웃을 정하지 않음 (공통 요소 등) */
	| 'screen-match'
	/** 같은 앞 화면에서 오지만 다른 콜아웃 */
	| 'other-callout'
	/** 이동은 없고, 앞 화면이 이 화면을 참고로 가리킴 (상태가 다른 같은 화면) */
	| 'reference'
	/** 이동 지도에 앞 화면 → 이 화면이 없음 */
	| 'missing'
	/** 앱 첫 화면에서 바로 오는 길 (화면설계서에 없는 화면에서 옴) */
	| 'root';

export interface GraphRow {
	screen: string;
	move: ProfileMove;
	grade: GraphGrade;
	/** 이동 지도의 앞 화면 → 이 화면 이동 */
	edges: ScreenEdge[];
	/** 다른 화면에서 이 화면으로 오는 이동 */
	elsewhere: ScreenEdge[];
	reference: ScreenReference | null;
	/** 앞 화면에서 정하지 못한 이동 (missing일 때 원인 후보) */
	unresolved: UnresolvedMove[];
	/** 동작(OK·글자 확인)이 프로필과 다름 */
	actionDiffers: boolean;
	note: string;
}

export function gradeGraph(graph: ScreenGraph, moves: readonly ProfileMove[]): GraphRow[] {
	return moves.map((move): GraphRow => {
		const into = graph.edges.filter((e) => e.to === move.screen);
		const edges = move.from === null ? [] : into.filter((e) => e.from === move.from);
		const elsewhere = into.filter((e) => !edges.includes(e));
		const reference =
			move.from === null
				? null
				: (graph.references.find((r) => r.from === move.from && r.to === move.screen) ?? null);
		const unresolved = move.from === null ? [] : graph.unresolved.filter((u) => u.from === move.from);
		const base = { screen: move.screen, move, edges, elsewhere, reference, unresolved };
		if (move.from === null) {
			return { ...base, grade: 'root', actionDiffers: false, note: '앱 첫 화면에서 오는 길 (화면설계서 밖)' };
		}
		if (edges.length === 0) {
			if (reference !== null) {
				return {
					...base,
					grade: 'reference',
					actionDiffers: false,
					note: `${move.from} ${mark(reference.callout)}이 참고로 가리킴${reference.condition === null ? '' : ' (진입 조건 있음)'}`
				};
			}
			return {
				...base,
				grade: 'missing',
				actionDiffers: false,
				note: `${move.from} → ${move.screen} 이동 없음${unresolved.length > 0 ? ` (정하지 못한 이동 ${unresolved.length}개)` : ''}`
			};
		}
		const via = move.via;
		const same = via === null ? [] : edges.filter((e) => via.screen === e.from && via.no === e.callout);
		const pick = same[0] ?? edges[0];
		const actionDiffers = move.action !== null && pick !== undefined && pick.action !== move.action;
		if (via === null) {
			return {
				...base,
				grade: 'screen-match',
				actionDiffers,
				note: `이동 ${edges.map((e) => `${e.from}${mark(e.callout)}`).join(', ')} (프로필은 콜아웃에 대응 안 된 요소)`
			};
		}
		if (same.length === 0) {
			return {
				...base,
				grade: 'other-callout',
				actionDiffers,
				note: `이동은 ${edges.map((e) => `${e.from}${mark(e.callout)}`).join(', ')}, 프로필은 ${via.screen}${mark(via.no)}`
			};
		}
		return { ...base, grade: 'match', actionDiffers, note: `${via.screen}${mark(via.no)} (${pick?.how ?? ''})` };
	});
}

const mark = (no: string): string => `#${no}`;

const GRADE_TEXT: Record<GraphGrade, string> = {
	match: '일치',
	'screen-match': '화면 일치',
	'other-callout': '다른 콜아웃',
	reference: '참고(상태 변형)',
	missing: '없음',
	root: '첫 화면에서'
};

export interface GraphSummary {
	screens: number;
	/** 화면설계서 안에서 오는 화면 (root 제외) */
	graded: number;
	/** match + screen-match + reference */
	found: number;
	match: number;
	missing: number;
	edges: number;
	unresolved: number;
	references: number;
}

export function summarizeGraph(graph: ScreenGraph, rows: readonly GraphRow[]): GraphSummary {
	const count = (g: GraphGrade): number => rows.filter((r) => r.grade === g).length;
	return {
		screens: rows.length,
		graded: rows.length - count('root'),
		found: count('match') + count('screen-match') + count('reference'),
		match: count('match'),
		missing: count('missing'),
		edges: graph.edges.length,
		unresolved: graph.unresolved.length,
		references: graph.references.length
	};
}

/** 리포트 문장. withText=false면 화면설계서 문장을 빼고 번호·판정만 (밖으로 옮길 요약용) */
export function graphReportText(graph: ScreenGraph, rows: readonly GraphRow[], withText = true): string[] {
	const s = summarizeGraph(graph, rows);
	const pct = s.graded === 0 ? 0 : Math.round((s.found / s.graded) * 100);
	const quote = (t: string): string => (withText ? ` "${t}"` : '');
	const lines = [
		'# 화면 이동 지도 채점 (D-043 ④)',
		'',
		`이동 ${s.edges}개, 정하지 못한 이동 ${s.unresolved}개, 참고 ${s.references}개`,
		`프로필 진입 경로 대비: 찾음 ${s.found}/${s.graded} (${pct}%), 콜아웃까지 일치 ${s.match}, 없음 ${s.missing} (첫 화면에서 오는 화면 ${s.screens - s.graded}개 제외)`,
		'',
		'## 화면별',
		''
	];
	for (const r of rows) {
		const m = r.move;
		const how =
			m.action === null
				? ''
				: ` [${m.action === 'submit' ? `글자 확인${m.typed === null ? '' : ` ${m.typed}`}` : 'OK'}${m.back ? ', BACK' : ''}]`;
		lines.push(
			`- ${r.screen} ← ${m.from ?? '(첫 화면)'}${how}: ${GRADE_TEXT[r.grade]}${r.actionDiffers ? ' (동작 다름)' : ''}. ${r.note}`
		);
		for (const e of r.elsewhere)
			lines.push(`  - 다른 곳에서 오는 이동: ${e.from}${mark(e.callout)} (${e.how})${quote(e.text)}`);
		if (r.grade === 'missing')
			for (const u of r.unresolved)
				lines.push(
					`  - 정하지 못함 ${u.from}${mark(u.callout)}: ${withText ? u.reason : reasonKind(u.reason)}${quote(u.text)}`
				);
		if (r.reference !== null && withText && r.reference.condition !== null)
			lines.push(`  - 진입 조건: "${r.reference.condition}"`);
	}
	lines.push('', '## 이동 지도', '');
	for (const e of graph.edges) {
		lines.push(
			`- ${e.from}${mark(e.callout)} → ${e.to} (${e.action}, ${e.how}${e.condition === null ? '' : ', 조건 있음'})${quote(e.text)}`
		);
	}
	for (const r of graph.references) lines.push(`- ${r.from}${mark(r.callout)} ⇢ ${r.to} (참고)${quote(r.text)}`);
	for (const u of graph.unresolved)
		lines.push(`- ${u.from}${mark(u.callout)} → ? (${withText ? u.reason : reasonKind(u.reason)})${quote(u.text)}`);
	return lines;
}

/** 정하지 못한 이유의 종류 (이름을 뺀 것) */
function reasonKind(reason: string): string {
	if (reason.includes('하나로 정할 수 없음')) return '화면 하나로 정할 수 없음';
	if (reason.includes('맞는 화면이 없음')) return '이름이 맞는 화면 없음';
	return reason;
}
