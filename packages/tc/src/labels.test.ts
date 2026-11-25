import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOMATION_RULES, classifyStep } from './labels';
import type { AutomationContext, AutomationRule } from './labels';

const base: AutomationContext = {
	sheet: 'Home',
	caseTitle: '메뉴 이동',
	precondition: null,
	action: '[▶] 입력',
	expected: '다음 메뉴로 포커스 이동',
	note: null
};

const label = (patch: Partial<AutomationContext>): string => {
	const r = classifyStep({ ...base, ...patch });
	return `${r.label}:${r.rule}`;
};

describe('classifyStep', () => {
	it('해당 규칙이 없으면 자동', () => {
		expect(label({})).toBe('auto:default');
	});

	it('음성 안내 ON 조건이나 음성 안내 시트는 보류', () => {
		expect(label({ precondition: 'Audio Guidance <ON> 상태' })).toBe('deferred:audio-guidance');
		expect(label({ sheet: 'AudioGuidance' })).toBe('deferred:audio-guidance');
		expect(label({ precondition: '음성 안내 켬' })).toBe('deferred:audio-guidance');
	});

	it('음성 안내를 끈 조건이나 기대 결과에만 "발화"가 섞인 단계는 자동', () => {
		expect(label({ action: '자동 숨김 정책 (Audio Guidance off 인 경우)' })).toBe('auto:default');
		expect(label({ precondition: '음성 안내 off' })).toBe('auto:default');
		expect(label({ expected: '버튼 표시\n*포커스 시 발화' })).toBe('auto:default');
	});

	it('보이스·터치·포인터·시스템 진입은 보류 (Q13)', () => {
		expect(label({ precondition: '보이스 검색 (VUI)를 통한 앱 실행' })).toBe('deferred:voice');
		expect(label({ sheet: 'Touch Mode' })).toBe('deferred:touch');
		expect(label({ action: '끝으로 마우스 포커스 이동 시' })).toBe('deferred:pointer');
		expect(label({ caseTitle: 'Focus - 5-way 및 포인터 전환' })).toBe('deferred:pointer');
		expect(label({ precondition: 'Qcard 앱 리스트에서 실행' })).toBe('deferred:system-entry');
		expect(label({ precondition: '런처에서 실행' })).toBe('deferred:system-entry');
	});

	it('"마우스, 방향키 등 입력이 없을 경우"는 리모컨으로 재현 가능하므로 자동', () => {
		expect(label({ action: '마우스, 4방향키 등 동작이 1분 동안 없을 경우' })).toBe('auto:default');
	});

	it('관리자 설정·네트워크 조작은 수동', () => {
		expect(label({ precondition: 'admin에서 설정한 공지가 있는 경우' })).toBe('manual:admin');
		expect(label({ precondition: '어드민에서 설정한 배너' })).toBe('manual:admin');
		expect(label({ action: '스플래시 도중 네트워크 연결이 응답 없을 경우' })).toBe('manual:network');
	});

	it('앞의 규칙이 먼저 적용된다', () => {
		expect(label({ sheet: 'AudioGuidance', precondition: 'admin 설정' })).toBe('deferred:audio-guidance');
	});

	it('프로젝트별 규칙으로 바꿀 수 있다', () => {
		const rules: AutomationRule[] = [
			{ id: 'payment', label: 'out-of-scope', reason: '결제', fields: ['action'], pattern: /결제/ },
			...DEFAULT_AUTOMATION_RULES
		];
		expect(classifyStep({ ...base, action: '결제 버튼 선택' }, rules)).toMatchObject({
			label: 'out-of-scope',
			rule: 'payment'
		});
	});
});
