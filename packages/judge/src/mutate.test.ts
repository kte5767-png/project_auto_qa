import { describe, expect, it } from 'vitest';
import { splitClauses } from './clauses';
import { keyLines, mutateCount, mutateExactText, mutateKeyLine, replaceKeyLine } from './mutate';

/** 합성 기대 결과 (TC 꼴: 묶음 제목, 키 줄, 키 줄 아래 조건 줄, 이체 선택자) */
const EXPECTED = [
	'1)표시 내용',
	'- 아이콘 버튼',
	'2)선택 시',
	'- 화면 최상단으로 이동',
	'3)포커스 된 상태에서 4way key 입력 시',
	'[▲]: Recent 첫 번째 항목에 포커스 ',
	'-Recent가 없을 경우 Keywords의 라스트포커스로 이동',
	'[▼]: 동작 없음',
	'[◀]: 동작 없음',
	'[︎►]: 동작 없음'
].join('\n');

describe('keyLines', () => {
	it('4방향 키 줄과 아래 조건 줄을 splitClauses와 같은 조건 글자로 모은다', () => {
		const lines = keyLines(EXPECTED);
		expect(lines.map((l) => l.key)).toEqual(['up', 'down', 'left', 'right']);
		const fromJudge = splitClauses(EXPECTED)
			.filter((c) => c.key !== null)
			.map((c) => c.text);
		expect(lines.map((l) => l.clause)).toEqual(fromJudge);
		expect(lines[0]?.continuation).toEqual([6]);
	});

	it('OK·Back 줄과 묶음 제목에서 끊는다', () => {
		const lines = keyLines('[▼] Top Picks 포커스\n[OK] 상세 화면 이동\n- 이동 중 로딩 표시');
		expect(lines).toHaveLength(1);
		expect(lines[0]?.continuation).toEqual([]);
	});
});

describe('mutateKeyLine', () => {
	const [up, down] = keyLines(EXPECTED);

	it('움직이는 키는 "동작 없음"으로 바꾸고 아래 조건 줄은 지운다', () => {
		const m = up === undefined ? null : mutateKeyLine(EXPECTED, up, ['Keywords']);
		expect(m).toMatchObject({
			op: 'move-to-none',
			key: 'up',
			before: '[▲] Recent 첫 번째 항목에 포커스 / Recent가 없을 경우 Keywords의 라스트포커스로 이동',
			after: '[▲] 동작 없음'
		});
		const clauses = splitClauses(m?.text ?? '').filter((c) => c.key !== null);
		expect(clauses.map((c) => c.text)).toEqual([
			'[▲] 동작 없음',
			'[▼] 동작 없음',
			'[◀] 동작 없음',
			'[►] 동작 없음'
		]);
		// 키 줄이 아닌 줄은 그대로
		expect(m?.text.split('\n').slice(0, 5)).toEqual(EXPECTED.split('\n').slice(0, 5));
	});

	it('"동작 없음"은 같은 화면의 다른 콜아웃으로 가라고 바꾼다', () => {
		const m = down === undefined ? null : mutateKeyLine(EXPECTED, down, [' ', 'Back to Top']);
		expect(m).toMatchObject({ op: 'none-to-move', after: '[▼] Back to Top 포커스' });
		expect(splitClauses(m?.text ?? '').find((c) => c.key === 'down')?.text).toBe('[▼] Back to Top 포커스');
	});

	it('다른 이름이 없으면 "동작 없음"은 바꾸지 않는다', () => {
		expect(down === undefined ? 'x' : mutateKeyLine(EXPECTED, down, [])).toBeNull();
	});

	it('글머리표·들여쓰기는 원래 줄을 따른다', () => {
		const text = '  - [▼] Top Picks 포커스';
		const [line] = keyLines(text);
		expect(line === undefined ? '' : replaceKeyLine(text, line, '동작 없음')).toBe('  - [▼] 동작 없음');
	});
});

describe('키 밖의 조건 바꾸기', () => {
	const text = ['1)표시 내용', '- 최대 5개까지 제공', '- 플레이스 홀더 “Search your place.” 제공'].join('\n');

	it('개수 상한을 보인 개수보다 작게 바꾸고, 바꾼 조건 글자는 splitClauses와 같다', () => {
		const m = mutateCount(text, '최대 5개까지 제공', 3);
		expect(m).toMatchObject({ op: 'count-below', after: '최대 2개까지 제공' });
		expect(splitClauses(m?.text ?? '').map((c) => c.text)).toContain(m?.after);
		expect(mutateCount(text, '최대 5개까지 제공', 1)).toBeNull();
	});

	it('정해진 문구를 바꾼다', () => {
		const m = mutateExactText(text, '플레이스 홀더 “Search your place.” 제공', 'Search your place.');
		expect(m?.after).toBe('플레이스 홀더 “Search your place. 틀림” 제공');
		const changed = splitClauses(m?.text ?? '').find((c) => c.text === m?.after);
		expect(changed?.checks.find((c) => c.kind === 'exact-text')?.value).toBe('Search your place. 틀림');
	});
});
