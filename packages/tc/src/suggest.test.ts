import { describe, expect, it } from 'vitest';
import { matchHeaderRow, roleColumns, suggestProfile, suggestSheetProfile } from './suggest';
import { NUMBERED_HEADER, ROW_PER_STEP_HEADER, gridSheet, defined } from './testing';

const rowPerStep = gridSheet('Home', [
	['Home 화면 TC'],
	ROW_PER_STEP_HEADER,
	['scenario_v1.0_3.1', 'Home', 'GNB 이동', '1', '앱 실행 상태', '(1) GNB 영역', '첫 메뉴 포커스', '', 'Major'],
	['', '', '', '2', '', '[▶] 입력', '두 번째 메뉴로 이동', 'P', ''],
	['scenario_v1.0_3.2', 'Home', '배너', '1', '', '(2) Banner 영역', '배너 확대', '', ''],
	['scenario_v1.0_policy_2.', 'Policy', '오류', '1', '', '화면 진입 시', '오류 팝업 표시', '', '']
]);

const numbered = gridSheet('Main', [
	NUMBERED_HEADER,
	['', '앱 실행', '1', '1. 홈에서 실행', '1', '1. 앱 실행\n2. 홈 화면 확인', '1. 홈 화면 표시', '', ''],
	['', '', '', '', '2', '1. Seq 1 수행\n2. [▼] 입력', '1. 다음 행 포커스', '', ''],
	['', '목록', '2', '', '1', '1. 목록 진입', '1. 목록 표시', '', '']
]);

describe('matchHeaderRow', () => {
	it('헤더 단어로 열 역할을 찾는다', () => {
		expect(matchHeaderRow(rowPerStep, 2)).toEqual({
			id: 1,
			category: 2,
			title: 3,
			step: 4,
			precondition: 5,
			action: 6,
			expected: 7,
			result: 8,
			severity: 9
		});
		expect(matchHeaderRow(numbered, 1)).toMatchObject({ id: 1, title: 2, caseNo: 3, step: 5, action: 6, note: 8 });
	});
});

describe('suggestSheetProfile', () => {
	it('행마다 한 단계인 시트: 헤더 행·묶기 기준·화면설계서 ID·콜아웃 참조를 찾는다', () => {
		const p = suggestSheetProfile(rowPerStep);
		expect(p.kind).toBe('test-cases');
		expect(p.include).toBe(true);
		expect(p.headerRow).toBe(2);
		expect(p.columns).toMatchObject({ id: 'A', title: 'C', action: 'F', expected: 'G', result: 'H' });
		expect(p.groupStart).toEqual(['id', 'title']);
		expect(p.stepFormat).toBe('row-per-step');
		expect(p.specIdPattern).not.toBeNull();
		expect(p.targetRefPattern).not.toBeNull();
		expect(p.referencePattern).toBeNull();
		expect(p.confidence).toBe(1);
	});

	it('번호 목록 시트: ID가 비어 있으면 제목으로 묶고, 앞 단계 참조 규칙을 찾는다', () => {
		const p = suggestSheetProfile(numbered);
		expect(p.groupStart).toEqual(['title']);
		expect(p.stepFormat).toBe('numbered-list');
		expect(p.referencePattern).not.toBeNull();
		expect(p.specIdPattern).toBeNull();
		expect(p.evidence.some((e) => e.includes('ID 열은 있지만 비어 있음'))).toBe(true);
	});

	it('헤더가 비어 있는 제목 열을 값의 모양으로 추정한다', () => {
		const header = [...NUMBERED_HEADER];
		header[1] = '';
		const step = (title: string, seq: string): string[] => [
			'',
			title,
			'',
			'',
			seq,
			`1. 조작 ${seq}`,
			'1. 결과',
			'',
			''
		];
		const sheet = gridSheet('Guide', [
			header,
			step('앱 실행', '1'),
			step('', '2'),
			step('', '3'),
			step('목록', '1'),
			step('', '2'),
			step('', '3')
		]);
		const p = suggestSheetProfile(sheet);
		expect(p.columns.title).toBe('B');
		expect(p.groupStart).toEqual(['title']);
		expect(p.include).toBe(true);
	});

	it('숨김 시트는 제외한다', () => {
		const p = suggestSheetProfile({ ...rowPerStep, state: 'hidden' });
		expect(p.include).toBe(false);
		expect(p.evidence[0]).toContain('숨김');
	});

	it('결과(P/F) 열이 없으면 포함하지 않고 사람 확인을 요구한다', () => {
		const sheet = gridSheet('NoResult', [
			['ID', 'Title', 'Action', 'Expected'],
			['T-1', '제목', '조작', '결과']
		]);
		const p = suggestSheetProfile(sheet);
		expect(p.kind).toBe('test-cases');
		expect(p.include).toBe(false);
		expect(p.evidence.some((e) => e.includes('필수 열 없음: result'))).toBe(true);
	});

	it('TC가 아닌 시트의 종류를 구분한다', () => {
		const log = gridSheet('Log', [['context_name', 'message_id', 'description']]);
		const checklist = gridSheet('공통', [['No.', '구분', '점검항목', '비고', 'Result']]);
		const story = gridSheet('Story', [
			['ID', 'Story'],
			['1', 'Given 앱이 실행된 상태']
		]);
		expect(suggestSheetProfile(log).kind).toBe('log-spec');
		expect(suggestSheetProfile(checklist).kind).toBe('checklist');
		expect(suggestSheetProfile(story).kind).toBe('given-when-then');
		expect(suggestSheetProfile(gridSheet('Empty', [])).kind).toBe('unknown');
		for (const s of [log, checklist, story]) expect(suggestSheetProfile(s).include).toBe(false);
	});
});

describe('suggestProfile / roleColumns', () => {
	it('시트마다 제안하고, 열 문자를 번호로 바꾼다', () => {
		const profile = suggestProfile({ sheets: [rowPerStep, numbered] });
		expect(profile.version).toBe(1);
		expect(profile.sheets.map((s) => s.sheet)).toEqual(['Home', 'Main']);
		expect(roleColumns(defined(profile.sheets[0]))).toMatchObject({ id: 1, action: 6, result: 8 });
	});

	it('같은 입력이면 같은 제안', () => {
		expect(suggestProfile({ sheets: [rowPerStep, numbered] })).toEqual(
			suggestProfile({ sheets: [rowPerStep, numbered] })
		);
	});
});
