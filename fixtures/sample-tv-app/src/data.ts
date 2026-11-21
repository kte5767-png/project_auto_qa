/** 화면에 표시할 샘플 데이터. 이미지는 재현성을 위해 외부 이미지 대신 색상 그라데이션을 쓴다. */
export interface Item {
	id: string;
	title: string;
	hue: number;
	kind?: 'content' | 'ad';
	subtitle?: string;
}

export const THUMBNAIL_SHELF_TITLE = 'Autumn in the Rockies';
export const THUMBNAILS: Item[] = [
	{ id: 'thumb-1', title: 'Jasper National Park', hue: 30 },
	{ id: 'thumb-2', title: 'Pacific Rim National Park Reserve', hue: 200 },
	{ id: 'thumb-3', title: 'Banff National Park', hue: 210 },
	{
		id: 'thumb-4',
		title: 'Stay Where Autumn Meets the Lake',
		subtitle: 'Wake up to the most beautiful views.',
		hue: 40,
		kind: 'ad'
	},
	{ id: 'thumb-5', title: 'Yoho National Park', hue: 150 }
];

export const TOP10_SHELF_TITLE = 'Best Spots in Alberta';
export const TOP10: Item[] = [
	'Lake Louise',
	'Banff Gondola',
	'Bow Falls',
	'Moraine Lake',
	'Johnston Canyon',
	'Peyto Lake',
	'Icefields Parkway',
	'Athabasca Falls',
	'Maligne Canyon',
	'Emerald Lake'
].map((title, i) => ({ id: `top10-card-${i + 1}`, title, hue: (i * 37 + 160) % 360 }));

export const PROMO = {
	title: 'Discover Alberta Through the Rockies',
	description:
		'Turquoise lakes, glacier-fed rivers and quiet mountain towns. Plan a slow road trip through the Canadian Rockies and find the views that locals keep returning to every autumn.',
	button: 'Explore the Route'
};

export const SEARCH_KEYWORDS = ['Walking in Bali', 'Driving in Hong Kong', 'Place in China', 'Romantic', 'Family'];
export const SEARCH_CARDS: Item[] = ['Ubud Rice Terraces', 'Victoria Peak', 'Great Wall', 'Santorini', 'Lake Bled'].map(
	(title, i) => ({ id: `search-card-${i + 1}`, title, hue: (i * 53 + 20) % 360 })
);

export function gradientOf(hue: number): string {
	return `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 22%))`;
}

export function findItem(id: string): Item | undefined {
	return [...THUMBNAILS, ...TOP10, ...SEARCH_CARDS].find((item) => item.id === id);
}
