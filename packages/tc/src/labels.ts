import type { AutomationLabel } from './types';

/**
 * 자동화 가능성 1차 분류 규칙 (D-022, Q13). 규칙은 데이터로 두고 위에서부터 처음 맞는 규칙을 쓴다.
 * 1차 분류는 키워드 기반이며, 프로젝트마다 사람이 확인·수정한다 (AI 보조 분류는 Phase 1).
 */

export interface AutomationContext {
	sheet: string;
	caseTitle: string | null;
	precondition: string | null;
	action: string | null;
	expected: string | null;
	note: string | null;
}

export interface AutomationRule {
	id: string;
	label: AutomationLabel;
	reason: string;
	/** 검사할 칸 */
	fields: (keyof AutomationContext)[];
	pattern: RegExp;
}

export const DEFAULT_AUTOMATION_RULES: AutomationRule[] = [
	{
		id: 'audio-guidance',
		label: 'deferred',
		reason: '음성 안내 검수는 후순위 (D-015)',
		// 기대 결과에만 "발화"가 섞인 단계는 화면 항목이 남아 있으므로 자동으로 둔다
		fields: ['sheet', 'caseTitle', 'precondition', 'action'],
		// "Audio Guidance off인 경우"는 음성 안내를 끈 화면 검수라 제외
		pattern: /audio ?guidance(?!\s*[<(]?\s*off)|음성 ?안내(?!\s*[<(]?\s*(off|끔))|\bTTS\b|발화/i
	},
	{
		id: 'voice',
		label: 'deferred',
		reason: '보이스(VUI) 진입은 나중에 구현 (Q13)',
		fields: ['sheet', 'caseTitle', 'precondition', 'action'],
		pattern: /\bVUI\b|보이스|음성 ?검색|voice/i
	},
	{
		id: 'touch',
		label: 'deferred',
		reason: '터치 입력은 나중에 구현 (Q13)',
		fields: ['sheet', 'caseTitle', 'precondition', 'action'],
		pattern: /터치|touch/i
	},
	{
		id: 'pointer',
		label: 'deferred',
		reason: '매직 리모컨 포인터는 나중에 구현 (Q13)',
		fields: ['sheet', 'caseTitle', 'precondition', 'action'],
		// "마우스, 4방향키 등 동작이 없을 경우"(무입력 대기)는 리모컨으로 재현 가능하므로 마우스 단독은 제외
		pattern: /매직 ?(리모컨|마우스)|magic ?remote|포인터|pointer|마우스 ?(포커스|커서|오버|클릭|이동|휠|스크롤)/i
	},
	{
		id: 'system-entry',
		label: 'deferred',
		reason: '런처·Qcard 등 시스템 진입은 나중에 구현 (Q13)',
		fields: ['precondition', 'action'],
		pattern: /q ?card|큐카드|런처|launcher/i
	},
	{
		id: 'admin',
		label: 'manual',
		reason: '관리자(admin) 설정이 필요한 조건',
		fields: ['precondition', 'action', 'note'],
		pattern: /admin|어드민|관리자 ?(페이지|설정)|\bCMS\b/i
	},
	{
		id: 'network',
		label: 'manual',
		reason: '네트워크 연결·해제 등 외부 환경 조작이 필요',
		fields: ['precondition', 'action'],
		pattern: /네트워크|network|인터넷 ?(연결|끊)|wi-?fi|랜 ?선|LAN ?선/i
	}
];

export function classifyStep(
	context: AutomationContext,
	rules: readonly AutomationRule[] = DEFAULT_AUTOMATION_RULES
): { label: AutomationLabel; rule: string; reason: string } {
	for (const rule of rules) {
		if (rule.fields.some((field) => rule.pattern.test(context[field] ?? ''))) {
			return { label: rule.label, rule: rule.id, reason: rule.reason };
		}
	}
	return { label: 'auto', rule: 'default', reason: '리모컨·화면으로 확인 가능 (1차 분류)' };
}
