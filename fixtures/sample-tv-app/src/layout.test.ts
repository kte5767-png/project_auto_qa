import { describe, expect, it } from 'vitest';
import { BASE_LAYOUT, computeRowOffset, getLayout, thumbnailLefts, top10GroupLeft, top10GroupWidth } from './layout';

describe('Figma Top 10 01 프레임과 같은 기준값', () => {
	it('Top 10 항목 폭 492, 간격 40 → 다음 항목 시작 532', () => {
		expect(top10GroupWidth(BASE_LAYOUT)).toBe(492);
		expect(top10GroupLeft(BASE_LAYOUT, 1)).toBe(532);
		expect(top10GroupLeft(BASE_LAYOUT, 9)).toBe(4788);
	});

	it('Top 10 셸프가 포커스되면 위 셸프 top은 -436.45, 프로모 top은 867', () => {
		const offset = BASE_LAYOUT.content.focusedShelfTop - BASE_LAYOUT.shelfTops.top10;
		expect(BASE_LAYOUT.shelfTops.thumbnail + offset).toBeCloseTo(-436.45, 2);
		expect(BASE_LAYOUT.shelfTops.promo + offset).toBeCloseTo(867, 2);
	});

	it('썸네일 카드 시작 위치 (4번째는 300px 광고 카드)', () => {
		expect(thumbnailLefts(BASE_LAYOUT)).toEqual([0, 424, 848, 1272, 1596]);
	});
});

describe('getLayout', () => {
	it('결함이 없으면 기준값과 같다', () => {
		expect(getLayout(new Set())).toEqual(BASE_LAYOUT);
	});

	it('원본 기준값을 바꾸지 않는다', () => {
		getLayout(new Set(['D01', 'D03']));
		expect(BASE_LAYOUT.shelfTitle.fontSize).toBe(28);
		expect(BASE_LAYOUT.top10.groupGap).toBe(40);
	});

	it.each([
		['D01', (l: ReturnType<typeof getLayout>) => l.shelfTitle.fontSize, 26],
		['D02', (l: ReturnType<typeof getLayout>) => l.colors.promoButtonBackground, '#D9D9D9'],
		['D03', (l: ReturnType<typeof getLayout>) => l.top10.groupGap, 48],
		['D04', (l: ReturnType<typeof getLayout>) => l.top10.item3ImageOffsetY, 6],
		['D05', (l: ReturnType<typeof getLayout>) => l.top10.showFocusBorder, false],
		['D06', (l: ReturnType<typeof getLayout>) => l.promo.descriptionWidth, 560],
		['D12', (l: ReturnType<typeof getLayout>) => l.search.placeholder, 'Search destination or interest'],
		['D13', (l: ReturnType<typeof getLayout>) => l.search.cardMarquee, false],
		['D14', (l: ReturnType<typeof getLayout>) => l.search.inputOverflow, 'clip']
	])('%s는 해당 값만 바꾼다', (id, pick, expected) => {
		const changed = getLayout(new Set([id]));
		expect(pick(changed)).toEqual(expected);
		expect(pick(BASE_LAYOUT)).not.toEqual(expected);
	});
});

describe('computeRowOffset', () => {
	const LEFT = 180;
	const RIGHT = 1740;

	it('보이는 범위 안이면 그대로', () => {
		expect(computeRowOffset(532, 1024, 0, LEFT, RIGHT)).toBe(0);
	});

	it('오른쪽으로 넘치면 오른쪽 끝에 맞춘다', () => {
		// 4번째 Top 10 항목: 1596~2088 → 화면 2268이 1740을 넘음
		expect(computeRowOffset(1596, 2088, 0, LEFT, RIGHT)).toBe(-528);
	});

	it('왼쪽으로 넘치면 왼쪽 끝에 맞춘다', () => {
		expect(computeRowOffset(532, 1024, -800, LEFT, RIGHT)).toBe(-532);
	});
});
