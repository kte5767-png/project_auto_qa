import type { JsonSchema } from '../schema';
import type { LlmMessage } from '../types';
import type { JudgeCase, LlmCase, PlanCase, TargetCase } from './cases';
import { FINISH_KEYS, PLAN_KEYS, VERDICTS } from './cases';

/** 프롬프트를 바꾸면 올린다 (결과에 함께 기록해 비교 가능하게). v2: 목표 고르기 추가 (D-036) */
export const PROMPT_VERSION = 'p0-8-v2';

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

/** 목표 고르기: 콜아웃은 그 화면에 있는 번호 중에서만 고르게 한다 (없는 요소를 지어내지 못하게) */
export function targetSchema(c: TargetCase): JsonSchema {
	return {
		type: 'object',
		properties: {
			callout: { type: 'string', enum: c.screen.callouts.map((x) => x.no) },
			item: { type: 'integer', minimum: 1, maximum: 50 },
			finish: { type: 'string', enum: FINISH_KEYS },
			confidence: { type: 'number', minimum: 0, maximum: 1 },
			reason: { type: 'string', maxLength: 300 }
		},
		required: ['callout', 'item', 'finish', 'confidence', 'reason'],
		additionalProperties: false
	};
}

export const schemaFor = (c: LlmCase): JsonSchema =>
	c.task === 'judge' ? JUDGE_SCHEMA : c.task === 'plan' ? PLAN_SCHEMA : targetSchema(c);

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

const TARGET_SYSTEM = `너는 TV 앱 QA 검수 보조다. TC 단계 문장이 가리키는 목표를 화면의 콜아웃 목록에서 고른다.
규칙:
- callout: 목표가 있는 콜아웃 번호. 목록에 있는 번호만 고른다.
- item: 그 콜아웃이 목록이면 몇 번째 항목인지(1부터). 목록이 아니거나 순번이 없으면 1.
- finish: 목표에 도착한 뒤 누를 키. 선택·실행·진입이면 OK, 이전 화면으로 돌아가기면 BACK, 이동만이면 NONE.
- 이전 화면으로 돌아가기처럼 이동이 없으면 callout은 현재 포커스가 있는 콜아웃이다.
- 키 순서는 만들지 않는다(경로는 코드가 계산한다).
- confidence는 0~1 사이 숫자, reason은 한국어 한 문장이다.
- 아래 JSON 스키마에 맞는 JSON 하나만 출력한다.`;

function targetUser(c: TargetCase): string {
	const lines = [`TC 단계: ${c.step}`, `화면: ${c.screen.name}`, `현재 포커스: ${c.screen.focus}`, '콜아웃:'];
	for (const co of c.screen.callouts) {
		const items = co.items === undefined || co.items.length === 0 ? '' : ` — 항목: ${co.items.join(', ')}`;
		lines.push(`- ${co.no} ${co.label}${items}${co.note === undefined ? '' : ` (${co.note})`}`);
	}
	return lines.join('\n');
}

const KEY_LABELS: Record<string, string> = { up: '▲', down: '▼', left: '◀', right: '▶', ok: 'OK', back: 'Back' };

function judgeUser(c: JudgeCase, imageCount: number): string {
	const o = c.observation;
	const lines = [`기대 결과: ${c.expected}`, '관찰:'];
	if (o.screen !== undefined) lines.push(`- 현재 화면: ${o.screen}`);
	if (o.focus !== undefined) lines.push(`- 포커스: ${o.focus}`);
	if (o.texts !== undefined) lines.push(`- 보이는 글자: ${o.texts.length === 0 ? '(없음)' : o.texts.join(' | ')}`);
	if (o.note !== undefined) lines.push(`- 메모: ${o.note}`);
	if (imageCount > 0) lines.push(`- 첨부 이미지 ${imageCount}장: ${o.images ?? '확인할 영역만 잘라낸 TV 화면'}`);
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
	const schema = JSON.stringify(schemaFor(c));
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
	if (c.task === 'target') {
		return [
			{ role: 'system', content: `${TARGET_SYSTEM}\n${schema}` },
			{ role: 'user', content: targetUser(c) }
		];
	}
	return [
		{ role: 'system', content: `${PLAN_SYSTEM}\n${schema}` },
		{ role: 'user', content: planUser(c) }
	];
}
