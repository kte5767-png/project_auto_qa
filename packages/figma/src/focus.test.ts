import { describe, expect, it } from 'vitest';
import { analyzeFrame } from './analyze';
import { DEFAULT_ANALYZE_OPTIONS } from './analyze';
import { elementById } from './normalize';
import type { ExportedNode } from './exportFormat';
import { sampleHomeFrame, sampleSearchFrame } from './testing';

const nameOf = (a: ReturnType<typeof analyzeFrame>, id: string | null | undefined) =>
	id == null ? null : (elementById(a.frame, id)?.name ?? '?');

describe('포커스 근거 ① 컴포넌트 변형 상태 (D-033)', () => {
	const a = analyzeFrame(sampleSearchFrame([0]));
	const p = a.focus.primary;

	it('status=focused 변형을 포커스로 보고, 같은 세트의 보통 상태와 비교해 기대 스타일을 뽑는다', () => {
		expect(p?.source).toBe('variant');
		expect(nameOf(a, p?.memberId)).toBe('btn_keyword');
		expect(elementById(a.frame, p?.memberId ?? '')?.rect.x).toBe(118);
		expect(p?.score).toBe(0.9);
		// 보통 상태 비교 대상은 바로 옆 탭 (status=default)
		expect(elementById(a.frame, p?.typicalId ?? '')?.rect.x).toBe(312);
		expect(p?.style.fill?.hex).toBe('#E6E6E6');
		expect(p?.evidence[0]).toBe('컴포넌트 변형 "btn_keyword: Type=category, status=focused"');
		expect(a.focus.ambiguous).toBe(false);
	});

	it('안쪽의 포커스 아이콘(icn_selected_focused)은 따로 후보가 되지 않고, "unfocused"는 포커스가 아니다', () => {
		const variants = a.focus.candidates.filter((c) => c.source === 'variant');
		expect(variants).toHaveLength(1);
	});

	it('포커스 변형이 둘이면 확인 필요', () => {
		const two = analyzeFrame(sampleSearchFrame([0, 2]));
		expect(two.focus.candidates.filter((c) => c.source === 'variant')).toHaveLength(2);
		expect(two.focus.ambiguous).toBe(true);
	});

	it('변형 근거와 다른 곳에 뚜렷한 형제 차이가 있으면 근거가 엇갈린 것으로 보고 확인 필요', () => {
		// 홈: Top 10 첫 카드가 확대·테두리로 포커스인데, 프로모 버튼도 Focused 변형인 화면
		const exported = sampleHomeFrame();
		const visit = (n: ExportedNode): void => {
			if (n.name === 'Btn_main(New)' && n.component !== null)
				n.component = { ...n.component, name: 'State=Focused' };
			n.children.forEach(visit);
		};
		visit(exported.node);
		const home = analyzeFrame(exported);
		expect(home.focus.primary?.source).toBe('variant');
		expect(home.focus.candidates.some((c) => c.source === 'siblings' && c.score >= 0.6)).toBe(true);
		expect(home.focus.ambiguous).toBe(true);
	});

	it('상태 단어는 옵션이다', () => {
		const options = {
			...DEFAULT_ANALYZE_OPTIONS,
			focus: { ...DEFAULT_ANALYZE_OPTIONS.focus, states: { focus: ['highlighted'], input: [], notFocus: [] } }
		};
		const b = analyzeFrame(sampleSearchFrame([0]), options);
		expect(b.focus.candidates.some((c) => c.source === 'variant')).toBe(false);
	});
});

describe('포커스 근거 ③ 입력 상태 (D-033)', () => {
	it('포커스 변형도 형제 차이도 없으면 입력 상태 입력창을 포커스로 보되 확인 필요로 표시한다', () => {
		const a = analyzeFrame(sampleSearchFrame([]));
		expect(a.focus.primary?.source).toBe('input-state');
		expect(nameOf(a, a.focus.primary?.memberId)).toBe('search form');
		expect(a.focus.primary?.score).toBe(0.5);
		expect(a.focus.ambiguous).toBe(true);
	});

	it('포커스 변형이 있으면 입력 상태는 참고 후보로만 남는다', () => {
		const a = analyzeFrame(sampleSearchFrame([0]));
		expect(a.focus.candidates.map((c) => c.source)).toEqual(['variant', 'input-state']);
	});
});

describe('형제 대비 보정 (D-033)', () => {
	const a = analyzeFrame(sampleSearchFrame([]));

	it('글자 줄(내용 길이로 폭이 다른 글자), 화면에 걸친 카드의 흐림 레이어, 글자 길이로 폭이 다른 탭은 후보가 아니다', () => {
		expect(a.focus.candidates.filter((c) => c.source === 'siblings')).toEqual([]);
	});

	it('현재 메뉴(selected 변형)는 다른 멤버와 달라도 포커스 후보에서 빼고 이유를 남긴다', () => {
		expect(a.focus.skipped.some((s) => /selected/.test(s.reason))).toBe(true);
	});

	it('Top 10 합성 홈은 그대로 형제 대비로 찾는다', () => {
		const home = analyzeFrame(sampleHomeFrame());
		expect(home.focus.primary?.source).toBe('siblings');
		expect(home.focus.primary?.style.scale).not.toBeNull();
	});
});
