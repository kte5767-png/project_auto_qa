/**
 * 모델 비교용 케이스 (P0-8). D-036 이후 AI가 맡는 일에 맞춘다:
 *  - judge: TC 기대 결과 + TV에서 관찰한 내용(잘라낸 화면 등) → pass / fail / uncertain (시각·서술형만)
 *  - target: TC 단계 + 화면 콜아웃 + 현재 포커스 → 목표(콜아웃·몇 번째 항목·마지막 키). 키 순서는 코드가 계산한다
 *  - plan: (이전 방식, D-036 전) TC 단계 → 리모컨 키 순서. 예전 케이스 파일을 읽기 위해 남긴다
 * 회사 TC로 만든 케이스는 *.local.json 으로 두고 커밋하지 않는다.
 */

export const CASE_FORMAT = 'auto-qa-llm-cases';
export const CASE_VERSION = 1;

export const PLAN_KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'BACK', 'HOME'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const VERDICTS = ['pass', 'fail', 'uncertain'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const FINISH_KEYS = ['OK', 'BACK', 'NONE'] as const;
export type FinishKey = (typeof FINISH_KEYS)[number];
export type Task = 'judge' | 'plan' | 'target';

/** 화면설계서 콜아웃의 방향키 동작 (D-031의 keys와 같은 이름) */
export type CalloutKeys = Partial<Record<'up' | 'down' | 'left' | 'right' | 'ok' | 'back', string>>;

export interface JudgeCase {
	id: string;
	task: 'judge';
	title?: string;
	/** TC 기대 결과 */
	expected: string;
	observation: {
		screen?: string;
		focus?: string;
		texts?: string[];
		note?: string;
		/** 첨부 이미지 설명 (없으면 "확인할 영역만 잘라낸 TV 화면") */
		images?: string;
	};
	/** 확인 영역만 잘라낸 화면 (케이스 파일 기준 상대 경로) */
	images?: string[];
	answer: { verdict: Verdict };
}

export interface PlanCase {
	id: string;
	task: 'plan';
	title?: string;
	/** TC 단계 (조작 문장) */
	step: string;
	screen: {
		name: string;
		/** 현재 포커스 (콜아웃 번호나 이름) */
		focus: string;
		callouts: { no: string; label: string; keys?: CalloutKeys; note?: string }[];
	};
	answer: { keys: PlanKey[] };
}

/** 목표 고르기 (D-036 ①): AI는 목표만 고르고, 경로는 `@auto-qa/planner`가 계산한다 */
export interface TargetCase {
	id: string;
	task: 'target';
	title?: string;
	/** TC 단계 (조작 문장) */
	step: string;
	screen: {
		name: string;
		/** 현재 포커스 (콜아웃 번호나 이름) */
		focus: string;
		/** 콜아웃 번호·이름과, 목록이면 보이는 항목 이름 */
		callouts: { no: string; label: string; items?: string[]; note?: string }[];
	};
	/** item은 목록 안 순번(1부터), finish는 도착해서 누를 키 (없으면 NONE) */
	answer: { callout: string; item: number; finish: FinishKey };
}

export type LlmCase = JudgeCase | PlanCase | TargetCase;

export interface CaseFile {
	format: typeof CASE_FORMAT;
	version: typeof CASE_VERSION;
	name?: string;
	cases: LlmCase[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** 케이스 파일 확인. 문제가 있으면 모두 모아 예외로 알린다 */
export function parseCaseFile(data: unknown): CaseFile {
	const problems: string[] = [];
	if (!isObj(data) || data['format'] !== CASE_FORMAT)
		throw new Error(`케이스 파일 형식이 아님 (format: "${CASE_FORMAT}" 필요)`);
	if (data['version'] !== CASE_VERSION) throw new Error(`지원하지 않는 케이스 파일 버전: ${String(data['version'])}`);
	const raw = Array.isArray(data['cases']) ? data['cases'] : [];
	if (raw.length === 0) problems.push('cases가 비어 있음');
	const ids = new Set<string>();
	raw.forEach((c, i) => {
		const at = `cases[${i}]`;
		if (!isObj(c)) return problems.push(`${at}: 객체가 아님`);
		const id = c['id'];
		if (!isStr(id)) problems.push(`${at}.id 없음`);
		else if (ids.has(id)) problems.push(`${at}.id 중복: ${id}`);
		else ids.add(id);
		const answer = isObj(c['answer']) ? c['answer'] : {};
		if (c['task'] === 'judge') {
			if (!isStr(c['expected'])) problems.push(`${at}.expected 없음`);
			if (!isObj(c['observation'])) problems.push(`${at}.observation 없음`);
			else if (c['observation']['texts'] !== undefined && !strList(c['observation']['texts']))
				problems.push(`${at}.observation.texts는 글자 목록이어야 함`);
			if (c['images'] !== undefined && !strList(c['images'])) problems.push(`${at}.images는 경로 목록이어야 함`);
			if (!VERDICTS.includes(answer['verdict'] as Verdict))
				problems.push(`${at}.answer.verdict는 ${VERDICTS.join(' | ')} 중 하나`);
		} else if (c['task'] === 'plan') {
			if (!isStr(c['step'])) problems.push(`${at}.step 없음`);
			const screen = c['screen'];
			if (
				!isObj(screen) ||
				!isStr(screen['name']) ||
				!isStr(screen['focus']) ||
				!Array.isArray(screen['callouts'])
			)
				problems.push(`${at}.screen(name, focus, callouts) 없음`);
			const keys = answer['keys'];
			if (!Array.isArray(keys) || !keys.every((k) => PLAN_KEYS.includes(k as PlanKey)))
				problems.push(`${at}.answer.keys는 ${PLAN_KEYS.join(', ')} 목록`);
		} else if (c['task'] === 'target') {
			if (!isStr(c['step'])) problems.push(`${at}.step 없음`);
			const screen = c['screen'];
			const callouts = isObj(screen) && Array.isArray(screen['callouts']) ? screen['callouts'] : null;
			if (!isObj(screen) || !isStr(screen['name']) || !isStr(screen['focus']) || callouts === null)
				problems.push(`${at}.screen(name, focus, callouts) 없음`);
			const nos = (callouts ?? []).map((x) => (isObj(x) ? x['no'] : undefined));
			if (!nos.includes(answer['callout'])) problems.push(`${at}.answer.callout은 screen.callouts의 no 중 하나`);
			if (typeof answer['item'] !== 'number' || !Number.isInteger(answer['item']) || answer['item'] < 1)
				problems.push(`${at}.answer.item은 1 이상의 정수`);
			if (!FINISH_KEYS.includes(answer['finish'] as FinishKey))
				problems.push(`${at}.answer.finish는 ${FINISH_KEYS.join(' | ')} 중 하나`);
		} else {
			problems.push(`${at}.task는 judge, target, plan 중 하나`);
		}
	});
	if (problems.length > 0) throw new Error(`케이스 파일 오류:\n- ${problems.join('\n- ')}`);
	return data as unknown as CaseFile;
}
