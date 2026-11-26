import { describe, expect, it } from 'vitest';
import { splitClauses } from './clauses';
import type { Check, Clause } from './clauses';
import { checkExactText, checkMaxCount, checkPresence, normalizeText } from './text';
import { aggregateStep, gateAiVerdict } from './verdict';
import type { CheckResult } from './verdict';

/** 합성 기대 결과 (실제 TC와 같은 형식, 내용은 합성) */
const EXPECTED = [
	'1) 표시 내용',
	'- 타이틀, 텍스트 버튼',
	'- 최대 5개까지 제공',
	'- 키워드가 버튼 크기를 벗어날 경우 말줄임 처리하며, 포커스 시 2초 뒤 Marquee 제공',
	'- 매주 월요일 00:00에 갱신',
	'- 플레이스 홀더 “Search your place.” 제공',
	'- “{Keyword}” 버튼에 포커스',
	'- 기능/동작 방식은 키보드 정책을 따름',
	'- 최대 입력 가능 글자 수: 255자',
	'- 화면 전체가 자연스럽게 보인다',
	'2) 선택 시',
	'- #9.2. 결과 페이지로 이동',
	'- 팝업 외 영역 선택 시 팝업 닫힘',
	'3) 포커스 된 상태에서 4way-key 입력 시',
	'- [▲]: 동작 없음',
	'- [▼]: 목록 첫 번째 항목으로 이동',
	'  - 이동한 이력이 있을 경우: 마지막 포커스 항목',
	'- [►]: 다음 항목으로 이동',
	'  - 더 이상 이동할 항목이 없을 경우 동작 없음'
].join('\n');

const kinds = (c: Clause | undefined): string[] => (c?.checks ?? []).map((k) => `${k.kind}:${k.method}`);

describe('기대 결과를 조건으로 나누기', () => {
	const clauses = splitClauses(EXPECTED);
	const find = (part: string): Clause | undefined => clauses.find((c) => c.text.includes(part));

	it('묶음 제목은 조건이 아니고, 키 동작 아래 조건 줄은 그 키에 붙는다', () => {
		expect(clauses.map((c) => c.section)).not.toContain(null);
		expect(clauses.some((c) => c.text === '표시 내용')).toBe(false);
		const down = clauses.find((c) => c.key === 'down');
		expect(down?.text).toBe('[▼] 목록 첫 번째 항목으로 이동 / 이동한 이력이 있을 경우: 마지막 포커스 항목');
		expect(clauses.find((c) => c.key === 'right')?.text).toContain('더 이상 이동할 항목이 없을 경우');
		expect(clauses.length).toBe(14);
	});

	it('조건마다 판정 방법을 정한다', () => {
		expect(kinds(find('타이틀'))).toEqual(['presence:code']);
		expect(kinds(find('최대 5개'))).toEqual(['count:code']);
		expect(kinds(find('말줄임'))).toEqual(['ellipsis:code', 'motion:code']);
		expect(kinds(find('매주'))).toEqual(['data:none']);
		expect(kinds(find('결과 페이지'))).toEqual(['transition:code']);
		expect(kinds(find('[▲]'))).toEqual(['key:code']);
		expect(kinds(find('플레이스 홀더'))).toEqual(['exact-text:code']);
		expect(find('플레이스 홀더')?.checks[0]?.value).toBe('Search your place.');
		expect(kinds(find('Keyword'))).toEqual(['focus:code', 'presence:code']);
		expect(kinds(find('정책을 따름'))).toEqual(['reference:none']);
		expect(kinds(find('255자'))).toEqual(['input:none']);
		expect(kinds(find('자연스럽게'))).toEqual(['descriptive:ai']);
		expect(kinds(find('팝업 닫힘'))).toEqual(['behavior:code']);
	});

	it('괄호 속 참조는 보충으로 보고, 검색·편성 규칙과 글자 입력 조건은 화면으로 확인하지 않는다', () => {
		const [menu, search, sorted, typed, idx] = splitClauses(
			[
				'- 저장 메뉴 제공(#9.3. 다른 페이지 참고)',
				'- 검색어가 제목에 포함된 경우 해당 콘텐츠 노출',
				'- 지표 수치가 같으면 이름 오름차순',
				'- 입력값이 영역을 벗어날 경우 말줄임 처리',
				'- 이미지 상세 페이지 진입이 많은 콘텐츠'
			].join('\n')
		);
		expect(kinds(menu)).toEqual(['presence:code']);
		expect(kinds(search)).toEqual(['data:none']);
		expect(kinds(sorted)).toEqual(['data:none']);
		expect(kinds(typed)).toEqual(['input:none']);
		expect(kinds(idx)).toEqual(['data:none']);
	});
});

describe('글자·개수 비교 (문구는 UX 기준, D-036)', () => {
	it('정해진 문구는 글자 그대로 비교하고, 다르면 가장 비슷한 글자를 설명에 넣는다', () => {
		expect(checkExactText('Search your place.', ['Search your place.'], '① 검색창').verdict).toBe('pass');
		const r = checkExactText('Search your place.', ['Search place', 'Back'], '① 검색창');
		expect(r.verdict).toBe('fail');
		expect(r.explanation).toBe('① 검색창 문구가 다름: 기대 "Search your place." / 실제 "Search place"');
		expect(checkExactText('Search your place.', [], '① 검색창').explanation).toContain('문구가 없음');
	});

	it('따옴표 모양·공백만 맞추고 대소문자·마침표는 설정으로 정한다', () => {
		expect(normalizeText('  “All”   tab ')).toBe('"All" tab');
		expect(checkExactText('Done.', ['done'], 'x').verdict).toBe('fail');
		expect(checkExactText('Done.', ['done'], 'x', { ignoreCase: true, ignoreTrailingPeriod: true }).verdict).toBe(
			'pass'
		);
	});

	it('바뀔 수 있는 글자는 있는지만 본다', () => {
		expect(checkPresence(['Weekly Picks'], '② 타이틀').explanation).toBe(
			'② 타이틀에 글자 있음 (현재: "Weekly Picks")'
		);
		expect(checkPresence(['  '], '② 타이틀').verdict).toBe('fail');
	});

	it('개수 상한', () => {
		expect(checkMaxCount(5, 6, '최근 검색어')).toEqual({
			verdict: 'fail',
			explanation: '최근 검색어 6개 — 최대 5개를 넘음'
		});
		expect(checkMaxCount(5, 3, '최근 검색어').verdict).toBe('pass');
	});
});

describe('AI 판정 처리 (D-036 ④)', () => {
	it('AI의 pass는 기준 미만이면 확인 필요 + AI 의견, 사람이 확인한 입력이면 Pass', () => {
		const ai = { verdict: 'pass' as const, confidence: 0.8, reason: '설명 3줄이 모두 보임' };
		expect(gateAiVerdict(ai, false).verdict).toBe('needs-review');
		expect(gateAiVerdict(ai, false).explanation).toContain('AI 의견: 통과로 보임');
		expect(gateAiVerdict(ai, true).verdict).toBe('pass');
		expect(gateAiVerdict(ai, false, { passThreshold: 0.75 }).verdict).toBe('pass');
		expect(gateAiVerdict({ ...ai, verdict: 'fail' }, false).verdict).toBe('fail');
		expect(gateAiVerdict({ ...ai, verdict: 'uncertain' }, false).verdict).toBe('needs-review');
	});
});

describe('단계 판정 모으기 (D-037)', () => {
	const clause = (text: string): Clause => ({ text, section: null, key: null, checks: [] });
	const check: Check = { kind: 'presence', method: 'code', value: null, reason: '' };
	const result = (
		text: string,
		verdict: CheckResult['verdict'],
		oracle: CheckResult['oracle'] = 'code'
	): CheckResult => ({
		clause: clause(text),
		check,
		verdict,
		explanation: `${text}: ${verdict ?? '확인 안 함'}`,
		oracle,
		confidence: null
	});

	it('확인 불가 조건은 Pass를 막지 않고 설명에 적는다', () => {
		const s = aggregateStep([result('타이틀', 'pass'), result('매주 월요일 00:00에 갱신', null, 'none')]);
		expect(s.verdict).toBe('pass');
		expect(s.explanation).toBe('화면으로 확인한 조건 1개 모두 통과\n확인하지 않은 조건: 매주 월요일 00:00에 갱신');
		expect(s.basis).toBe('코드 1 · AI 0 · 확인 불가 1');
	});

	it('하나라도 Fail이면 Fail, Fail이 없고 확인 필요가 있으면 확인 필요', () => {
		expect(
			aggregateStep([result('a', 'pass'), result('b', 'fail'), result('c', 'needs-review', 'ai')]).verdict
		).toBe('fail');
		const r = aggregateStep([result('a', 'pass'), result('c', 'needs-review', 'ai')]);
		expect(r.verdict).toBe('needs-review');
		expect(r.explanation).toBe('c: needs-review');
	});

	it('화면으로 확인할 조건이 없으면 확인 필요', () => {
		const s = aggregateStep([result('Admin에서 편성', null, 'none')]);
		expect(s.verdict).toBe('needs-review');
		expect(s.explanation).toContain('화면으로 확인할 수 있는 조건이 없음');
	});
});
