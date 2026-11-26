import { analyzeFrame, parseExport } from '@auto-qa/figma';
import { EXPORT_FORMAT, EXPORT_VERSION } from '@auto-qa/figma/format';
import { describe, expect, it } from 'vitest';
import { pageOf, serializeNode } from './serialize';
import type { SerializeContext } from './serialize';
import { fileNameFor, toBase64 } from './ui';

/** Figma 노드 흉내 (필요한 필드만) */
const MIXED = Symbol('mixed');
type Fake = Record<string, unknown> & { children?: Fake[]; parent?: Fake | null };

function fake(type: string, props: Record<string, unknown>, children: Fake[] = []): Fake {
	const n: Fake = { type, visible: true, opacity: 1, rotation: 0, effects: [], ...props };
	if (['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT', 'PAGE'].includes(type)) n.children = children;
	for (const c of children) c.parent = n;
	return n;
}

const bounds = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const white = { type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1 } };

function textNode(id: string, characters: string, x: number, y: number, extra: Record<string, unknown> = {}): Fake {
	return fake('TEXT', {
		id,
		name: characters,
		characters,
		absoluteBoundingBox: bounds(x, y, 200, 40),
		absoluteRenderBounds: bounds(x, y, 200, 40),
		fills: [white],
		textAlignHorizontal: 'LEFT',
		textAlignVertical: 'CENTER',
		textAutoResize: 'NONE',
		textTruncation: 'ENDING',
		maxLines: 1,
		getStyledTextSegments: () => [
			{
				start: 0,
				end: characters.length,
				fontName: { family: 'LG Smart UI', style: 'Bold' },
				fontSize: 32,
				fontWeight: 700,
				lineHeight: { unit: 'PIXELS', value: 40 },
				letterSpacing: { unit: 'PERCENT', value: -1 },
				textDecoration: 'NONE',
				textCase: 'ORIGINAL',
				fills: [white]
			}
		],
		...extra
	});
}

function card(i: number, focused: boolean): Fake {
	const x = 1000 + 100 + i * 424;
	const w = focused ? 440 : 400;
	const h = focused ? 248 : 225;
	const children = [
		fake('RECTANGLE', {
			id: `c${i}-img`,
			name: `Rectangle ${i}`,
			absoluteBoundingBox: bounds(x, 500, w, h),
			fills: [{ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL', imageHash: 'x' }],
			strokes: [],
			strokeWeight: 0,
			cornerRadius: 12
		}),
		textNode(`c${i}-t`, 'Example', x + 16, 500 + h - 56)
	];
	if (focused) {
		children.push(
			fake('RECTANGLE', {
				id: `c${i}-line`,
				name: 'Line',
				absoluteBoundingBox: bounds(x, 500, w, h),
				fills: [],
				strokes: [white],
				strokeWeight: 4,
				strokeAlign: 'INSIDE',
				cornerRadius: MIXED,
				topLeftRadius: 12,
				topRightRadius: 12,
				bottomRightRadius: 0,
				bottomLeftRadius: 0
			})
		);
	}
	return fake(
		'FRAME',
		{
			id: `c${i}`,
			name: `Frame 20856706${i}`,
			absoluteBoundingBox: bounds(x, 500, w, h),
			clipsContent: true,
			fills: [],
			strokes: [],
			strokeWeight: MIXED,
			layoutMode: 'NONE'
		},
		children
	);
}

function screen(): Fake {
	const button = fake(
		'INSTANCE',
		{
			id: 'btn',
			name: 'Btn_main(New)',
			absoluteBoundingBox: bounds(1100, 900, 240, 64),
			fills: [white],
			strokes: [],
			layoutMode: 'HORIZONTAL',
			itemSpacing: 8,
			paddingTop: 12,
			paddingRight: 24,
			paddingBottom: 12,
			paddingLeft: 24,
			primaryAxisAlignItems: 'CENTER',
			counterAxisAlignItems: 'CENTER',
			componentProperties: {
				State: { type: 'VARIANT', value: 'Focused' },
				'Label#12:0': { type: 'TEXT', value: 'Watch now' },
				'Icon#13:1': { type: 'BOOLEAN', value: false }
			},
			getMainComponentAsync: async () => ({
				name: 'State=Focused',
				parent: { type: 'COMPONENT_SET', name: 'Btn_main' }
			}),
			reactions: [
				{
					trigger: { type: 'ON_KEY_DOWN' },
					actions: [{ type: 'NODE', destinationId: '5:1', navigation: 'NAVIGATE' }]
				},
				{ trigger: { type: 'ON_CLICK' }, action: { type: 'BACK' } }
			]
		},
		[textNode('btn-t', 'Watch now', 1124, 912, { fills: MIXED })]
	);
	const broken = textNode('broken', 'Broken', 1100, 1000, {
		getStyledTextSegments: () => {
			throw new Error('글꼴 없음');
		}
	});
	const root = fake(
		'FRAME',
		{
			id: 'root',
			name: 'Top 10 01',
			absoluteBoundingBox: bounds(1000, 0, 1920, 1080),
			absoluteRenderBounds: bounds(1000, 0, 1920, 1080),
			clipsContent: true,
			fills: [{ ...white, color: { r: 0, g: 0, b: 0 } }],
			strokes: []
		},
		[...[0, 1, 2, 3].map((i) => card(i, i === 0)), button, broken]
	);
	fake('PAGE', { id: '0:1', name: 'GUI' }, [root]);
	return root;
}

describe('serializeNode', () => {
	it('Figma 노드를 내보내기 형식으로 옮긴다', async () => {
		const ctx: SerializeContext = { mixed: MIXED, warnings: [] };
		const out = await serializeNode(screen(), ctx);
		expect(out).toMatchObject({ id: 'root', type: 'FRAME', clipsContent: true, box: bounds(1000, 0, 1920, 1080) });
		expect(out.children).toHaveLength(6);

		const focused = out.children[0];
		expect(focused?.strokeWeight).toBe('mixed');
		expect(focused?.children[0]?.fills[0]).toEqual({ type: 'IMAGE', visible: true, opacity: 1, scaleMode: 'FILL' });
		expect(focused?.children[0]?.cornerRadius).toEqual([12, 12, 12, 12]);
		expect(focused?.children[2]?.cornerRadius).toEqual([12, 12, 0, 0]);

		const text = focused?.children[1]?.text;
		expect(text).toMatchObject({ characters: 'Example', truncation: 'ENDING', maxLines: 1 });
		expect(text?.segments[0]).toMatchObject({
			fontFamily: 'LG Smart UI',
			fontWeight: 700,
			lineHeight: { unit: 'PIXELS', value: 40 },
			letterSpacing: { unit: 'PERCENT', value: -1 }
		});

		const button = out.children[4];
		expect(button?.component).toEqual({
			name: 'State=Focused',
			setName: 'Btn_main',
			properties: { State: 'Focused', Label: 'Watch now', Icon: false }
		});
		expect(button?.layout).toEqual({
			mode: 'HORIZONTAL',
			itemSpacing: 8,
			padding: [12, 24, 12, 24],
			primaryAxisAlign: 'CENTER',
			counterAxisAlign: 'CENTER'
		});
		expect(button?.reactions).toEqual([
			{ trigger: 'ON_KEY_DOWN', action: 'NODE', destinationId: '5:1', navigation: 'NAVIGATE' },
			{ trigger: 'ON_CLICK', action: 'BACK', destinationId: null, navigation: null }
		]);
		expect(button?.children[0]?.fills).toEqual([]); // 구간마다 다른 칠(mixed)
	});

	it('읽지 못한 값은 경고를 남기고 기본값으로 채운다', async () => {
		const ctx: SerializeContext = { mixed: MIXED, warnings: [] };
		const out = await serializeNode(screen(), ctx);
		expect(out.children[5]?.text?.segments).toEqual([]);
		expect(ctx.warnings).toEqual([expect.stringContaining('broken "Broken": 글자 스타일을 읽지 못함')]);
	});

	it('읽을 때 예외가 나는 속성(오류가 있는 컴포넌트 세트)은 비우고 경고를 남긴 뒤 계속한다', async () => {
		const root = screen();
		const button = root.children?.[4];
		if (button === undefined) throw new Error('버튼 없음');
		Object.defineProperty(button, 'componentProperties', {
			get() {
				throw new Error('in get_componentProperties: Component set for node has existing errors');
			}
		});
		const ctx: SerializeContext = { mixed: MIXED, warnings: [] };
		const out = await serializeNode(root, ctx);
		expect(out.children).toHaveLength(6);
		expect(out.children[4]?.component).toEqual({ name: 'State=Focused', setName: 'Btn_main', properties: {} });
		expect(out.children[4]?.children[0]?.text?.characters).toBe('Watch now');
		expect(ctx.warnings).toContainEqual(
			'btn "Btn_main(New)": componentProperties를 읽지 못해 비워 둠 (in get_componentProperties: Component set for node has existing errors)'
		);
	});

	it('한 노드에서 예상하지 못한 오류가 나도 그 노드만 기본값으로 두고 나머지는 내보낸다', async () => {
		const root = screen();
		const card = root.children?.[1];
		if (card === undefined) throw new Error('카드 없음');
		card.children = new Proxy([], {
			get() {
				throw new Error('boom');
			}
		}) as unknown as Fake[];
		const ctx: SerializeContext = { mixed: MIXED, warnings: [] };
		const out = await serializeNode(root, ctx);
		expect(out.children).toHaveLength(6);
		expect(out.children[1]).toMatchObject({ id: 'c1', children: [] });
		expect(ctx.warnings.some((w) => w.startsWith('c1 "Frame 208567061": 노드를 읽지 못해'))).toBe(true);
	});

	it('노드가 속한 페이지를 찾는다', () => {
		const root = screen();
		expect(pageOf(root.children?.[0])).toEqual({ id: '0:1', name: 'GUI' });
		expect(pageOf({ type: 'FRAME', parent: null })).toEqual({ id: '', name: '' });
	});

	it('내보낸 결과는 형식 검사를 통과하고, 정규화하면 포커스 카드를 찾는다', async () => {
		const ctx: SerializeContext = { mixed: MIXED, warnings: [] };
		const root = screen();
		const node = await serializeNode(root, ctx);
		const data = parseExport(
			JSON.parse(
				JSON.stringify({
					format: EXPORT_FORMAT,
					version: EXPORT_VERSION,
					exportedAt: '2026-11-26T00:00:00.000Z',
					plugin: { version: '0.1.0' },
					file: { name: 'test', key: null },
					frames: [{ pageId: '0:1', pageName: 'GUI', node, image: null }],
					warnings: ctx.warnings
				})
			)
		);
		const frame = data.frames[0];
		if (frame === undefined) throw new Error('프레임 없음');
		const analysis = analyzeFrame(frame);
		expect(analysis.kind).toBe('gui');
		expect(analysis.focus.primary?.memberId).toBe('c0');
		expect(analysis.focus.primary?.style).toMatchObject({ scale: { x: 1.1, y: 1.102 }, border: { weight: 4 } });
	});
});

describe('UI 도우미', () => {
	it('PNG 바이트를 base64로, 파일 이름은 안전한 글자로', () => {
		expect(toBase64(new Uint8Array([137, 80, 78, 71]))).toBe('iVBORw==');
		const big = new Uint8Array(100_000).fill(65);
		expect(Buffer.from(toBase64(big), 'base64').equals(Buffer.from(big))).toBe(true);
		expect(
			fileNameFor({
				format: EXPORT_FORMAT,
				version: EXPORT_VERSION,
				exportedAt: '2026-11-26T01:02:03.000Z',
				plugin: { version: '0' },
				file: { name: 'TV 앱/GUI: v2', key: null },
				frames: [],
				warnings: []
			})
		).toBe('TV_앱_GUI_v2-auto-qa-20261126T010203.json');
	});
});
