import { describe, expect, it } from 'vitest';
import { LogBuffer, markStopped, pickRunId, runIdAt, sseFrame } from './stream';

describe('sseFrame', () => {
	it('이벤트 이름과 JSON 한 줄, 빈 줄로 끝난다', () => {
		expect(sseFrame('log', { lines: ['a\nb'] })).toBe('event: log\ndata: {"lines":["a\\nb"]}\n\n');
	});
});

describe('LogBuffer', () => {
	it('줄 중간에서 끊긴 조각은 줄이 끝날 때 한 줄로 만든다', () => {
		const log = new LogBuffer(10);
		expect(log.push('  Search!9 4.1 ')).toEqual([]);
		expect(log.push('① 검색어\r\n    = 통과')).toEqual(['  Search!9 4.1 ① 검색어']);
		expect(log.push(' — 일치\n\n')).toEqual(['    = 통과 — 일치']);
		expect(log.seq).toBe(2);
	});

	it('최근 max줄만 두고 seq는 계속 센다', () => {
		const log = new LogBuffer(2);
		log.push('1\n2\n3\n');
		expect(log.lines).toEqual(['2', '3']);
		expect(log.seq).toBe(3);
	});

	it('끝날 때 남은 반쪽 줄을 넣는다', () => {
		const log = new LogBuffer(5);
		log.push('오류: TC 파일이 열려 있음');
		expect(log.end()).toEqual(['오류: TC 파일이 열려 있음']);
		expect(log.end()).toEqual([]);
	});
});

describe('pickRunId', () => {
	const names = ['tc-2026-11-27T01-45-26', 'web-settings.json', 'tc-2026-11-26T09-00-00'];

	it('이 서버가 띄운 검수가 실행 중이면 그것', () => {
		expect(pickRunId({ runId: 'tc-2026-11-27T02-00-00', running: true }, names)).toBe('tc-2026-11-27T02-00-00');
	});

	it('아니면 가장 최근 실행 폴더 (명령줄 실행 포함)', () => {
		expect(pickRunId({ runId: 'tc-2026-11-26T09-00-00', running: false }, names)).toBe('tc-2026-11-27T01-45-26');
		expect(pickRunId(null, names)).toBe('tc-2026-11-27T01-45-26');
		expect(pickRunId(null, ['web-settings.json'])).toBeNull();
	});
});

describe('runIdAt', () => {
	it('tc-시각 (파일 이름에 쓸 수 있는 글자만)', () => {
		expect(runIdAt(new Date('2026-11-27T02:31:21.123Z'))).toBe('tc-2026-11-27T02-31-21');
	});
});

describe('markStopped', () => {
	it('단계 도중에 끝났으면 끝난 상태로 고친다', () => {
		const fixed = markStopped({ stage: 'running', current: 'Search!9', phase: '앱 여는 중', steps: [1] }, 1);
		expect(fixed).toMatchObject({
			stage: 'done',
			finished: true,
			stopped: true,
			exitCode: 1,
			current: null,
			phase: null,
			steps: [1]
		});
	});

	it('이미 끝났으면 고치지 않는다 (이전 형식 finished 포함)', () => {
		expect(markStopped({ stage: 'done', finished: true }, 0)).toBeNull();
		expect(markStopped({ finished: true }, 1)).toBeNull();
	});
});
