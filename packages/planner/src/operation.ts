import type { SpecKey } from '@auto-qa/spec';

/**
 * TC 조작 문장 → 누를 키 순서와 기대 결과. "상단방향키 포커스 후 확인 버튼 선택 시 팝업 닫힘" → [▲, OK] → 닫힘.
 * "이동 중 사용자 입력이 발생하더라도 스크롤 이동은 중단되지 않음" → 앞 조작(OK) 중에 끼어드는 입력 → 끝까지 감.
 * 규칙 기반·결정적이며, 낱말 목록은 옵션(프로필로 옮길 값). 키 낱말이 없거나 결과를 모르면 null (추측하지 않음)
 */

export type OperationResult =
	/** 지금 화면(팝업 등)이 닫힌다 */
	| 'closed'
	/** 앞 조작(이동·스크롤)이 끼어든 입력에도 끝까지 간다 */
	| 'uninterrupted';

export interface OperationPlan {
	/** 누를 키 (문장에 나온 순서). uninterrupted는 빈 배열 — 끼어드는 입력은 실행기가 고른다 */
	keys: SpecKey[];
	result: OperationResult;
	/** 계획을 정한 근거 (설명용) */
	reason: string;
}

export interface OperationOptions {
	/** 키 낱말 (정규식 원문). 문장에서 나온 위치 순서로 키를 모은다 */
	keyWords: Record<SpecKey, string[]>;
	/** 닫힘 결과 낱말 */
	closeWords: string[];
	/** "~하더라도 … 중단되지 않음": 끼어드는 입력 낱말과 결과 낱말 */
	interruptWords: string[];
	uninterruptedWords: string[];
}

export const DEFAULT_OPERATION_OPTIONS: OperationOptions = {
	keyWords: {
		up: ['상단\\s*방향\\s*키', '위\\s*방향\\s*키', '위쪽\\s*방향\\s*키', '\\[\\s*▲\\s*\\]'],
		down: ['하단\\s*방향\\s*키', '아래\\s*방향\\s*키', '아래쪽\\s*방향\\s*키', '\\[\\s*▼\\s*\\]'],
		left: ['좌측\\s*방향\\s*키', '왼쪽\\s*방향\\s*키', '\\[\\s*[◀◄]\\s*\\]'],
		right: ['우측\\s*방향\\s*키', '오른쪽\\s*방향\\s*키', '\\[\\s*[▶►]\\s*\\]'],
		ok: ['확인\\s*(?:버튼|키)', 'OK\\s*(?:버튼|키)', '\\[\\s*OK\\s*\\]'],
		back: ['Back\\s*(?:버튼|키)', '뒤로\\s*(?:가기)?\\s*(?:버튼|키)', '\\[\\s*Back\\s*\\]']
	},
	closeWords: ['닫힘', '닫힌다', '닫혀', '닫기'],
	interruptWords: ['입력이 발생하더라도', '입력이 있더라도', '입력하더라도', '입력 시에도'],
	uninterruptedWords: ['중단되지 않', '멈추지 않', '취소되지 않']
};

/** 조작 문장 하나의 키 순서와 결과. 정하지 못하면 null */
export function parseOperation(
	text: string,
	options: OperationOptions = DEFAULT_OPERATION_OPTIONS
): OperationPlan | null {
	const t = text.replace(/\s+/g, ' ').trim();
	if (
		options.interruptWords.some((w) => t.includes(w)) &&
		options.uninterruptedWords.some((w) => t.includes(w))
	) {
		return { keys: [], result: 'uninterrupted', reason: '앞 조작 중 끼어드는 입력에도 끝까지 감' };
	}
	if (!options.closeWords.some((w) => t.includes(w))) return null;
	const found: { at: number; key: SpecKey }[] = [];
	for (const [key, words] of Object.entries(options.keyWords) as [SpecKey, string[]][]) {
		for (const w of words) {
			for (const m of t.matchAll(new RegExp(w, 'gi'))) found.push({ at: m.index, key });
		}
	}
	if (found.length === 0) return null;
	found.sort((a, b) => a.at - b.at);
	const keys = found.map((f) => f.key).filter((k, i, all) => i === 0 || all[i - 1] !== k);
	return { keys, result: 'closed', reason: `키 ${keys.join(' → ')} 뒤 닫힘` };
}
