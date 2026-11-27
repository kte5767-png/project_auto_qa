/**
 * 디자인 기준값. 홈 화면 크기·간격·포커스 스타일은 실제 Figma 프레임 `Top 10 01`(node 1:7400)의
 * 메타데이터 값과 같다. 글자 크기·색은 Figma에서 읽지 않은 값이므로 이 앱 자체의 기준이다.
 * 결함(D01~D06)은 이 값을 바꾸는 방식으로 넣는다.
 */
export interface Layout {
	viewport: { width: number; height: number };
	colors: {
		background: string;
		text: string;
		subText: string;
		focusBorder: string;
		gnbBackground: string;
		gnbFocusBackground: string;
		promoButtonBackground: string;
		promoButtonText: string;
		chipBackground: string;
	};
	fontFamily: string;
	gnb: { width: number; itemSize: number; logoCenterY: number; itemCentersY: number[] };
	content: { left: number; firstShelfTop: number; focusedShelfTop: number; rightLimit: number };
	shelfTitle: { fontSize: number; lineHeight: number; fontWeight: number; gap: number };
	/** 홈 콘텐츠 좌표계에서 각 셸프의 top */
	shelfTops: { thumbnail: number; top10: number; promo: number };
	thumbnail: {
		cardWidth: number;
		adCardWidth: number;
		cardHeight: number;
		gap: number;
		titleFontSize: number;
		titleLineHeight: number;
		radius: number;
		focusBorderWidth: number;
	};
	top10: {
		count: number;
		rankWidth: number;
		rankGap: number;
		rankFontSize: number;
		cardWidth: number;
		imageHeight: number;
		titleGap: number;
		titleFontSize: number;
		titleLineHeight: number;
		groupGap: number;
		focusScale: number;
		focusBorderWidth: number;
		radius: number;
		/** 3번 카드 이미지 y 오프셋 (D04) */
		item3ImageOffsetY: number;
		/** 포커스 테두리 표시 여부 (D05) */
		showFocusBorder: boolean;
	};
	promo: {
		width: number;
		height: number;
		paddingLeft: number;
		paddingTop: number;
		textWidth: number;
		titleFontSize: number;
		titleLineHeight: number;
		descriptionWidth: number;
		descriptionFontSize: number;
		descriptionLineHeight: number;
		/** 설명 줄 수 제한. 0이면 제한 없음 (D06은 1줄 말줄임) */
		descriptionMaxLines: number;
		buttonTop: number;
		buttonWidth: number;
		buttonHeight: number;
		radius: number;
	};
	search: {
		placeholder: string;
		fieldLeft: number;
		fieldTop: number;
		fieldWidth: number;
		fieldHeight: number;
		/** 칸을 넘치는 카드 제목: 포커스 2초 뒤 흐르는 글자(Marquee). D13은 끔 */
		cardMarquee: boolean;
		/** 넘치는 입력값의 끝 처리 (text-overflow). D14는 clip(말줄임 없음) */
		inputOverflow: 'ellipsis' | 'clip';
	};
}

export const BASE_LAYOUT: Layout = {
	viewport: { width: 1920, height: 1080 },
	colors: {
		background: '#000000',
		text: '#FFFFFF',
		subText: '#E6E6E6',
		focusBorder: '#FFFFFF',
		gnbBackground: '#0B0B0B',
		gnbFocusBackground: '#1E3B36',
		promoButtonBackground: '#F2F2F2',
		promoButtonText: '#000000',
		chipBackground: '#2B2B2B'
	},
	fontFamily: 'Arial, Helvetica, sans-serif',
	gnb: { width: 130, itemSize: 64, logoCenterY: 90, itemCentersY: [390, 489, 588, 687] },
	content: { left: 180, firstShelfTop: 120, focusedShelfTop: 373, rightLimit: 1740 },
	shelfTitle: { fontSize: 28, lineHeight: 35, fontWeight: 600, gap: 24 },
	shelfTops: { thumbnail: 0, top10: 809.45, promo: 1303.45 },
	thumbnail: {
		cardWidth: 400,
		adCardWidth: 300,
		cardHeight: 600,
		gap: 24,
		titleFontSize: 30,
		titleLineHeight: 42,
		radius: 12,
		focusBorderWidth: 4
	},
	top10: {
		count: 10,
		rankWidth: 83,
		rankGap: 9,
		rankFontSize: 120,
		cardWidth: 400,
		imageHeight: 225,
		titleGap: 18,
		titleFontSize: 24,
		titleLineHeight: 32,
		groupGap: 40,
		focusScale: 1.1,
		focusBorderWidth: 4,
		radius: 12,
		item3ImageOffsetY: 0,
		showFocusBorder: true
	},
	promo: {
		width: 1684,
		height: 452,
		paddingLeft: 70,
		paddingTop: 78,
		textWidth: 780,
		titleFontSize: 48,
		titleLineHeight: 63,
		descriptionWidth: 780,
		descriptionFontSize: 28,
		descriptionLineHeight: 35,
		descriptionMaxLines: 3,
		buttonTop: 224,
		buttonWidth: 442,
		buttonHeight: 72,
		radius: 16
	},
	search: {
		placeholder: 'Search your destination or interest.',
		fieldLeft: 483,
		fieldTop: 42,
		fieldWidth: 953,
		fieldHeight: 72,
		cardMarquee: true,
		inputOverflow: 'ellipsis'
	}
};

/** 켜진 결함에 맞춰 기준값을 바꾼 레이아웃을 돌려준다. 원본은 바꾸지 않는다. */
export function getLayout(defects: ReadonlySet<string>): Layout {
	const layout = structuredClone(BASE_LAYOUT);
	if (defects.has('D01')) layout.shelfTitle.fontSize = 26;
	if (defects.has('D02')) layout.colors.promoButtonBackground = '#D9D9D9';
	if (defects.has('D03')) layout.top10.groupGap = 48;
	if (defects.has('D04')) layout.top10.item3ImageOffsetY = 6;
	if (defects.has('D05')) layout.top10.showFocusBorder = false;
	if (defects.has('D06')) {
		layout.promo.descriptionWidth = 560;
		layout.promo.descriptionMaxLines = 1;
	}
	if (defects.has('D12')) layout.search.placeholder = 'Search destination or interest';
	if (defects.has('D13')) layout.search.cardMarquee = false;
	if (defects.has('D14')) layout.search.inputOverflow = 'clip';
	return layout;
}

/** Top 10 항목(순위 숫자 + 카드) 하나의 가로 폭 */
export function top10GroupWidth(layout: Layout): number {
	return layout.top10.rankWidth + layout.top10.rankGap + layout.top10.cardWidth;
}

/** Top 10 i번째(0부터) 항목의 행 좌표계 left */
export function top10GroupLeft(layout: Layout, index: number): number {
	return index * (top10GroupWidth(layout) + layout.top10.groupGap);
}

/** 썸네일 셸프 카드 폭 목록 (4번째는 광고 카드) */
export function thumbnailWidths(layout: Layout): number[] {
	const { cardWidth, adCardWidth } = layout.thumbnail;
	return [cardWidth, cardWidth, cardWidth, adCardWidth, cardWidth];
}

export function thumbnailLefts(layout: Layout): number[] {
	const lefts: number[] = [];
	let x = 0;
	for (const w of thumbnailWidths(layout)) {
		lefts.push(x);
		x += w + layout.thumbnail.gap;
	}
	return lefts;
}

/**
 * 가로 행 스크롤 오프셋을 계산한다. 포커스된 항목이 [content.left, content.rightLimit] 안에 오도록
 * 필요한 만큼만 움직인다. itemLeft/itemRight는 행 좌표계 값이다.
 */
export function computeRowOffset(
	itemLeft: number,
	itemRight: number,
	currentOffset: number,
	viewportLeft: number,
	viewportRight: number
): number {
	const visibleLeft = viewportLeft + itemLeft + currentOffset;
	const visibleRight = viewportLeft + itemRight + currentOffset;
	if (visibleRight > viewportRight) {
		return viewportRight - viewportLeft - itemRight;
	}
	if (visibleLeft < viewportLeft) {
		return -itemLeft;
	}
	return currentOffset;
}
