import type { JsonSchema } from '../schema';
import type { LlmMessage } from '../types';
import type { JudgeCase, LlmCase, PlanCase, Task } from './cases';
import { PLAN_KEYS, VERDICTS } from './cases';

/** 프롬프트를 바꾸면 올린다 (결과에 함께 기록해 비교 가능하게) */
export const PROMPT_VERSION = 'p0-8-v1';

export const JUDGE_SCHEMA: JsonSchema = {
	type: 'object',
	properties: {
		verdict: { type: 'string', enum: VERDICTS },
		confidence: { type: 'number', minimum: 0, maximum: 1 },
		reason: { type: 'string', maxLength: 500 }
	},
	required: ['verdict', 'confidence', 'reason'],
	additionalProperties: false
};

export const PLAN_SCHEMA: JsonSchema = {
	type: 'object',
	properties: {
		keys: { type: 'array', items: { type: 'string', enum: PLAN_KEYS }, maxItems: 20 },
		check: { type: 'string', maxLength: 500 },
		confidence: { type: 'number', minimum: 0, maximum: 1 },
		reason: { type: 'string', maxLength: 500 }
	},
	required: ['keys', 'check', 'confidence', 'reason'],
	additionalProperties: false
};

export const schemaFor = (task: Task): JsonSchema => (task === 'judge' ? JUDGE_SCHEMA : PLAN_SCHEMA);

const JUDGE_SYSTEM = `너는 TV 앱 QA 검수 보조다. TC의 기대 결과와 TV 화면에서 관찰한 내용을 비교해 판정한다.
규칙:
- 관찰 내용(포커스, 보이는 글자, 첨부 이미지)에 근거가 있을 때만 pass 또는 fail로 판정한다.
- 관찰 내용으로 확인할 수 없는 기대 결과(소리, 애니메이션, 시간 경과, 관찰에 없는 화면 등)는 uncertain으로 판정한다.
- 근거가 부족하거나 애매하면 uncertain으로 판정한다. 추측하지 않는다.
- confidence는 0~1 사이 숫자다.
- reason에는 판정 근거를 한국어 한두 문장으로 쓴다.
- 아래 JSON 스키마에 맞는 JSON 하나만 출력한다.`;

const PLAN_SYSTEM = `너는 TV 리모컨 조작 계획 보조다. 화면설계서의 콜아웃(번호, 이름, 방향키 동작)과 현재 포커스를 보고, TC 단계를 수행하는 리모컨 키 순서를 만든다.
규칙:
- 키는 ${PLAN_KEYS.join(', ')} 중에서만 고른다.
- 콜아웃의 방향키 동작 설명에 근거해 가장 짧은 키 순서를 만든다. 현재 포커스에서 시작한다.
- 근거가 없으면 keys를 비우고 confidence를 낮게 한다.
- check에는 키를 누른 뒤 확인할 조건(어느 요소에 포커스가 있어야 하는지 등)을 쓴다.
- confidence는 0~1 사이 숫자, reason은 한국어 한두 문장이다.
- 아래 JSON 스키마에 맞는 JSON 하나만 출력한다.`;

const KEY_LABELS: Record<string, string> = { up: '▲', down: '▼', left: '◀', right: '▶', ok: 'OK', back: 'Back' };

function judgeUser(c: JudgeCase, imageCount: number): string {
	const o = c.observation;
	const lines = [`기대 결과: ${c.expected}`, '관찰:'];
	if (o.screen !== undefined) lines.push(`- 현재 화면: ${o.screen}`);
	if (o.focus !== undefined) lines.push(`- 포커스: ${o.focus}`);
	if (o.texts !== undefined) lines.push(`- 보이는 글자: ${o.texts.length === 0 ? '(없음)' : o.texts.join(' | ')}`);
	if (o.note !== undefined) lines.push(`- 메모: ${o.note}`);
	if (imageCount > 0) lines.push(`- 첨부 이미지 ${imageCount}장: 확인할 영역만 잘라낸 TV 화면`);
	return lines.join('\n');
}

function planUser(c: PlanCase): string {
	const lines = [`TC 단계: ${c.step}`, `화면: ${c.screen.name}`, `현재 포커스: ${c.screen.focus}`, '콜아웃:'];
	for (const co of c.screen.callouts) {
		const keys = Object.entries(co.keys ?? {})
			.map(([k, v]) => `${KEY_LABELS[k] ?? k}: ${v}`)
			.join(', ');
		lines.push(
			`- ${co.no} ${co.label}${keys === '' ? '' : ` — ${keys}`}${co.note === undefined ? '' : ` (${co.note})`}`
		);
	}
	return lines.join('\n');
}

/** 케이스 → 대화. 스키마 글자도 함께 넣는다 (Ollama 권장: 형식 강제 + 프롬프트 안내) */
export function messagesFor(c: LlmCase, images: readonly string[] = []): LlmMessage[] {
	const schema = JSON.stringify(schemaFor(c.task));
	if (c.task === 'judge') {
		return [
			{ role: 'system', content: `${JUDGE_SYSTEM}\n${schema}` },
			{
				role: 'user',
				content: judgeUser(c, images.length),
				...(images.length > 0 ? { images: [...images] } : {})
			}
		];
	}
	return [
		{ role: 'system', content: `${PLAN_SYSTEM}\n${schema}` },
		{ role: 'user', content: planUser(c) }
	];
}
