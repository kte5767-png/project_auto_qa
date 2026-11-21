import { THUMBNAILS, TOP10 } from './data';
import { computeRowOffset, thumbnailLefts, thumbnailWidths, top10GroupLeft, top10GroupWidth } from './layout';
import type { Layout } from './layout';

export type HomeShelf = 'thumbnail' | 'top10' | 'promo';

/** 홈 화면 스크롤 상태: 세로로 어느 셸프를 보여줄지, 각 가로 행을 얼마나 밀었는지 */
export interface HomeView {
	shelf: HomeShelf;
	thumbnailOffset: number;
	top10Offset: number;
}

export const INITIAL_HOME_VIEW: HomeView = { shelf: 'thumbnail', thumbnailOffset: 0, top10Offset: 0 };

/** 포커스된 요소에 맞춰 홈 화면의 세로 셸프와 가로 행 스크롤 위치를 계산한다. */
export function nextHomeView(view: HomeView, focusedId: string, layout: Layout): HomeView {
	const { left, rightLimit } = layout.content;
	const thumbIndex = THUMBNAILS.findIndex((item) => item.id === focusedId);
	if (thumbIndex >= 0) {
		const itemLeft = thumbnailLefts(layout)[thumbIndex] ?? 0;
		const itemRight = itemLeft + (thumbnailWidths(layout)[thumbIndex] ?? 0);
		return {
			...view,
			shelf: 'thumbnail',
			thumbnailOffset: computeRowOffset(itemLeft, itemRight, view.thumbnailOffset, left, rightLimit)
		};
	}
	const top10Index = TOP10.findIndex((item) => item.id === focusedId);
	if (top10Index >= 0) {
		const itemLeft = top10GroupLeft(layout, top10Index);
		const itemRight = itemLeft + top10GroupWidth(layout);
		return {
			...view,
			shelf: 'top10',
			top10Offset: computeRowOffset(itemLeft, itemRight, view.top10Offset, left, rightLimit)
		};
	}
	if (focusedId === 'promo-button') {
		return { ...view, shelf: 'promo' };
	}
	return view;
}
