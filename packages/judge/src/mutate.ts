import type { SpecKey } from '@auto-qa/spec';

/**
 * 일부러 틀린 TC 만들기 (Fail 검출률 측정용). 원본 QA 결과가 모두 Pass라 일치율만 보면 "다 Pass 주는 엔진"도
 * 100%가 된다. 그래서 TC 사본의 기대 문장 하나를 앱과 다르게 바꾸고, 엔진이 그 조건을 Fail로 잡는지 본다.
 *
 * 바꾸는 것은 TC 문장뿐이고(앱·데이터 무관), 바꾼 조건은 앱이 원래 TC대로 움직이면 반드시 달라지는 것만 고른다:
 * - move-to-none: "[▼] Back to Top 버튼 포커스" → "[▼] 동작 없음" (앱이 움직이면 Fail)
 * - none-to-move: "[◀] 동작 없음" → "[◀] <같은 화면 다른 콜아웃> 포커스" (앱이 제자리면 Fail)
 * 어느 키 줄을 바꿀지는 부르는 쪽이 정한다 (원래 실행에서 Pass였던 키 조건 → 바꾸면 Fail이어야 함).
 */

export type MutationOp = 'move-to-none' | 'none-to-move';

export interface KeyLine {
	/** 원문 줄 번호 (0부터, 빈 줄 포함) */
	index: number;
	key: SpecKey;
	/** 키 표시 그대로 (예: "▼") */
	mark: string;
	/** 키 표시 뒤 문장 */
	body: string;
	/** 이 키 조건에 붙는 아래 줄들 (원문 줄 번호) */
	continuation: number[];
	/** splitClauses가 만드는 조건 글자 ("[▼] 본문 / 아래 줄") — 실행 결과의 조건과 맞춰 보는 데 쓴다 */
	clause: string;
}

export interface KeyMutation {
	op: MutationOp;
	key: SpecKey;
	/** 바꾸기 전 조건 글자 (splitClauses 꼴) */
	before: string;
	/** 바꾼 뒤 조건 글자 (splitClauses 꼴) */
	after: string;
	/** 바꾼 기대 결과 칸 전체 */
	text: string;
}

export interface MutateOptions {
	/** "동작 없음"으로 읽는 말 */
	noneWords: string[];
}

export const DEFAULT_MUTATE_OPTIONS: MutateOptions = {
	noneWords: ['동작 없음', '동작없음', '반응 없음', '이동 없음', '이동하지 않음']
};

const KEY_LINE = /^\[\s*(▲|▼|◀|▶|◄|►)\s*\]\s*[:：]?\s*(.*)$/;
const SECTION_LINE = /^\d+\)\s*[^:：]+/;
const KEYS: Record<string, SpecKey> = { '▲': 'up', '▼': 'down', '◀': 'left', '▶': 'right', '◄': 'left', '►': 'right' };

/** splitClauses와 같은 정리: 이체 선택자·연속 공백 제거, 앞 글머리표 제거 */
function clean(raw: string): string {
	return raw
		.replace(/[︎️]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[-•·]\s*/, '')
		.trim();
}

/** 기대 결과 글자의 4방향 키 줄 (OK·Back은 화면 전환이라 여기서 바꾸지 않는다) */
export function keyLines(expected: string): KeyLine[] {
	const raw = expected.split('\n');
	const out: KeyLine[] = [];
	let current: KeyLine | null = null;
	raw.forEach((r, index) => {
		const line = clean(r);
		if (line === '') return;
		if (SECTION_LINE.test(line) || /^\[\s*(OK|Back)\s*\]/i.test(line)) {
			current = null;
			return;
		}
		const m = KEY_LINE.exec(line);
		if (m !== null) {
			const mark = m[1] ?? '';
			const body = (m[2] ?? '').trim();
			current = { index, key: KEYS[mark] ?? 'up', mark, body, continuation: [], clause: `[${mark}] ${body}` };
			out.push(current);
			return;
		}
		if (current !== null) {
			current.continuation.push(index);
			current.clause = `${current.clause} / ${line}`;
		}
	});
	return out;
}

/** 키 줄 하나를 새 문장으로 바꾼다. 그 줄에 붙은 아래 줄(조건)은 지운다 (조건이 남으면 바꾼 뜻이 되돌려질 수 있음) */
export function replaceKeyLine(expected: string, line: KeyLine, body: string): string {
	const raw = expected.split('\n');
	const original = raw[line.index] ?? '';
	const lead = /^\s*[-•·]?\s*/.exec(original)?.[0] ?? '';
	const drop = new Set(line.continuation);
	return raw
		.map((r, i) => (i === line.index ? `${lead}[${line.mark}] ${body}` : r))
		.filter((_, i) => !drop.has(i))
		.join('\n');
}

/**
 * 키 줄 하나를 틀리게 바꾼다. targets: 같은 화면의 다른 콜아웃 이름 (none-to-move에 쓴다, 앞에서부터).
 * 바꿀 수 없으면(동작 없음인데 다른 이름이 없음) null.
 */
export function mutateKeyLine(
	expected: string,
	line: KeyLine,
	targets: readonly string[],
	options: MutateOptions = DEFAULT_MUTATE_OPTIONS
): KeyMutation | null {
	const none = options.noneWords.some((w) => line.body.includes(w));
	let op: MutationOp;
	let body: string;
	if (none) {
		const target = targets.map((t) => t.replace(/\s+/g, ' ').trim()).find((t) => t !== '');
		if (target === undefined) return null;
		op = 'none-to-move';
		body = `${target} 포커스`;
	} else {
		op = 'move-to-none';
		body = options.noneWords[0] ?? '동작 없음';
	}
	return {
		op,
		key: line.key,
		before: line.clause,
		after: `[${line.mark}] ${body}`,
		text: replaceKeyLine(expected, line, body)
	};
}

/**
 * 키 밖의 조건을 틀리게 바꾸기 (원래 실행에서 Pass였던 조건만, 바꾸면 반드시 Fail이어야 하는 것):
 * - count-below: "최대 5개" → "최대 {보인 개수 - 1}개" (보인 개수가 2 이상일 때)
 * - text-changed: 정해진 문구 “X” → “X 틀림”
 * clause는 splitClauses가 만든 조건 글자. 바꾼 조건 글자(after)는 바꾼 칸을 다시 나눠 얻는다(실행 결과와 맞춰 보려고)
 */
export type ValueMutationOp = 'count-below' | 'text-changed';

export interface ValueMutation {
	op: ValueMutationOp;
	before: string;
	after: string;
	text: string;
}

const COUNT_PATTERNS = [/(최대\s*)(\d+)(\s*개)/, /(top\s*)(\d+)()/i, /()(\d+)(\s*개(?:까지)?\s*(?:제공|노출|표시))/];

/** 조건 글자가 들어 있는 원문 줄 번호 (조건 첫 부분이 줄과 같은 것). 없으면 -1 */
function lineOf(expected: string, clause: string): number {
	const head = clean(clause.split(' / ')[0] ?? clause);
	return expected.split('\n').findIndex((r) => clean(r) === head);
}

export function mutateCount(expected: string, clause: string, seen: number): ValueMutation | null {
	if (seen < 2) return null;
	const raw = expected.split('\n');
	const i = lineOf(expected, clause);
	if (i < 0) return null;
	const line = raw[i] ?? '';
	const pattern = COUNT_PATTERNS.find((p) => p.test(line));
	if (pattern === undefined) return null;
	const changed = line.replace(pattern, (_m, a: string, _n: string, b: string) => `${a}${seen - 1}${b}`);
	raw[i] = changed;
	return {
		op: 'count-below',
		before: clause,
		after: clause.replace(clean(line), clean(changed)),
		text: raw.join('\n')
	};
}

export function mutateExactText(expected: string, clause: string, quoted: string): ValueMutation | null {
	const raw = expected.split('\n');
	const i = lineOf(expected, clause);
	if (i < 0 || quoted.trim() === '') return null;
	const line = raw[i] ?? '';
	if (!line.includes(quoted)) return null;
	const changed = line.replace(quoted, `${quoted} 틀림`);
	raw[i] = changed;
	return {
		op: 'text-changed',
		before: clause,
		after: clause.replace(clean(line), clean(changed)),
		text: raw.join('\n')
	};
}
