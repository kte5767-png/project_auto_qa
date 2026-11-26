import { afterEach, describe, expect, it } from 'vitest';
import { OllamaClient } from '../ollama';
import type { FakeChatRequest, FakeOllama } from '../testing';
import { startFakeOllama } from '../testing';
import type { JudgeCase, LlmCase, PlanCase } from './cases';
import { CASE_FORMAT, parseCaseFile } from './cases';
import { compareModels, DEFAULT_COMPARE_OPTIONS, rankModels, summarize } from './compare';
import { messagesFor, PROMPT_VERSION } from './prompts';
import { renderReport } from './report';
import { decisionOf, keySimilarity, scoreCase } from './score';

const judge: JudgeCase = {
	id: 'j1',
	task: 'judge',
	title: '검색창 포커스',
	expected: '검색창에 포커스가 있다',
	observation: { screen: '검색', focus: '검색창', texts: ['Search here'] },
	answer: { verdict: 'pass' }
};
const imageJudge: JudgeCase = { ...judge, id: 'j2', images: ['a.png'], answer: { verdict: 'fail' } };
const plan: PlanCase = {
	id: 'p1',
	task: 'plan',
	step: '추천 키워드 두 번째 항목으로 이동한다',
	screen: {
		name: '검색',
		focus: '① 검색창',
		callouts: [
			{ no: '①', label: '검색창', keys: { down: '② 추천 키워드 첫 항목으로 이동' } },
			{ no: '②', label: '추천 키워드', keys: { right: '다음 키워드로 이동' } }
		]
	},
	answer: { keys: ['DOWN', 'RIGHT'] }
};

let fake: FakeOllama | undefined;
afterEach(async () => {
	await fake?.close();
	fake = undefined;
});

describe('케이스 파일', () => {
	it('형식을 확인하고 문제를 모두 알린다', () => {
		expect(parseCaseFile({ format: CASE_FORMAT, version: 1, cases: [judge, plan] }).cases).toHaveLength(2);
		expect(() => parseCaseFile({ format: 'x', version: 1, cases: [] })).toThrow(/format/);
		expect(() =>
			parseCaseFile({
				format: CASE_FORMAT,
				version: 1,
				cases: [
					{ ...judge, answer: { verdict: 'ok' } },
					{ ...plan, id: 'j1', answer: { keys: ['JUMP'] } },
					{ id: 'x', task: 'draw' }
				]
			})
		).toThrow(
			/cases\[0\]\.answer\.verdict[\s\S]*cases\[1\]\.id 중복: j1[\s\S]*cases\[1\]\.answer\.keys[\s\S]*cases\[2\]\.task/
		);
	});
});

describe('프롬프트', () => {
	it('판정: 기대 결과·관찰·이미지 수, 계획: 현재 포커스·콜아웃 방향키 동작을 넣는다', () => {
		const [sys, user] = messagesFor(imageJudge, ['QUJD']);
		expect(sys?.content).toMatch(/uncertain/);
		expect(sys?.content).toContain('"enum":["pass","fail","uncertain"]');
		expect(user?.content).toBe(
			'기대 결과: 검색창에 포커스가 있다\n관찰:\n- 현재 화면: 검색\n- 포커스: 검색창\n- 보이는 글자: Search here\n- 첨부 이미지 1장: 확인할 영역만 잘라낸 TV 화면'
		);
		expect(user?.images).toEqual(['QUJD']);
		const [, planUser] = messagesFor(plan);
		expect(planUser?.content).toBe(
			'TC 단계: 추천 키워드 두 번째 항목으로 이동한다\n화면: 검색\n현재 포커스: ① 검색창\n콜아웃:\n- ① 검색창 — ▼: ② 추천 키워드 첫 항목으로 이동\n- ② 추천 키워드 — ▶: 다음 키워드로 이동'
		);
		expect(planUser?.images).toBeUndefined();
		expect(PROMPT_VERSION).toMatch(/^p0-8/);
	});
});

describe('채점', () => {
	it('판정: 틀린 pass/fail 단정은 확신 오답, uncertain은 아님', () => {
		const d = (verdict: string) => decisionOf('judge', { verdict, confidence: 0.9, reason: '' });
		expect(scoreCase(judge, d('pass'))).toEqual({ correct: true, partial: 1, confidentWrong: false });
		expect(scoreCase(judge, d('fail'))).toEqual({ correct: false, partial: 0, confidentWrong: true });
		expect(scoreCase(judge, d('uncertain'))).toEqual({ correct: false, partial: 0, confidentWrong: false });
		const unobservable: JudgeCase = { ...judge, answer: { verdict: 'uncertain' } };
		expect(scoreCase(unobservable, d('pass')).confidentWrong).toBe(true);
		expect(decisionOf('judge', { verdict: 'maybe' })).toBeNull();
	});

	it('계획: 키 순서가 같아야 정답, 유사도는 편집 거리로', () => {
		const d = (keys: string[]) => decisionOf('plan', { keys, check: '', confidence: 1, reason: '' });
		expect(scoreCase(plan, d(['DOWN', 'RIGHT']))).toMatchObject({ correct: true, partial: 1 });
		expect(scoreCase(plan, d(['DOWN']))).toMatchObject({ correct: false, partial: 0.5 });
		expect(keySimilarity([], [])).toBe(1);
		expect(keySimilarity(['UP', 'OK'], ['DOWN', 'OK', 'OK'])).toBe(0.333);
		expect(scoreCase(plan, null)).toEqual({ correct: false, partial: 0, confidentWrong: false });
	});
});

/** 가짜 모델: 판정은 항상 pass, 계획은 DOWN RIGHT. broken은 JSON이 아닌 글을 낸다 */
const reply =
	(broken = false) =>
	(r: FakeChatRequest): string => {
		if (broken) return '모르겠어요';
		if (r.format === undefined) return 'OK';
		return r.messages[0]?.content.includes('리모컨')
			? JSON.stringify({ keys: ['DOWN', 'RIGHT'], check: '② 두 번째 항목', confidence: 0.8, reason: '▼ 후 ▶' })
			: JSON.stringify({ verdict: 'pass', confidence: 0.9, reason: '검색창에 포커스' });
	};

describe('compareModels', () => {
	it('모델을 하나씩 올려 케이스를 반복 실행하고, 끝나면 내린다', async () => {
		fake = await startFakeOllama([
			{ name: 'vision:4b', capabilities: ['completion', 'vision', 'thinking'], reply: reply() },
			{ name: 'text:2b', capabilities: ['completion'], reply: reply(true) }
		]);
		const client = new OllamaClient({ host: fake.url });
		const cases = [
			{ case: judge, images: [] },
			{ case: imageJudge, images: ['QUJD'] },
			{ case: plan, images: [] }
		];
		const events: string[] = [];
		const result = await compareModels(
			client,
			['vision:4b', 'text:2b', 'none:1b'],
			cases,
			DEFAULT_COMPARE_OPTIONS,
			(e) => events.push(`${e.model} ${e.done}/${e.total}${e.note === undefined ? '' : ` ${e.note}`}`)
		);
		expect(result.runs.map((r) => [r.model, r.status, r.calls.length, r.skipped.length])).toEqual([
			['vision:4b', 'ok', 6, 0],
			['text:2b', 'ok', 4, 1],
			['none:1b', 'missing', 0, 0]
		]);
		expect(result.runs[2]?.reason).toBe('설치되지 않음 — ollama pull none:1b');
		expect(events).toContain('vision:4b 6/6');
		expect(events).toContain('none:1b 0/0 설치되지 않음 — ollama pull none:1b');

		// 생각 모드는 지원하는 모델에만 false로 보낸다
		const chats = fake.requests.filter((r) => r.path === '/api/chat').map((r) => r.body as Record<string, unknown>);
		expect(chats.filter((b) => b['model'] === 'vision:4b').every((b) => b['think'] === false)).toBe(true);
		expect(chats.filter((b) => b['model'] === 'text:2b').every((b) => !('think' in b))).toBe(true);
		// 이미지 케이스는 이미지 지원 모델에만
		expect(chats.filter((b) => JSON.stringify(b).includes('QUJD')).map((b) => b['model'])).toEqual([
			'vision:4b',
			'vision:4b'
		]);
		expect(fake.loaded.size).toBe(0);

		const [good, broken] = result.runs.map(summarize);
		expect(good).toMatchObject({
			calls: 6,
			validRate: 1,
			judge: { calls: 4, accuracy: 0.5, imageCalls: 2, imageAccuracy: 0, confidentWrong: 2, uncertain: 0 },
			plan: { calls: 2, exactRate: 1, meanSimilarity: 1 },
			consistency: 1,
			loadMs: 500,
			memory: { sizeBytes: 1e9, vramBytes: 0 }
		});
		expect(broken).toMatchObject({
			calls: 4,
			validRate: 0,
			judge: { accuracy: 0 },
			plan: { exactRate: 0 },
			// 모두 무효인 반복은 "일치"로 세지 않는다
			consistency: null,
			skipped: 1
		});
		// JSON을 못 내는 모델은 확신 오답이 없어도 뒤로 간다
		expect(rankModels([broken, good] as NonNullable<typeof good>[]).map((s) => s.model)).toEqual([
			'vision:4b',
			'text:2b'
		]);

		const report = renderReport(result, [judge, imageJudge, plan] as LlmCase[], {
			startedAt: 'a',
			finishedAt: 'b',
			caseFiles: ['sample.json']
		});
		expect(report).toContain('| 1 | vision:4b | 100% | 50% | 0% | 2 | 100% | 1 | 100% |');
		expect(report).toContain('| j2 검색창 포커스 | fail | ✗ pass / ✗ pass | 건너뜀 |');
		expect(report).toContain('- none:1b: 설치되지 않음 — ollama pull none:1b');
		expect(report).toContain('- j2: pass — 검색창에 포커스');
	});
});
