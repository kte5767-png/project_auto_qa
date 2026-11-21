import { describe, expect, it } from 'vitest';
import { INITIAL_HOME_VIEW, nextHomeView } from './homeView';
import { BASE_LAYOUT, getLayout } from './layout';

describe('nextHomeView', () => {
	it('Top 10 1번 포커스 → Top 10 셸프, 가로 이동 없음 (Figma Top 10 01 상태)', () => {
		expect(nextHomeView(INITIAL_HOME_VIEW, 'top10-card-1', BASE_LAYOUT)).toEqual({
			shelf: 'top10',
			thumbnailOffset: 0,
			top10Offset: 0
		});
	});

	it('Top 10 4번 포커스 → 오른쪽 끝에 맞게 행을 민다', () => {
		expect(nextHomeView(INITIAL_HOME_VIEW, 'top10-card-4', BASE_LAYOUT).top10Offset).toBe(-528);
	});

	it('간격이 넓어지면(D03) 같은 항목에서 더 많이 민다', () => {
		const view = nextHomeView(INITIAL_HOME_VIEW, 'top10-card-4', getLayout(new Set(['D03'])));
		expect(view.top10Offset).toBe(-552);
	});

	it('프로모 버튼 포커스 → 프로모 셸프, 행 위치는 유지', () => {
		const from = { shelf: 'top10' as const, thumbnailOffset: 0, top10Offset: -528 };
		expect(nextHomeView(from, 'promo-button', BASE_LAYOUT)).toEqual({ ...from, shelf: 'promo' });
	});

	it('GNB 포커스는 스크롤 상태를 바꾸지 않는다', () => {
		const from = { shelf: 'top10' as const, thumbnailOffset: 0, top10Offset: -528 };
		expect(nextHomeView(from, 'gnb-search', BASE_LAYOUT)).toBe(from);
	});
});
