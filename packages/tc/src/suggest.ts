import { cellText, columnLetter, columnIndex, lastRow } from './grid';
import type { Grid, GridSheet } from './grid';
import type { ColumnRole, SheetKind, SheetProfile, TcProfile } from './types';

/**
 * TC 프로필 자동 제안 (설계 7.10). 헤더의 단어로 열 역할을 찾고, 값의 모양으로 묶기·절차 형식·참조 규칙을 정한다.
 * 결과는 "제안"이다. 사람이 확인·수정한 프로필만 정규화에 쓴다.
 */

const ROLE_PATTERNS: [ColumnRole, RegExp][] = [
	['id', /^(test ?case ?id|tc ?id|case ?id|id)$/i],
	['title', /^(title|test ?title|제목|타이틀|시나리오 ?명?)$/i],
	['category', /^(category|분류|카테고리)$/i],
	['caseNo', /^(#|번호)$/i],
	['step', /^(step|steps|seq\.?|sequence|단계|순서)$/i],
	['precondition', /^(pre-?condition|사전 ?조건|전제 ?조건)$/i],
	['action', /^(action|test ?procedure|procedure|test ?steps?|절차|수행 ?절차|테스트 ?절차|조작)/i],
	['expected', /^(expected( ?results?)?|기대 ?결과|예상 ?결과)/i],
	['result', /^(p ?\/ ?f|pass ?\/ ?fail|result|결과|판정|테스트 ?결과)$/i],
	[
		'issue',
		/^(issue ?(details?|descriptions?|contents?)|이슈 ?(내용|상세|설명)|결함 ?(내용|설명)|fail(ure)? ?reasons?|실패 ?(사유|원인))$/i
	],
	['note', /^(비고|note|notes|remarks?|comments?)$/i],
	['severity', /^(severity|심각도|중요도|priority|우선 ?순위)$/i]
];

const REFERENCE_PATTERNS: RegExp[] = [
	/seq\.?\s*(\d+)\s*수행/i,
	/step\s*(\d+)\s*(?:수행|진행)/i,
	/(\d+)\s*번\s*(?:단계\s*)?수행/
];
const SPEC_ID_PATTERN = '^scenario_v([\\d.]+)_(.+)$';
const TARGET_REF_PATTERN = '^\\(\\s*(\\d+(?:-\\d+)*|[A-Z])\\s*\\)\\s*(.+)$';
const HEADER_SCAN_ROWS = 15;

function normalizeHeader(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** 한 행을 헤더로 보고 역할을 찾는다 (역할마다 처음 맞는 열) */
export function matchHeaderRow(sheet: GridSheet, row: number): Partial<Record<ColumnRole, number>> {
	const found: Partial<Record<ColumnRole, number>> = {};
	const cells = sheet.rows[row - 1] ?? [];
	cells.forEach((value, i) => {
		if (value === null) return;
		const header = normalizeHeader(value);
		for (const [role, pattern] of ROLE_PATTERNS) {
			if (found[role] === undefined && pattern.test(header)) {
				found[role] = i + 1;
				break;
			}
		}
	});
	return found;
}

function detectKind(sheet: GridSheet, headerRoles: Partial<Record<ColumnRole, number>>, headerRow: number): SheetKind {
	const headerText = (sheet.rows[headerRow - 1] ?? []).filter((v): v is string => v !== null).join(' ');
	if (/context_name|message_id/i.test(headerText)) return 'log-spec';
	if (headerRoles.action !== undefined && headerRoles.expected !== undefined) return 'test-cases';
	if (/점검 ?항목|check ?item|checklist/i.test(headerText)) return 'checklist';
	for (let r = 1; r <= Math.min(40, sheet.rows.length); r++) {
		if ((sheet.rows[r - 1] ?? []).some((v) => v !== null && /^\(?(given|when|then)\)?\b/i.test(v))) {
			return 'given-when-then';
		}
	}
	return 'unknown';
}

function columnValues(sheet: GridSheet, column: number | undefined, fromRow: number, toRow: number): (string | null)[] {
	if (column === undefined) return [];
	const values: (string | null)[] = [];
	for (let r = fromRow; r <= toRow; r++) values.push(cellText(sheet, r, column));
	return values;
}

function ratio(count: number, total: number): number {
	return total === 0 ? 0 : count / total;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function suggestSheetProfile(sheet: GridSheet): SheetProfile {
	// 1) 헤더 행: 역할이 가장 많이 맞는 행 (조작·기대 결과가 있으면 가산)
	let headerRow = 1;
	let roles: Partial<Record<ColumnRole, number>> = {};
	let best = -1;
	for (let r = 1; r <= Math.min(HEADER_SCAN_ROWS, sheet.rows.length); r++) {
		const found = matchHeaderRow(sheet, r);
		const score =
			Object.keys(found).length + (found.action !== undefined ? 2 : 0) + (found.expected !== undefined ? 2 : 0);
		if (score > best) {
			best = score;
			headerRow = r;
			roles = found;
		}
	}
	const kind = detectKind(sheet, roles, headerRow);
	const evidence: string[] = [];
	const base: SheetProfile = {
		sheet: sheet.name,
		kind,
		include: false,
		headerRow,
		columns: {},
		groupStart: [],
		stepFormat: 'row-per-step',
		referencePattern: null,
		specIdPattern: null,
		targetRefPattern: null,
		evidence,
		confidence: 0
	};
	if (sheet.state !== 'visible') {
		evidence.push(`숨김 시트라 제외 (${sheet.state})`);
		return { ...base, kind };
	}
	if (kind !== 'test-cases') {
		evidence.push(
			{
				'log-spec': '로그 사양 시트(context_name·message_id)라 TC 정규화에서 제외',
				checklist: '체크리스트 시트(점검항목)라 TC 정규화에서 제외 (공통 점검 자동화는 Phase 3)',
				'given-when-then': 'Given/When/Then 형식 시트라 제외 (화면설계서 보완용 후보)',
				unknown: '헤더에서 조작·기대 결과 열을 찾지 못해 제외',
				'test-cases': ''
			}[kind]
		);
		return base;
	}

	const end = lastRow(sheet);
	const first = headerRow + 1;
	const actionValues = columnValues(sheet, roles.action, first, end);
	const expectedValues = columnValues(sheet, roles.expected, first, end);
	const contentRows = actionValues.map((a, i) => a !== null || expectedValues[i] !== null);
	const contentCount = contentRows.filter(Boolean).length;

	// 2) 헤더가 없는 제목 열 추정 (예: 제목 칸에 값은 있는데 헤더가 비어 있음)
	if (roles.title === undefined) {
		const limit = Math.min(
			...[roles.precondition, roles.step, roles.action].filter((c): c is number => c !== undefined)
		);
		for (let c = (roles.id ?? 0) + 1; c < limit; c++) {
			if (cellText(sheet, headerRow, c) !== null) continue;
			const values = columnValues(sheet, c, first, end).filter((v, i) => v !== null && contentRows[i]);
			if (values.length > 0 && ratio(values.length, contentCount) < 0.5) {
				roles.title = c;
				evidence.push(`${columnLetter(c)}열은 헤더가 없지만 TC 첫 행에만 값이 있어 제목으로 추정`);
				break;
			}
		}
	}

	const columns: Partial<Record<ColumnRole, string>> = {};
	for (const [role, index] of Object.entries(roles) as [ColumnRole, number][]) columns[role] = columnLetter(index);
	evidence.push(
		`헤더 ${headerRow}행: ${Object.entries(columns)
			.map(([role, col]) => `${role}=${col}`)
			.join(', ')}`
	);

	// 3) 새 TC 시작 기준: 값이 채워진 ID → ID(+제목), ID가 비어 있으면 제목
	const fill = (role: ColumnRole): number => {
		const values = columnValues(sheet, roles[role], first, end);
		return ratio(values.filter((v, i) => v !== null && contentRows[i]).length, contentCount);
	};
	const groupStart: ColumnRole[] = [];
	if (roles.id !== undefined && fill('id') > 0) groupStart.push('id');
	if (roles.title !== undefined && fill('title') > 0) groupStart.push('title');
	if (groupStart.length === 0) evidence.push('ID·제목 열이 비어 있어 TC 묶기 기준을 정하지 못함 (사람 확인 필요)');
	else
		evidence.push(
			`새 TC 시작: ${groupStart.join(' 또는 ')} 칸에 값이 있는 행 (채워진 비율 ${groupStart.map((r) => `${r} ${pct(fill(r))}`).join(', ')}), 아래 행은 이어받음`
		);
	if (roles.id !== undefined && !groupStart.includes('id')) evidence.push('ID 열은 있지만 비어 있음');

	// 4) 절차 형식: "1. …" 번호 목록이면 numbered-list
	const actions = actionValues.filter((v): v is string => v !== null);
	const numbered = ratio(actions.filter((a) => /^\s*1\s*[.)]\s*\S/.test(a)).length, actions.length);
	const stepFormat = numbered >= 0.5 ? 'numbered-list' : 'row-per-step';
	evidence.push(
		stepFormat === 'numbered-list'
			? `조작 칸의 ${pct(numbered)}가 "1. …" 번호 목록 → 한 칸 안의 항목을 나눔`
			: '조작 칸이 행마다 한 단계'
	);

	// 5) 앞 단계 참조 (예: "seq 3 수행")
	let referencePattern: string | null = null;
	for (const pattern of REFERENCE_PATTERNS) {
		const hits = actions.filter((a) => pattern.test(a)).length;
		if (hits > 0) {
			referencePattern = pattern.source;
			evidence.push(`앞 단계 참조 ${hits}건 (예: ${pattern.source})`);
			break;
		}
	}

	// 6) 화면설계서 번호가 든 TC ID (예: scenario_v1.2.3_4.1)
	const ids = columnValues(sheet, roles.id, first, end).filter((v): v is string => v !== null);
	let specIdPattern: string | null = null;
	const specHits = ids.filter((id) => new RegExp(SPEC_ID_PATTERN, 'i').test(id)).length;
	if (ids.length > 0 && ratio(specHits, ids.length) >= 0.5) {
		specIdPattern = SPEC_ID_PATTERN;
		evidence.push(`TC ID ${specHits}/${ids.length}개가 scenario_v<버전>_<화면설계서 번호> 형식`);
	}

	// 7) 콜아웃 참조 (예: "(1) Search field 영역")
	let targetRefPattern: string | null = null;
	const targetHits = actions.filter((a) => new RegExp(TARGET_REF_PATTERN).test(a.split('\n')[0] ?? '')).length;
	if (ratio(targetHits, actions.length) >= 0.1) {
		targetRefPattern = TARGET_REF_PATTERN;
		evidence.push(`조작 칸 ${targetHits}/${actions.length}개가 "(번호) 이름" 콜아웃 참조`);
	}

	const required: ColumnRole[] = ['action', 'expected', 'result'];
	const missing = required.filter((r) => columns[r] === undefined);
	if (missing.length > 0) evidence.push(`필수 열 없음: ${missing.join(', ')} (사람 확인 필요)`);
	const confidence =
		(missing.length === 0 ? 0.6 : 0.2) +
		(groupStart.length > 0 ? 0.3 : 0) +
		(columns.precondition !== undefined ? 0.1 : 0);

	return {
		...base,
		include: missing.length === 0 && groupStart.length > 0,
		columns,
		groupStart,
		stepFormat,
		referencePattern,
		specIdPattern,
		targetRefPattern,
		confidence: Math.min(1, Math.round(confidence * 100) / 100)
	};
}

export function suggestProfile(grid: Grid): TcProfile {
	return { version: 1, sheets: grid.sheets.map(suggestSheetProfile) };
}

/** 프로필의 열 문자를 번호로 (정규화용) */
export function roleColumns(profile: SheetProfile): Partial<Record<ColumnRole, number>> {
	const out: Partial<Record<ColumnRole, number>> = {};
	for (const [role, letter] of Object.entries(profile.columns) as [ColumnRole, string][])
		out[role] = columnIndex(letter);
	return out;
}
