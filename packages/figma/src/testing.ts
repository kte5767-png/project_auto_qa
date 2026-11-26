import type { Box, ExportedFrame, ExportedNode, ExportedPaint, FigmaExport, Rgba } from './exportFormat';
import { EXPORT_FORMAT, EXPORT_VERSION } from './exportFormat';

/**
 * 테스트·데모용 합성 내보내기. 실제 Figma 파일 내용은 쓰지 않는다.
 * 구조는 샘플 TV 앱 홈(fixtures/sample-tv-app)과 같다: GNB, 카드 셸프, Top 10(첫 카드 포커스), 프로모 카드.
 */

export const solid = (r: number, g: number, b: number, a = 1, opacity = 1): ExportedPaint => ({
	type: 'SOLID',
	visible: true,
	opacity,
	color: { r, g, b, a }
});
export const WHITE = solid(1, 1, 1);
export const IMAGE: ExportedPaint = { type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL' };

let counter = 0;

/** 합성 노드 id 번호를 처음부터 다시 매긴다 (같은 입력 → 같은 id) */
export function resetIds(start = 0): void {
	counter = start;
}

export interface NodeOptions {
	name?: string;
	visible?: boolean;
	opacity?: number;
	fills?: ExportedPaint[];
	strokes?: ExportedPaint[];
	strokeWeight?: number | null;
	clipsContent?: boolean;
	children?: ExportedNode[];
	component?: ExportedNode['component'];
	shadow?: boolean;
	id?: string;
}

export function node(type: string, box: Box, options: NodeOptions = {}): ExportedNode {
	counter++;
	return {
		id: options.id ?? `9:${counter}`,
		name: options.name ?? `${type === 'TEXT' ? 'Text' : type[0] + type.slice(1).toLowerCase()} ${counter}`,
		type,
		visible: options.visible ?? true,
		opacity: options.opacity ?? 1,
		box,
		renderBox: options.visible === false ? null : box,
		rotation: 0,
		clipsContent: options.clipsContent ?? false,
		fills: options.fills ?? [],
		strokes: options.strokes ?? [],
		strokeWeight: options.strokeWeight ?? (options.strokes === undefined ? 0 : 1),
		strokeAlign: options.strokes === undefined ? null : 'INSIDE',
		cornerRadius: null,
		effects: options.shadow
			? [
					{
						type: 'DROP_SHADOW',
						visible: true,
						radius: 20,
						color: { r: 0, g: 0, b: 0, a: 0.5 },
						offset: { x: 0, y: 4 }
					}
				]
			: [],
		layout: null,
		component: options.component ?? null,
		text: null,
		reactions: [],
		children: options.children ?? []
	};
}

export function text(
	characters: string,
	box: Box,
	style: { size?: number; weight?: number; color?: Rgba; family?: string } = {},
	options: NodeOptions = {}
): ExportedNode {
	const n = node('TEXT', box, { name: characters, ...options });
	n.text = {
		characters,
		segments: [
			{
				start: 0,
				end: characters.length,
				fontFamily: style.family ?? 'LG Smart UI',
				fontStyle: (style.weight ?? 400) >= 600 ? 'Bold' : 'Regular',
				fontWeight: style.weight ?? 400,
				fontSize: style.size ?? 24,
				lineHeight: { unit: 'AUTO' },
				letterSpacing: { unit: 'PIXELS', value: 0 },
				textDecoration: 'NONE',
				textCase: 'ORIGINAL',
				fills: [solid(...rgb(style.color ?? { r: 1, g: 1, b: 1, a: 1 }))]
			}
		],
		alignHorizontal: 'LEFT',
		alignVertical: 'TOP',
		autoResize: 'WIDTH_AND_HEIGHT',
		truncation: 'DISABLED',
		maxLines: null
	};
	return n;
}

const rgb = (c: Rgba): [number, number, number, number] => [c.r, c.g, c.b, c.a];

/** 프레임 원점 (Figma 캔버스 위 위치, 정규화하면 0,0이 된다) */
const OX = 5000;
const OY = 2000;
const at = (x: number, y: number, width: number, height: number): Box => ({ x: OX + x, y: OY + y, width, height });

function shelfCard(i: number, x: number, y: number): ExportedNode {
	return node('FRAME', at(x, y, 320, 180), {
		clipsContent: true,
		children: [
			node('RECTANGLE', at(x, y, 320, 180), { fills: [IMAGE] }),
			text('Sample title', at(x + 16, y + 130, 200, 30), { size: 24 }),
			node('FRAME', at(x + 16, y + 160, 100, 20), {
				visible: false,
				children: [text('Subtitle', at(x + 16, y + 160, 100, 20), { size: 18 })]
			})
		],
		id: `9:card${i}`
	});
}

function top10Item(i: number, focused: boolean): ExportedNode {
	const x = 96 + i * 472;
	const y = 640;
	const w = focused ? 440 : 400;
	const h = focused ? 286 : 275;
	const cardChildren = [
		node('RECTANGLE', at(x + 48, y, w, h), { fills: [IMAGE] }),
		text('Sample place', at(x + 64, y + h - 50, 240, 34), { size: 28, weight: 600 })
	];
	if (focused) {
		cardChildren.push(node('RECTANGLE', at(x + 48, y, w, h), { name: 'Line', strokes: [WHITE], strokeWeight: 4 }));
	}
	return node('GROUP', at(x, y, 48 + w, h), {
		id: `9:top${i}`,
		children: [
			text(String(i + 1), at(x, y + h - 120, 48, 120), { size: 96, weight: 700 }),
			node('FRAME', at(x + 48, y, w, h), { clipsContent: true, children: cardChildren, id: `9:top${i}card` })
		]
	});
}

/** 합성 GUI 프레임: Top 10 첫 카드에 포커스 (1.1배 + 흰 4px 테두리) */
export function sampleHomeFrame(): ExportedFrame {
	counter = 0;
	const gnb = node('INSTANCE', at(0, 0, 1920, 120), {
		name: 'GNB_bar',
		component: { name: 'GNB_bar', setName: null, properties: {} },
		children: ['Home', 'Search', 'My'].map((label, i) => text(label, at(96 + i * 200, 40, 160, 40), { size: 32 }))
	});
	const shelfTitle = text('Popular now', at(96, 160, 400, 40), { size: 36, weight: 600 });
	const shelfRow = node('FRAME', at(96, 220, 2400, 180), {
		children: Array.from({ length: 7 }, (_, i) => shelfCard(i, 96 + i * 344, 220))
	});
	const top10Title = text('Top 10', at(96, 580, 300, 40), { size: 36, weight: 600 });
	const top10Row = node('FRAME', at(96, 640, 4600, 286), {
		children: Array.from({ length: 10 }, (_, i) => top10Item(i, i === 0))
	});
	const promo = node('FRAME', at(96, 940, 1728, 400), {
		name: 'Promo_card',
		fills: [solid(0.1, 0.1, 0.2)],
		children: [
			text('Promo headline', at(160, 960, 900, 40), { size: 32, weight: 700 }),
			node('INSTANCE', at(160, 1004, 240, 64), {
				name: 'Btn_main(New)',
				component: { name: 'State=Default', setName: 'Btn_main(New)', properties: { State: 'Default' } },
				children: [text('Watch now', at(190, 1019, 180, 34), { size: 28 })]
			})
		]
	});
	const memo = text('디자이너 메모', at(0, 1500, 400, 40), { size: 20 });
	return {
		pageId: '0:1',
		pageName: 'GUI',
		node: node('FRAME', at(0, 0, 1920, 1080), {
			name: 'Home Focus 01',
			id: '9:root',
			clipsContent: true,
			fills: [solid(0, 0, 0)],
			children: [gnb, shelfTitle, shelfRow, top10Title, top10Row, promo, memo]
		}),
		image: null
	};
}

/**
 * 합성 검색 GUI 프레임 (D-033). 포커스를 컴포넌트 변형 이름(`status=focused`)으로 표시하는 디자인이다.
 * - 왼쪽 메뉴: 현재 메뉴만 `selected` 변형 + 색 칠 (포커스 아님)
 * - 검색창: `status=Typing` (입력 상태)
 * - 탭 4개: 글자 길이에 따라 폭이 다르다. focusedTabs의 탭만 `status=focused` 변형(흰 칠 + 체크 아이콘), 마지막 탭은 `status=unfocused`
 * - 카드 5개: 아래에 "NETFLIX · 1.5M views · 2 month ago" 글자 줄(폭이 서로 다름). 마지막 카드는 화면 오른쪽에 걸치고 흐림 레이어가 있다
 */
export function sampleSearchFrame(focusedTabs: readonly number[] = [0]): ExportedFrame {
	counter = 0;
	const variant = (setName: string | null, name: string): NodeOptions['component'] => ({
		name,
		setName,
		properties: {}
	});
	const menu = node('FRAME', at(25, 352, 79, 279), {
		name: 'menu',
		children: ['Home', 'Search', 'My'].map((label, i) =>
			node('INSTANCE', at(25, 352 + i * 100, 79, 79), {
				name: 'menu_btn',
				component: variant('menu_btn', i === 1 ? 'Property 1=selected' : 'Property 1=default'),
				children: [
					...(i === 1
						? [node('RECTANGLE', at(25, 352 + i * 100, 79, 79), { fills: [solid(0, 1, 0.8)] })]
						: []),
					node('VECTOR', at(45, 372 + i * 100, 39, 39), { name: `icon ${label}`, fills: [WHITE] })
				]
			})
		)
	});
	const search = node('INSTANCE', at(600, 54, 720, 66), {
		name: 'search form',
		component: variant('search form', 'status=Typing'),
		fills: [solid(0.18, 0.2, 0.22)],
		children: [text('Search here', at(677, 69, 400, 35), { size: 28 })]
	});
	const widths = [176, 172, 182, 152];
	let x = 118;
	const tabs = widths.map((w, i) => {
		const focused = focusedTabs.includes(i);
		const label = ['All', 'Driving', 'Walking', 'Place'][i] ?? '';
		const tab = node('INSTANCE', at(x, 198, w, 63), {
			name: 'btn_keyword',
			component: variant(
				'btn_keyword',
				focused
					? 'Type=category, status=focused'
					: i === 3
						? 'Type=category, status=unfocused'
						: 'Type=category, status=default'
			),
			...(focused
				? { fills: [solid(0.9, 0.9, 0.9)] }
				: { strokes: [solid(0.9, 0.9, 0.9, 0.3)], strokeWeight: 2 }),
			children: [
				...(focused
					? [
							node('INSTANCE', at(x + 18, 210, 39, 39), {
								name: 'btn_keyword/icn_selected_focused',
								component: variant(null, 'btn_keyword/icn_selected_focused'),
								children: [
									node('VECTOR', at(x + 24, 220, 27, 19), {
										name: 'shape',
										fills: [solid(0.2, 0.2, 0.2)]
									})
								]
							})
						]
					: []),
				text(label, at(x + (focused ? 62 : 24), 213, w - 80, 32), { size: 26 })
			]
		});
		x += w + 18;
		return tab;
	});
	const meta = [
		['NETFLIX', 88],
		['1.5M views', 111],
		['2 month ago', 167]
	] as const;
	const cards = node('FRAME', at(180, 324, 2200, 307), {
		name: 'cards',
		children: Array.from({ length: 5 }, (_, i) => {
			const cx = 180 + i * 427;
			let mx = cx;
			return node('FRAME', at(cx, 324, 403, 307), {
				name: `card${i + 1}`,
				children: [
					node('RECTANGLE', at(cx, 324, 403, 227), { name: 'Poster', fills: [IMAGE] }),
					...(i === 4
						? [node('RECTANGLE', at(cx, 324, 403, 227), { name: 'Line', fills: [solid(0, 0, 0, 0.6)] })]
						: []),
					text('Sample place', at(cx, 560, 300, 32), { size: 26 }),
					node('FRAME', at(cx, 603, 400, 28), {
						name: 'meta',
						children: meta.map(([label, w]) => {
							// 카드마다 글자 폭이 조금씩 다르다 (내용 길이)
							const t = text(label, at(mx, 603, w + (i % 2) * 40, 28), { size: 20 });
							mx += w + 20;
							return t;
						})
					})
				]
			});
		})
	});
	return {
		pageId: '0:2',
		pageName: 'GUI',
		node: node('FRAME', at(0, 0, 1920, 1080), {
			name: '9.1 Sample_검색 결과',
			id: '9:search',
			clipsContent: true,
			fills: [solid(0, 0, 0)],
			children: [menu, search, node('FRAME', at(118, 198, 800, 63), { name: 'tabs', children: tabs }), cards]
		}),
		image: null
	};
}

/** 합성 화면설계서 프레임 (1920×1440 문서 페이지) */
export function sampleSpecFrame(): ExportedFrame {
	counter = 100;
	return {
		pageId: '0:2',
		pageName: 'UX',
		node: node(
			'FRAME',
			{ x: 0, y: 0, width: 1920, height: 1440 },
			{
				name: 'Spec page',
				id: '9:spec',
				children: [
					text('1.1. Sample Screen - 최초 진입 시', { x: 80, y: 60, width: 900, height: 50 }, { size: 36 }),
					node('FRAME', { x: 80, y: 160, width: 1200, height: 675 }, { name: 'mockup' })
				]
			}
		),
		image: null
	};
}

export function sampleExport(frames: ExportedFrame[] = [sampleHomeFrame()]): FigmaExport {
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: '2026-11-26T00:00:00.000Z',
		plugin: { version: '0.1.0' },
		file: { name: 'sample', key: null },
		frames,
		warnings: []
	};
}
