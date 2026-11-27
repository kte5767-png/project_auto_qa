import type { Rect } from '@auto-qa/core';
import type { DomNode, DomSnapshot } from '@auto-qa/focus';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_LINK_OPTIONS, linkScreenToApp, sameBox, selectorFor, siblingGroups } from './appLink';
import type { NavCallout, NavScreen } from './keymap';

/** 합성 앱 화면 요소 목록 (문서 순서). parent는 앞에 나온 요소 순번 */
function snap(defs: (Partial<DomNode> & { parent: number; rect: Rect })[]): DomSnapshot {
	return {
		viewport: { width: 1920, height: 1080 },
		nodes: defs.map((d, i) => ({
			i,
			tag: 'div',
			id: null,
			classes: [],
			spotlightId: null,
			container: false,
			role: null,
			label: null,
			ownText: '',
			value: null,
			focusable: false,
			focused: false,
			probes: [],
			...d
		})),
		truncated: false,
		errors: []
	};
}

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

/**
 * 합성 검색 화면: 0 body, 1 패널, 2 검색창 감싸개(같은 상자), 3 입력란, 4 추천 검색어 묶음(번호 바뀌는 spotlight id),
 * 5~7 검색어 버튼, 8 Travel Now 묶음, 9 제목, 10~11 카드
 */
const APP = snap([
	{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
	{ parent: 0, id: 'searchPanel', rect: r(0, 0, 1920, 1080) },
	{ parent: 1, classes: ['SearchField_wrap__x1'], rect: r(380, 60, 1160, 90) },
	{
		parent: 2,
		tag: 'input',
		classes: ['SearchField_input__k9', 'spottable', 'SearchField_focused__z2'],
		label: 'Search your place.',
		focusable: true,
		rect: r(382, 62, 1156, 86)
	},
	{ parent: 1, spotlightId: 'container-3', classes: ['Keywords_list__a7'], rect: r(100, 220, 1200, 70) },
	{
		parent: 4,
		tag: 'button',
		classes: ['Chip_chip__q1', 'spottable'],
		ownText: 'Tokyo',
		focusable: true,
		rect: r(100, 220, 200, 70)
	},
	{
		parent: 4,
		tag: 'button',
		classes: ['Chip_chip__q1', 'spottable'],
		ownText: 'Paris',
		focusable: true,
		rect: r(320, 220, 200, 70)
	},
	{
		parent: 4,
		tag: 'button',
		classes: ['Chip_chip__q1', 'spottable'],
		ownText: 'Seoul',
		focusable: true,
		rect: r(540, 220, 200, 70)
	},
	{ parent: 1, classes: ['TravelNow_section__m3'], rect: r(100, 330, 1700, 400) },
	{ parent: 8, tag: 'h2', classes: ['TravelNow_title__m4'], ownText: 'Travel Now', rect: r(100, 330, 400, 50) },
	{
		parent: 8,
		classes: ['Card_card__c1', 'spottable'],
		ownText: 'Jeju Island',
		focusable: true,
		rect: r(100, 400, 400, 300)
	},
	{
		parent: 8,
		classes: ['Card_card__c1', 'spottable'],
		ownText: 'Busan',
		focusable: true,
		rect: r(520, 400, 400, 300)
	}
]);

const callout = (
	no: string,
	name: string,
	texts: string[],
	rect: Rect | null,
	keys: NavCallout['keys'] = {}
): NavCallout => ({
	no,
	names: [name],
	texts,
	rect,
	keys
});

const NAV: NavScreen = {
	screenId: '4.2',
	title: '검색',
	callouts: [
		// 목업 위치는 대략값 (실제와 수십 px 어긋남)
		callout('1', '검색창 영역', ['Search your place.'], r(400, 70, 1100, 80), { down: '추천 검색어로 이동' }),
		// 목업의 예시 데이터는 앱 데이터와 다르다 (Tokyo만 같음)
		callout('2', '추천 검색어', ['Tokyo', 'London', 'Rome'], r(90, 210, 1100, 80), { up: '검색창으로 이동' }),
		callout('3', 'Travel Now', ['Travel Now', 'Card title'], r(110, 340, 1650, 380))
	]
};

describe('linkScreenToApp', () => {
	const link = linkScreenToApp(NAV, APP);
	const byNo = new Map(link.callouts.map((c) => [c.no, c]));

	it('글자·위치·포커스 가능 여부로 콜아웃마다 앱 요소를 고른다', () => {
		expect(sameBox(APP, byNo.get('1')?.best?.node ?? -1, 3, DEFAULT_APP_LINK_OPTIONS.sameBoxIou)).toBe(true);
		expect(byNo.get('2')?.best?.node).toBe(4);
		expect(byNo.get('3')?.best?.node).toBe(8);
	});

	it('감싸기만 하는 요소는 같은 상자로 묶고 다음 후보에는 넣지 않는다', () => {
		const one = byNo.get('1');
		expect(one?.sameBox.map((c) => c.node)).toEqual(expect.arrayContaining([2, 3]));
		expect(one?.alternatives.map((a) => a.node)).not.toContain(2);
		expect(one?.alternatives.map((a) => a.node)).not.toContain(3);
	});

	it('선택자는 하나만 맞고, 상태 클래스·번호가 바뀌는 이름은 쓰지 않는다', () => {
		const one = byNo.get('1')?.selector;
		expect(one?.unique).toBe(true);
		expect(one?.selector).not.toContain('focused');
		const two = byNo.get('2')?.selector;
		expect(two).toMatchObject({ selector: '.Keywords_list__a7', unique: true, stable: true, count: 1 });
		expect(byNo.get('3')?.selector?.selector).toBe('.TravelNow_section__m3');
	});

	it('묶음 안에 같은 클래스의 포커스 가능 항목이 여럿이면 items 선택자도 낸다', () => {
		expect(byNo.get('2')?.selector?.items).toBe('.Chip_chip__q1');
		expect(byNo.get('3')?.selector?.items).toBe('.Card_card__c1');
		expect(byNo.get('1')?.selector?.items).toBeUndefined();
	});

	it('찾지 못하면 고르지 않는다', () => {
		const far = linkScreenToApp({ ...NAV, callouts: [callout('9', '없는 영역', ['Nothing here'], null)] }, APP)
			.callouts[0];
		expect(far?.best).toBeNull();
		expect(far?.reason).toContain('찾지 못함');
	});

	it('같은 점수의 다른 상자가 있으면 애매함으로 표시한다', () => {
		const two = snap([
			{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
			{ parent: 0, classes: ['left'], focusable: true, rect: r(100, 400, 400, 300) },
			{ parent: 0, classes: ['right'], focusable: true, rect: r(520, 400, 400, 300) }
		]);
		const twin = linkScreenToApp({ ...NAV, callouts: [callout('5', '카드', [], r(310, 400, 400, 300))] }, two)
			.callouts[0];
		expect(twin?.ambiguous).toBe(true);
		expect(twin?.alternatives.length).toBeGreaterThan(0);
	});
});

describe('selectorFor', () => {
	it('조각 하나로 안 되면 하나만 맞는 조상 아래로 좁힌다', () => {
		expect(selectorFor(APP, [9])?.selector).toBe('.TravelNow_title__m4');
		// 같은 클래스 카드가 둘 → 하나로 좁힐 수 없으면 unique false
		expect(selectorFor(APP, [10])?.unique).toBe(false);
		// 둘을 함께 가리키면 하나의 클래스로 정확히 맞는다
		expect(selectorFor(APP, [10, 11])).toMatchObject({ selector: '.Card_card__c1', unique: true, count: 2 });
	});

	it('번호가 바뀌는 spotlight id만 있으면 안정적이지 않다고 표시한다', () => {
		const only = snap([
			{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
			{ parent: 0, spotlightId: 'container-12', rect: r(0, 0, 100, 100) }
		]);
		expect(selectorFor(only, [1])).toMatchObject({ selector: '[data-spotlight-id="container-12"]', stable: false });
	});
});

describe('감싸는 요소 없이 나란히 놓인 항목 (형제 묶음)', () => {
	/** 0 body, 1 화면, 2 제목, 3~5 검색어 버튼(화면 바로 아래), 6 카드 */
	const FLAT = snap([
		{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
		{ parent: 0, classes: ['screen', 'search'], rect: r(0, 0, 1920, 1080) },
		{
			parent: 1,
			tag: 'h2',
			classes: ['section-title'],
			ownText: 'Recommended Keywords',
			rect: r(210, 178, 367, 40)
		},
		{
			parent: 1,
			classes: ['nav-item', 'search-chip', 'spottable'],
			ownText: 'Walking in Bali',
			focusable: true,
			rect: r(210, 246, 320, 66)
		},
		{
			parent: 1,
			classes: ['nav-item', 'search-chip', 'spottable'],
			ownText: 'Driving in Hong Kong',
			focusable: true,
			rect: r(543, 246, 320, 66)
		},
		{
			parent: 1,
			classes: ['nav-item', 'search-chip', 'spottable'],
			ownText: 'Family',
			focusable: true,
			rect: r(876, 246, 320, 66)
		},
		{
			parent: 1,
			classes: ['nav-item', 'search-card', 'spottable'],
			ownText: 'Ubud',
			focusable: true,
			rect: r(210, 467, 388, 216)
		}
	]);

	it('같은 태그·클래스의 형제를 클래스마다 묶는다 (같은 묶음은 한 번만)', () => {
		expect(siblingGroups(FLAT)).toEqual([
			[3, 4, 5, 6],
			[3, 4, 5]
		]);
	});

	it('콜아웃이 항목 줄 전체를 가리키면 형제 묶음을 고르고, 그 항목들만 맞는 선택자를 낸다', () => {
		const link = linkScreenToApp(
			{
				...NAV,
				callouts: [
					callout('2', '추천 검색어', ['Walking in Bali', 'Romantic'], r(200, 240, 1000, 80), { up: '위로' })
				]
			},
			FLAT
		).callouts[0];
		expect(link?.best?.nodes).toEqual([3, 4, 5]);
		expect(link?.selector).toMatchObject({ selector: '.search-chip', count: 3, unique: true });
	});
});

describe('콜아웃 = 포커스 영역 (프로필 대응의 관례)', () => {
	/**
	 * 0 body, 1 패널, 2 헤더 오른쪽 영역 > 3 옵션 버튼,
	 * 4 Travel Now 섹션 > 5 제목, 6 가로 목록 > 7~8 카드 > 9 카드 제목,
	 * 10 카테고리 줄 > 11~13 카테고리 버튼(12가 선택된 것)
	 */
	const PAGE = snap([
		{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
		{ parent: 0, spotlightId: 'panel_search', rect: r(0, 0, 1920, 1080) },
		{ parent: 1, classes: ['Header_rightArea'], rect: r(1700, 40, 180, 80) },
		{
			parent: 2,
			classes: ['Header_moreBtn', 'spottable'],
			spotlightId: 'headerMoreBtn',
			focusable: true,
			rect: r(1780, 50, 60, 60)
		},
		{ parent: 1, id: 'section-travel-now', rect: r(0, 389, 1920, 391) },
		{ parent: 4, tag: 'h2', classes: ['Headline_headline'], ownText: 'Travel now', rect: r(180, 389, 136, 36) },
		{ parent: 4, classes: ['HList_list'], spotlightId: 'search-travel-now', rect: r(0, 425, 1920, 355) },
		{ parent: 6, classes: ['Card_card', 'spottable'], focusable: true, rect: r(180, 449, 403, 307) },
		{ parent: 6, classes: ['Card_card', 'spottable'], focusable: true, rect: r(603, 449, 403, 307) },
		{ parent: 7, classes: ['Card_title'], ownText: 'Jeju', rect: r(190, 700, 300, 30) },
		{
			parent: 1,
			classes: ['CategoryBar_bar'],
			spotlightId: 'search-result-categories',
			rect: r(180, 150, 900, 60)
		},
		{
			parent: 10,
			classes: ['CategoryBar_categoryBtn', 'spottable'],
			ownText: 'All',
			focusable: true,
			rect: r(180, 150, 200, 60)
		},
		{
			parent: 10,
			classes: ['CategoryBar_categoryBtn', 'CategoryBar_categoryBtnActive', 'spottable'],
			ownText: 'Flights',
			focusable: true,
			rect: r(400, 150, 200, 60)
		},
		{
			parent: 10,
			classes: ['CategoryBar_categoryBtn', 'spottable'],
			ownText: 'Hotels',
			focusable: true,
			rect: r(620, 150, 200, 60)
		}
	]);
	const linkOne = (c: NavCallout): ReturnType<typeof linkScreenToApp>['callouts'][number] | undefined =>
		linkScreenToApp({ ...NAV, callouts: [c] }, PAGE).callouts[0];

	it('키 동작이 있으면 제목 글자 대신 그 아래 포커스 가능한 목록을 고른다', () => {
		const link = linkOne(
			callout('3', 'Travel Now', ['Travel Now'], r(150, 380, 700, 300), { down: '아래로 이동' })
		);
		expect(link?.best?.node).toBe(6);
		expect(link?.selector).toMatchObject({
			selector: '[data-spotlight-id="search-travel-now"]',
			items: '.Card_card'
		});
		expect(link?.reason).toContain('포커스 영역으로 좁힘');
	});

	it('버튼 하나를 감싼 영역은 그 버튼으로 좁힌다', () => {
		const link = linkOne(callout('5', 'Search Option 메뉴', [], r(1690, 45, 200, 70), { left: '검색창으로 이동' }));
		expect(link?.best?.node).toBe(3);
		expect(link?.selector?.selector).toBe('[data-spotlight-id="headerMoreBtn"]');
	});

	it('항목 하나가 글자로 뽑혀도 콜아웃 위치가 항목 줄에 맞으면 목록으로 넓히고, 상태 클래스는 선택자에 쓰지 않는다', () => {
		const link = linkOne(
			callout('2', '카테고리 필터 영역', ['Flights'], r(170, 140, 900, 80), { right: '다음 항목' })
		);
		expect(link?.best?.node).toBe(10);
		expect(link?.selector).toMatchObject({
			selector: '[data-spotlight-id="search-result-categories"]',
			items: '.CategoryBar_categoryBtn'
		});
	});

	it('콜아웃 위치가 항목 하나에 맞으면 넓히지 않는다', () => {
		const link = linkOne(callout('7', 'Flights 버튼', ['Flights'], r(395, 145, 210, 70), { left: '왼쪽 항목' }));
		expect(link?.best?.node).toBe(12);
		expect(link?.selector?.selector).not.toContain('Active');
	});
});

describe('영역 이름·같은 점수 후보', () => {
	/**
	 * 0 body, 1 패널, 2 탭 묶음(spotlight container) > 3 스크롤 안쪽 > 4~6 탭,
	 * 7 키워드 줄 > 8~10 키워드 버튼
	 */
	const PAGE = snap([
		{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
		{ parent: 0, rect: r(0, 0, 1920, 1080) },
		{
			parent: 1,
			classes: ['TabGroup_viewport'],
			spotlightId: 'search-result-tabs',
			container: true,
			rect: r(0, 182, 1920, 124)
		},
		{ parent: 2, classes: ['Scroller_content'], rect: r(180, 200, 1200, 80) },
		...['All', 'Flights', 'Hotels'].map((t, k) => ({
			parent: 3,
			classes: ['Tab_tab', 'spottable'],
			ownText: t,
			focusable: true,
			rect: r(180 + k * 220, 200, 200, 80)
		})),
		{ parent: 1, classes: ['Keywords_row'], rect: r(180, 600, 1100, 70) },
		...['Bali', 'Family', 'Romantic'].map((t, k) => ({
			parent: 7,
			classes: ['Keywords_chip', 'spottable'],
			ownText: t,
			focusable: true,
			rect: r(180 + k * 380, 600, 340, 70)
		}))
	]);
	const linkOne = (c: NavCallout): ReturnType<typeof linkScreenToApp>['callouts'][number] | undefined =>
		linkScreenToApp({ ...NAV, callouts: [c] }, PAGE).callouts[0];

	it('이름이 영역·목록이면 첫 항목에 그린 콜아웃도 항목들을 담은 포커스 묶음으로 넓힌다', () => {
		const link = linkOne(callout('2', '카테고리 필터 영역', ['All'], r(175, 195, 210, 90), { right: '다음 탭' }));
		expect(link?.best?.node).toBe(2);
		expect(link?.selector).toMatchObject({
			selector: '[data-spotlight-id="search-result-tabs"]',
			items: '.Tab_tab'
		});
		expect(link?.reason).toContain('이름이 영역');
	});

	it('이름이 영역이 아니고 위치가 항목 하나에 맞으면 그 항목', () => {
		const link = linkOne(callout('2', 'All 버튼', ['All'], r(175, 195, 210, 90), { right: '다음 탭' }));
		expect(link?.best?.node).toBe(4);
	});

	it('같은 점수의 버튼들과 그 줄이 겨루면 모두 담은 줄을 고른다', () => {
		// 목업 글자가 앱에 없고, 콜아웃이 줄 바로 위에 그려져 겹침 없이 거리만 같다
		const link = linkOne(callout('3', '추천 키워드', ['목업 키워드'], r(180, 560, 1100, 30), { down: '아래로' }));
		expect(link?.best?.node).toBe(7);
		expect(link?.reason).toContain('같은 점수 후보를 모두 담은 요소');
	});
});

describe('Enact 목록 꼴 (스크롤 칸·항목 칸으로 여러 번 감쌈)', () => {
	/**
	 * 0 body, 1 패널, 2 탭 묶음(spotlight) > 3 스크롤 > 4 안쪽 > 5 줄 > 6~8 탭,
	 * 9 결과 묶음(spotlight, 화면의 79%) > 10 격자 > 11~14 항목 칸(클래스 없음) > 15~18 카드 > 19 썸네일
	 */
	const PAGE = snap([
		{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
		{ parent: 0, rect: r(0, 0, 1920, 1080) },
		// Enact 포커스 묶음은 tabindex가 있어 포커스 가능으로 읽힌다
		{ parent: 1, spotlightId: 'result-categories', container: true, focusable: true, rect: r(0, 182, 1920, 124) },
		{ parent: 2, classes: ['Scroller_scroller'], rect: r(0, 190, 1920, 100) },
		{ parent: 3, classes: ['Scroller_content'], rect: r(0, 194, 1920, 80) },
		{ parent: 4, classes: ['CategoryBar_row'], rect: r(0, 198, 1920, 64) },
		...['All', 'Flights', 'Hotels'].map((t, k) => ({
			parent: 5,
			classes: ['CategoryBar_btn', 'spottable'],
			ownText: t,
			focusable: true,
			rect: r(180 + k * 220, 198, 200, 64)
		})),
		{
			parent: 1,
			spotlightId: 'result-container',
			container: true,
			focusable: true,
			rect: r(0, 306, 1920, 744)
		},
		{ parent: 9, classes: ['VirtualGrid_list'], rect: r(150, 320, 1620, 700) },
		...[0, 1, 2, 3].map((k) => ({ parent: 10, rect: r(180 + k * 400, 340, 380, 300) })),
		...[0, 1, 2, 3].map((k) => ({
			parent: 11 + k,
			classes: ['ContentCard_card', 'spottable'],
			spotlightId: `grid-item-${k}`,
			focusable: true,
			rect: r(180 + k * 400, 340, 380, 300)
		})),
		{ parent: 15, classes: ['ContentCard_thumbnail'], rect: r(190, 350, 360, 200) }
	]);
	const linkOne = (c: NavCallout): ReturnType<typeof linkScreenToApp>['callouts'][number] | undefined =>
		linkScreenToApp({ ...NAV, callouts: [c] }, PAGE).callouts[0];

	it('목록으로 넓힐 때 같은 항목만 담은 포커스 묶음까지 여러 단계 올라간다', () => {
		const link = linkOne(callout('2', '카테고리 필터 영역', ['All'], r(175, 195, 210, 70), { right: '다음 탭' }));
		expect(link?.best?.node).toBe(2);
		expect(link?.selector?.selector).toBe('[data-spotlight-id="result-categories"]');
	});

	it('항목 칸으로 감싼 가상 격자도 항목 줄로 보고, 화면 대부분을 덮는 결과 묶음까지 넓힌다', () => {
		const link = linkOne(callout('3', '', [], r(170, 330, 1600, 320), { down: '아래 줄' }));
		expect(link?.best?.node).toBe(9);
		expect(link?.selector).toMatchObject({
			selector: '[data-spotlight-id="result-container"]',
			items: '.ContentCard_card'
		});
	});
});

describe('항목이 하나뿐인 포커스 묶음, 데이터가 든 이름', () => {
	/** 0 body, 1 패널, 2 최근 검색어 묶음(spotlight container, 포커스 가능으로 읽힘) > 3 검색어 버튼 하나(이름에 검색어) */
	const PAGE = snap([
		{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
		{ parent: 0, rect: r(0, 0, 1920, 1080) },
		{
			parent: 1,
			spotlightId: 'search-recent-searches',
			container: true,
			focusable: true,
			rect: r(0, 198, 1920, 68)
		},
		{
			parent: 2,
			classes: ['Chip_chip', 'spottable'],
			spotlightId: 'recent-search-Scenic Temple',
			ownText: 'Scenic Temple',
			focusable: true,
			rect: r(254, 203, 299, 63)
		}
	]);

	it('항목이 하나여도 포커스 묶음에서 멈추고 그 안 항목으로 좁히지 않는다', () => {
		const link = linkScreenToApp(
			{
				...NAV,
				callouts: [callout('1', '최근 검색어', ['최근 검색어 예시'], r(200, 190, 1500, 80), { down: '아래' })]
			},
			PAGE
		).callouts[0];
		expect(link?.best?.node).toBe(2);
		expect(link?.selector?.selector).toBe('[data-spotlight-id="search-recent-searches"]');
	});

	it('항목 글자가 든 이름·띄어쓰기가 든 이름은 안정적이지 않아 다른 조각을 먼저 쓴다', () => {
		expect(selectorFor(PAGE, [3])).toMatchObject({ selector: '.Chip_chip', stable: true });
		const only = snap([
			{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
			{
				parent: 0,
				spotlightId: 'recent-search-Scenic Temple',
				ownText: 'Scenic Temple',
				focusable: true,
				rect: r(0, 0, 300, 60)
			}
		]);
		expect(selectorFor(only, [1])).toMatchObject({ stable: false });
		expect(selectorFor(PAGE, [2])).toMatchObject({
			selector: '[data-spotlight-id="search-recent-searches"]',
			stable: true
		});
	});
});
