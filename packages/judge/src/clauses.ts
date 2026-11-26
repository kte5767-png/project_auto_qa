import { lines } from '@auto-qa/spec';
import type { SpecKey } from '@auto-qa/spec';

/**
 * TC 기대 결과를 조건으로 나누고, 조건마다 판정 방법을 규칙으로 정한다 (D-037).
 * 실제 TC의 기대 결과는 화면설계서 설명과 같은 형식이다: "1) 표시 내용", "- 항목", "[▼]: 키 동작".
 * 규칙 기반·결정적이며 AI를 쓰지 않는다. 낱말 목록은 옵션(프로젝트 프로필로 옮길 값).
 */

/** 판정 방법: 코드(DOM·포커스·이동) / AI(시각·서술형, D-036 ④) / 화면으로 확인 불가 */
export type CheckMethod = 'code' | 'ai' | 'none';

export type CheckKind =
	/** 방향키·OK·Back 동작 (경로 해석기와 같은 문장) */
	| 'key'
	/** 포커스 위치·기본 포커스·커서 */
	| 'focus'
	/** 개수 (최대 N개, Top N) */
	| 'count'
	/** 정해진 문구 — 글자 그대로 비교 (D-036 ②) */
	| 'exact-text'
	/** 그 자리에 요소·글자가 있는지 (D-036 ②, 바뀔 수 있는 글자 포함) */
	| 'presence'
	/** 말줄임 */
	| 'ellipsis'
	/** 움직임·시간 (Marquee, N초 뒤) */
	| 'motion'
	/** 화면 전환 */
	| 'transition'
	/** 가상 키보드 호출 */
	| 'keyboard'
	/** 선택해도 동작 없음 */
	| 'no-action'
	/** 조작 → 결과 (선택 시 닫힘, On/Off 가능, 루프 안 됨) */
	| 'behavior'
	/** 요소가 없어야 함 (미노출) */
	| 'absence'
	/** 글자 입력이 필요한 조건 (지금 계획 범위 밖) */
	| 'input'
	/** 운영·백엔드 데이터, 정렬 기준, 시간, 무작위, 검색·편성 규칙 */
	| 'data'
	/** 다른 정책·문서·페이지 참조 */
	| 'reference'
	/** 규칙에 걸리지 않은 서술 */
	| 'descriptive';

export interface Check {
	kind: CheckKind;
	method: CheckMethod;
	/** 비교에 쓸 값 (예: 개수 상한, 문구, 키) */
	value: string | number | null;
	reason: string;
}

export interface Clause {
	/** 조건 문장 (키 동작은 "[▼] …" 형식) */
	text: string;
	/** 속한 묶음 제목 (예: "표시 내용") */
	section: string | null;
	key: SpecKey | null;
	checks: Check[];
}

export interface ClauseOptions {
	/** 이 낱말이 있으면 화면으로 확인 불가(운영·백엔드 데이터) */
	dataWords: string[];
	/** 이 낱말이 있으면 검색·편성 규칙(결과가 어떤 데이터인지) — 요소가 있는지도 따로 보지 않는다 */
	ruleWords: string[];
	/** 이 낱말이 있으면 다른 문서·정책 참조 */
	referenceWords: string[];
	/** 글자 입력이 필요한 조건 */
	inputWords: string[];
	/** "표시 내용"처럼 있는지 확인할 묶음 제목 */
	presenceSections: string[];
	/** 문장 끝이 이 낱말이면 그 요소가 있는지 확인 */
	presenceEndings: string[];
}

export const DEFAULT_CLAUSE_OPTIONS: ClauseOptions = {
	dataWords: [
		'Admin',
		'편성',
		'매주',
		'매일',
		'월요일',
		'00:00',
		'기준',
		'카운트',
		'랜덤',
		'적재',
		'조회',
		'인기',
		'최신순',
		'순서대로',
		'서버',
		'로그',
		'많은',
		'산정',
		'비중'
	],
	ruleWords: [
		'검색 시',
		'필터링 시',
		'포함될 경우',
		'포함된 경우',
		'포함되지 않을 경우',
		'포함하여',
		'포함됨',
		'일치하는 경우',
		'일치하거나',
		'정렬',
		'우선순위',
		'중요도',
		'오름차순',
		'내림차순',
		'지표',
		'슬롯',
		'미만인 경우',
		'로만 제공',
		'그룹'
	],
	referenceWords: ['정책을 따름', '참고', '시나리오 문서'],
	inputWords: ['입력 가능 글자', '입력값', '공백 입력', '입력할 때'],
	presenceSections: ['표시 내용', '표시'],
	presenceEndings: ['제공', '노출', '표시', '제공됨', '노출됨', '표시됨']
};

const KEY_LINE = /^\[\s*(▲|▼|◀|▶|◄|►|OK|Back)\s*\]\s*[:：]?\s*(.*)$/i;
const SECTION_LINE = /^(\d+)\)\s*([^:：]+?)\s*(?:[:：]\s*(.*))?$/;
const KEYS: Record<string, SpecKey> = {
	'▲': 'up',
	'▼': 'down',
	'◀': 'left',
	'▶': 'right',
	'◄': 'left',
	'►': 'right',
	ok: 'ok',
	back: 'back'
};
const QUOTED = /[“"‘'「]([^“”"‘’'「」]{2,}?)[”"’'」]/g;

/** 기대 결과 글자를 조건 줄로 나눈다 */
export function splitClauses(expected: string, options: ClauseOptions = DEFAULT_CLAUSE_OPTIONS): Clause[] {
	const out: Clause[] = [];
	let section: string | null = null;
	// 앞 조건 (묶음 제목을 만나면 끊는다). 클로저에서 바꾸므로 객체에 둔다
	const state: { last: Clause | null } = { last: null };
	const push = (text: string, key: SpecKey | null): void => {
		const clean = text.replace(/^[-*•·]\s*/, '').trim();
		if (clean === '') return;
		const clause: Clause = { text: clean, section, key, checks: [] };
		state.last = clause;
		out.push(clause);
	};
	for (const raw of lines(expected)) {
		const line = raw.replace(/^[-•·]\s*/, '').trim();
		const sec = SECTION_LINE.exec(line);
		if (sec !== null) {
			section = (sec[2] ?? '').trim();
			state.last = null;
			if ((sec[3] ?? '').trim() !== '') push(sec[3] ?? '', null);
			continue;
		}
		const key = KEY_LINE.exec(line);
		if (key !== null) {
			const name = KEYS[(key[1] ?? '').toLowerCase()] ?? null;
			push(`[${key[1] ?? ''}] ${(key[2] ?? '').trim()}`, name);
			continue;
		}
		// 앞 조건에 붙는 줄: 키 동작 아래 줄(조건·보충), 괄호로 시작하는 보충, "예:" 예시, "1. 항목" 하위 목록
		const current = state.last;
		if (
			current !== null &&
			(current.key !== null || /^\(/.test(line) || /^예\s*[:：]/.test(line) || /^\d+\.\s/.test(line))
		) {
			current.text = `${current.text} / ${line}`;
			continue;
		}
		push(line, null);
	}
	for (const c of out) c.checks = classifyClause(c, options);
	return out;
}

const has = (text: string, words: readonly string[]): string | undefined =>
	words.find((w) => text.toLowerCase().includes(w.toLowerCase()));

/** 조건 하나의 판정 방법들 (여러 개일 수 있다: "최대 3개, 랜덤 제공" → 개수(코드) + 데이터(확인 불가)) */
export function classifyClause(clause: Clause, options: ClauseOptions = DEFAULT_CLAUSE_OPTIONS): Check[] {
	const t = clause.text;
	const checks: Check[] = [];
	const add = (kind: CheckKind, method: CheckMethod, value: Check['value'], reason: string): void => {
		if (!checks.some((c) => c.kind === kind && c.value === value)) checks.push({ kind, method, value, reason });
	};

	if (clause.key !== null) {
		add('key', 'code', clause.key, '키 동작 — 경로 해석기로 기대 포커스를 정해 TV에서 확인');
		return checks;
	}

	// "(#4.3. … 페이지 참고)" 같은 괄호 속 참조는 보충이다. 본문을 먼저 보고, 본문에 판정할 것이 없을 때만 참조로 둔다
	const body = t
		.replace(/\([^()]*참고[^()]*\)/g, ' ')
		.replace(/^\d+\.\s*/, '')
		.trim();
	const ref = has(t, options.referenceWords) ?? (/#\s*\d+(\.\d+)+/.test(t) ? '#' : undefined);
	const transition =
		/(페이지|화면|page)\s*(으로|로)?\s*(이동|진입|전환)(?!\s*(이|횟수|이력|시(?![가-힣])))/i.test(body) ||
		/(으로|로)\s*진입$/.test(body);
	const data = has(body, options.dataWords);
	if (data !== undefined) add('data', 'none', data, `운영·백엔드 데이터 ("${data}")`);
	const rule = has(body, options.ruleWords);
	if (rule !== undefined) add('data', 'none', rule, `검색·편성 규칙 ("${rule}")`);
	const input = has(body, options.inputWords);
	if (input !== undefined) {
		// 글자 입력이 있어야 확인할 수 있는 조건 — 같은 문장의 다른 조건도 입력이 먼저다
		add('input', 'none', input, `글자 입력 조작이 필요 ("${input}") — 지금 계획 범위 밖`);
		return checks;
	}

	const max =
		/최대\s*(\d+)\s*개/.exec(body) ??
		/top\s*(\d+)/i.exec(body) ??
		/(\d+)\s*개(?:까지)?\s*(?:제공|노출|표시)/.exec(body);
	if (max !== null) add('count', 'code', Number(max[1]), `개수 ${max[1]}`);
	if (rule === undefined) {
		if (/말줄임/.test(body)) add('ellipsis', 'code', null, '말줄임 (DOM 넘침·text-overflow)');
		if (/marquee|\d+\s*초\s*(뒤|후)/i.test(body)) add('motion', 'code', null, '움직임·시간 (DOM 위치 변화)');
		if (
			/포커스(되어|가|를|된|로)?\s*(제공|위치|이동|유지)|default\s*포커스|커서가?\s*제공|에\s*포커스\s*$/i.test(
				body
			)
		) {
			add('focus', 'code', null, '포커스 위치');
		}
		if (transition) add('transition', 'code', null, '화면 전환');
		if (/VKB|키보드/.test(body) && /호출/.test(body))
			add('keyboard', 'code', null, '가상 키보드 호출 (키보드 상태 이벤트)');
		if (/선택\s*불가/.test(body)) add('no-action', 'code', null, 'OK를 눌러도 동작 없음');
		if (/미노출|노출되지\s*않|제공하지\s*않/.test(body)) add('absence', 'code', null, '요소가 없어야 함');
		if (
			/(선택|누르|누를|변경|버튼을)\S*\s*(시|경우|하면|거나)/.test(body) &&
			/(닫힘|열림|제공|이동|호출|동작|노출)/.test(body)
		) {
			add('behavior', 'code', null, '조작 → 결과 (계획에 조작 단계를 넣어 확인)');
		}
		if (/가능$|루프/.test(body.replace(/[.\s]+$/, '')))
			add('behavior', 'code', null, '조작 → 결과 (계획에 조작 단계를 넣어 확인)');

		if (ref === undefined || !/참고/.test(t)) {
			for (const m of body.matchAll(QUOTED)) {
				const q = (m[1] ?? '').trim();
				// {…}는 바뀌는 값이라 있는지만 본다 (D-036 ②)
				if (/[{}]/.test(q)) add('presence', 'code', q, `바뀌는 값 "${q}" — 있는지만`);
				else add('exact-text', 'code', q, `정해진 문구 "${q}" — 글자 그대로`);
			}
		}
		if (!checks.some((c) => c.method === 'code') && /\{[^{}]+\}/.test(body)) {
			add('presence', 'code', null, '바뀌는 값({…}) — 있는지만');
		}
	}

	const inPresenceSection =
		clause.section !== null && options.presenceSections.some((s) => clause.section?.includes(s));
	const endsPresence = options.presenceEndings.some((e) => body.replace(/[.\s]+$/, '').endsWith(e));
	// 다른 코드 판정(개수 등)이 없을 때만 "있는지"를 본다. 데이터 조건(정렬 기준 등)이 섞이면 "…제공/노출"로 끝날 때만
	const hasData = data !== undefined;
	const bodyRef = has(body, options.referenceWords);
	if (
		rule === undefined &&
		bodyRef === undefined &&
		checks.every((c) => c.method === 'none') &&
		// "표시 내용" 묶음의 명사 항목("타이틀, 텍스트 버튼")만. 서술문("…보인다")은 AI로
		(endsPresence || (inPresenceSection && !hasData && !/(다|음|함|됨|짐|임)$/.test(body.replace(/[.\s]+$/, ''))))
	) {
		add(
			'presence',
			'code',
			null,
			inPresenceSection ? `"${clause.section ?? ''}" 항목 — 있는지만` : '요소 제공 — 있는지만'
		);
	}
	// 서술어 없이 이름만 적힌 항목("콘텐츠 정보", "텍스트, 버튼")은 그 요소가 보여야 한다는 뜻이다
	const noun = !/(다|음|함|됨|짐|임|않음|없음|경우|시)$/.test(body.replace(/[.\s]+$/, ''));
	if (
		rule === undefined &&
		bodyRef === undefined &&
		data === undefined &&
		checks.length === 0 &&
		noun &&
		body !== ''
	) {
		add('presence', 'code', null, '이름만 적힌 항목 — 있는지만');
	}
	if (ref !== undefined && !checks.some((c) => c.method === 'code')) {
		add('reference', 'none', ref, `다른 문서·페이지 참조 ("${ref}")`);
	}
	if (checks.length === 0) add('descriptive', 'ai', null, '규칙에 없는 서술 — AI 판정(신뢰도 기준, D-036 ④)');
	return checks;
}
