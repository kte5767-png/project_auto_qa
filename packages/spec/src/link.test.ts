import { normalizeFrame } from '@auto-qa/figma';
import { node, sampleHomeFrame } from '@auto-qa/figma/testing';
import { describe, expect, it } from 'vitest';
import { extractSpecScreen } from './extract';
import { DEFAULT_LINK_OPTIONS, frameTitle, linkSpecToGui, mockupTexts, rankGuiFrames, textSimilarity } from './link';
import { sampleGuiFrame, sampleSpecPage } from './testing';

const specFrame = normalizeFrame(sampleSpecPage());
const spec = extractSpecScreen(specFrame);
const keyboard = normalizeFrame(sampleGuiFrame('keyboard'));
const closed = normalizeFrame(sampleGuiFrame('closed'));

const linked = (guis = [keyboard, closed]) => {
	const link = linkSpecToGui(spec, specFrame, guis);
	const gui = guis.find((g) => g.id === link.pair?.guiFrameId);
	const by = (no: string) => link.callouts.find((c) => c.no === no);
	const name = (no: string) => {
		const c = by(no);
		if (c === undefined) throw new Error(`콜아웃 ${no} 없음`);
		return c.element === null ? null : (gui?.elements.find((e) => e.id === c.element?.id)?.name ?? '?');
	};
	return { link, by, name };
};

describe('textSimilarity / frameTitle', () => {
	it('대소문자·공백·기호를 무시하고 2글자 묶음으로 비교한다', () => {
		expect(textSimilarity('Travel Now', 'travel-now')).toBe(1);
		expect(textSimilarity('검색 필드', '검색필드')).toBe(1);
		expect(textSimilarity('Popular', 'Popular Now')).toBeCloseTo(0.8);
		expect(textSimilarity('Recommended Keywords', 'Recommended Search Keywords')).toBeGreaterThan(0.8);
		expect(textSimilarity('Travel', 'Family')).toBe(0);
		expect(textSimilarity('', 'x')).toBe(0);
	});

	it('GUI 프레임 이름에서 번호·"Search_" 앞부분·제어 문자를 뗀다', () => {
		expect(frameTitle('4.1\bSearch_검색 필드 활성화')).toBe('검색 필드 활성화');
		expect(frameTitle('4.1.2 Search_검색 완료(All 선택)')).toBe('검색 완료(All 선택)');
		expect(frameTitle('4.1.1 Search option')).toBe('Search option');
	});

	it('목업 안의 의미 있는 글자만 모은다 (마커 번호·자리표시 제외)', () => {
		expect(mockupTexts(specFrame, spec).sort()).toEqual(['Popular', 'Search here', 'Trending']);
	});
});

describe('화면 짝', () => {
	it('같은 화면의 변형이 여럿이면 콜아웃 대상(강조 줄·키보드)이 있는 GUI를 고른다', () => {
		const ranked = rankGuiFrames(spec, specFrame, [closed, keyboard]);
		expect(ranked.map((r) => r.guiFrameName)).toEqual([
			'2.1.1 Sample_샘플 화면 진입',
			'2.1.1 Sample_샘플 화면 키보드 닫힘'
		]);
		// 글자만 보면 닫힌 변형도 같거나 낫다 → 콜아웃 대응 점수가 가른다
		expect(ranked[1]?.textOverlap).toBeGreaterThanOrEqual(ranked[0]?.textOverlap ?? 1);
		expect(ranked[0]?.calloutFit).toBeGreaterThan(ranked[1]?.calloutFit ?? 1);
		const { link } = linked();
		expect(link.pair?.guiFrameId).toBe(keyboard.id);
		expect(link.ambiguous).toBe(false);
	});

	it('관련 없는 GUI뿐이면 짝을 만들지 않는다', () => {
		const { link } = linked([normalizeFrame(sampleHomeFrame())]);
		expect(link.pair).toBeNull();
		expect(link.callouts).toEqual([]);
		expect(link.candidates).toHaveLength(1);
	});

	it('1·2위 점수 차가 작으면 확인 필요로 표시한다', () => {
		const copy = normalizeFrame(sampleGuiFrame('keyboard', '8:gui-copy'));
		expect(linked([keyboard, copy]).link.ambiguous).toBe(true);
	});
});

describe('콜아웃 → GUI 요소', () => {
	it('글자 + 위치로 대상을 찾는다', () => {
		const { name, by } = linked();
		expect(['1', '2', '3', '4', '5', '6'].map(name)).toEqual([
			'search form',
			'Popular Now',
			'strip',
			'keyboard',
			'btn_setting',
			'Trending'
		]);
		expect(by('1')?.score).toBeGreaterThan(0.9);
	});

	it('화면설계서 글자와 GUI 글자가 다르면 글자 차이로 남긴다 (판정은 하지 않음)', () => {
		const { by } = linked();
		expect(by('2')?.textDiffs).toEqual([{ spec: 'Popular', gui: 'Popular Now', similarity: 0.8 }]);
		expect(by('1')?.textDiffs).toEqual([]);
	});

	it('GUI에 없는 대상은 찾지 못함으로 둔다 (디자인 불일치 후보)', () => {
		const { link, by } = linked([closed]);
		expect(link.pair?.guiFrameId).toBe(closed.id);
		for (const no of ['3', '4']) {
			expect(by(no)?.element).toBeNull();
			expect(by(no)?.reason).toMatch(/디자인 불일치 후보/);
		}
		expect(by('1')?.element?.text).toBeNull();
		expect(by('6')?.element?.text).toBe('Trending');
	});

	it('글자 근거 없이 위치만으로 고를 때는 충분히 겹쳐야 한다 (큰 묶음이 근처라는 이유로 뽑히지 않음)', () => {
		// 설정 버튼이 없고, 그 자리를 덮는 큰 헤더만 있는 GUI
		const exported = sampleGuiFrame('keyboard', '8:gui-header');
		exported.node.children = [
			...exported.node.children.filter((n) => n.name !== 'btn_setting'),
			node('FRAME', { x: 8000, y: 0, width: 1920, height: 160 }, { name: 'header' })
		];
		const gui = normalizeFrame(exported);
		const settings = (options = DEFAULT_LINK_OPTIONS) =>
			linkSpecToGui(spec, specFrame, [gui], options).callouts.find((c) => c.no === '5')?.element?.name ?? null;
		expect(settings()).toBeNull();
		expect(settings({ ...DEFAULT_LINK_OPTIONS, minGeometryIou: 0 })).toBe('header');
	});

	it('같은 입력이면 같은 결과', () => {
		expect(linkSpecToGui(spec, specFrame, [closed, keyboard])).toEqual(linked().link);
	});
});
