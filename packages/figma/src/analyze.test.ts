import { describe, expect, it } from 'vitest';
import { analyzeExport, analyzeFrame, classifyFrame } from './analyze';
import { ExportFormatError, parseExport } from './exportFormat';
import { estimateFocus } from './focus';
import { normalizeFrame } from './normalize';
import { findRepeatGroups, multisetJaccard, multisetOverlap } from './repeat';
import { IMAGE, WHITE, node, sampleExport, sampleHomeFrame, sampleSpecFrame, solid } from './testing';
import type { ExportedNode } from './exportFormat';

const analysis = analyzeFrame(sampleHomeFrame());
const frame = analysis.frame;
const groupOf = (id: string) => analysis.groups.find((g) => g.memberIds.includes(id));

describe('parseExport', () => {
	it('형식·버전·노드 필수 필드를 확인한다', () => {
		expect(parseExport(JSON.parse(JSON.stringify(sampleExport()))).frames).toHaveLength(1);
		expect(() => parseExport({ format: 'other' })).toThrow(ExportFormatError);
		expect(() => parseExport({ ...sampleExport(), version: 2 })).toThrow('버전');
		const broken = JSON.parse(JSON.stringify(sampleExport()));
		delete broken.frames[0].node.children[0].visible;
		expect(() => parseExport(broken)).toThrow('frames[0].node.children[0].visible');
	});
});

describe('classifyFrame', () => {
	it('화면 크기면 GUI, 화면 ID 글자가 있으면 화면설계서', () => {
		expect(analysis.kind).toBe('gui');
		const spec = analyzeFrame(sampleSpecFrame());
		expect(spec.kind).toBe('spec');
		expect(spec.kindReason).toContain('1.1. Sample Screen');
		const other = normalizeFrame({ ...sampleSpecFrame(), node: { ...sampleSpecFrame().node, children: [] } });
		expect(classifyFrame(other).kind).toBe('unknown');
	});
});

describe('findRepeatGroups', () => {
	it('형제 중 비슷한 것을 묶는다 (포커스로 커진 카드·테두리 레이어가 있어도 같은 묶음)', () => {
		const shelf = groupOf('9:card0');
		expect(shelf?.memberIds).toHaveLength(7);
		expect(shelf).toMatchObject({ axis: 'row', gap: 24, shownCount: 6 });
		const top10 = groupOf('9:top0');
		expect(top10?.memberIds).toHaveLength(10);
		expect(top10?.memberIds).toContain('9:top1');
		expect(top10?.axis).toBe('row');
	});

	it('숨김 요소는 묶지 않고, 크기·구조가 다른 형제는 따로 둔다', () => {
		const hiddenIds = frame.elements.filter((e) => e.hidden).map((e) => e.id);
		for (const g of analysis.groups) for (const id of hiddenIds) expect(g.memberIds).not.toContain(id);
		const promo = frame.elements.find((e) => e.name === 'Promo_card');
		expect(groupOf(promo?.id ?? '')).toBeUndefined();
	});

	it('다중집합 Jaccard·포함도', () => {
		expect(multisetJaccard(new Map([['A', 2]]), new Map([['A', 1]]))).toBe(0.5);
		expect(multisetJaccard(new Map(), new Map())).toBe(1);
		const plain = new Map([
			['RECTANGLE@1', 1],
			['TEXT@1', 1]
		]);
		const focused = new Map([
			['RECTANGLE@1', 2],
			['TEXT@1', 1]
		]);
		expect(multisetJaccard(plain, focused)).toBeCloseTo(0.667, 3);
		expect(multisetOverlap(plain, focused)).toBe(1);
		expect(multisetOverlap(new Map(), plain)).toBe(0);
	});

	it('자식이 적은 카드도 테두리 레이어가 더해진 멤버를 같은 묶음에 넣는다 (포함도)', () => {
		const make = (extra: boolean) =>
			node(
				'FRAME',
				{ x: 0, y: 0, width: 400, height: 225 },
				{
					children: [
						node('RECTANGLE', { x: 0, y: 0, width: 400, height: 225 }),
						node('TEXT', { x: 0, y: 0, width: 100, height: 20 }),
						...(extra
							? [node('RECTANGLE', { x: 0, y: 0, width: 400, height: 225 }, { strokes: [WHITE] })]
							: [])
					]
				}
			);
		const cards = [make(true), make(false), make(false)];
		cards.forEach((c, i) => {
			c.box = { x: i * 420, y: 0, width: 400, height: 225 };
		});
		const f = normalizeFrame({
			pageId: 'p',
			pageName: 'p',
			image: null,
			node: node('FRAME', { x: 0, y: 0, width: 1920, height: 1080 }, { children: cards })
		});
		expect(findRepeatGroups(f)[0]?.memberIds).toHaveLength(3);
		// 구조가 다른 형제(텍스트 3개짜리)는 포함도가 높아도 Jaccard가 너무 낮으면 따로
		const other = node(
			'FRAME',
			{ x: 0, y: 0, width: 400, height: 225 },
			{
				children: [
					node('TEXT', { x: 0, y: 0, width: 1, height: 1 }),
					node('TEXT', { x: 0, y: 0, width: 1, height: 1 }),
					node('TEXT', { x: 0, y: 0, width: 1, height: 1 }),
					node('RECTANGLE', { x: 0, y: 0, width: 1, height: 1 }),
					node('ELLIPSE', { x: 0, y: 0, width: 1, height: 1 })
				]
			}
		);
		const g = normalizeFrame({
			pageId: 'p',
			pageName: 'p',
			image: null,
			node: node('FRAME', { x: 0, y: 0, width: 1920, height: 1080 }, { children: [make(false), other] })
		});
		expect(findRepeatGroups(g).filter((x) => x.parentId === g.elements[0]?.id)).toHaveLength(0);
	});
});

describe('estimateFocus', () => {
	it('형제 대비 커지고 테두리 레이어가 있는 멤버를 포커스로 추정하고 기대 스타일을 뽑는다', () => {
		const { primary, ambiguous } = analysis.focus;
		expect(primary?.memberId).toBe('9:top0');
		expect(ambiguous).toBe(false);
		expect(primary?.style.scale).toEqual({ x: 1.1, y: 1.04 });
		expect(primary?.style.border).toEqual({ color: { hex: '#FFFFFF', alpha: 1 }, weight: 4 });
		expect(primary?.score).toBeGreaterThanOrEqual(0.8);
		expect(primary?.evidence.join('\n')).toContain('테두리 레이어 추가: "Line"');
	});

	it('똑같은 멤버만 있는 묶음에서는 후보가 없고, 멤버 2개 묶음은 건너뛴다', () => {
		expect(analysis.focus.candidates.map((c) => c.groupId)).toEqual([groupOf('9:top0')?.id]);
		expect(analysis.focus.skipped.some((s) => s.reason.includes('멤버 2개'))).toBe(true);
	});

	it('비슷한 점수의 다른 후보가 있으면 "확인 필요"', () => {
		// 위 셸프 첫 카드에도 흰 테두리 (실제 GUI의 Q7 상황) + 확대까지 있으면 1위와 비슷해진다
		const exported = sampleHomeFrame();
		const card0 = findNode(exported.node, '9:card0');
		const grown = { ...boxOf(card0), width: 352, height: 198 };
		card0.box = grown;
		card0.children.push(node('RECTANGLE', grown, { name: 'Line', strokes: [WHITE], strokeWeight: 4 }));
		const f = normalizeFrame(exported);
		const est = estimateFocus(f, findRepeatGroups(f));
		expect(est.candidates.map((c) => c.memberId).sort()).toEqual(['9:card0', '9:top0']);
		expect(est.ambiguous).toBe(true);
	});

	it('테두리만 있고 확대가 없는 멤버는 낮은 점수의 보조 후보', () => {
		const exported = sampleHomeFrame();
		const card0 = findNode(exported.node, '9:card0');
		card0.children.push(node('RECTANGLE', boxOf(card0), { name: 'Line', strokes: [WHITE], strokeWeight: 4 }));
		const f = normalizeFrame(exported);
		const est = estimateFocus(f, findRepeatGroups(f));
		expect(est.primary?.memberId).toBe('9:top0');
		expect(est.candidates[1]).toMatchObject({ memberId: '9:card0', score: 0.4 });
		expect(est.ambiguous).toBe(false);
	});

	it('포커스되지 않은 멤버에만 덮개(dim)가 있으면, 덮개가 없는 멤버를 포커스로 본다', () => {
		const cards = [0, 1, 2, 3].map((i) =>
			node(
				'FRAME',
				{ x: i * 420, y: 0, width: 400, height: 225 },
				{
					id: `dim${i}`,
					children: [
						node('RECTANGLE', { x: i * 420, y: 0, width: 400, height: 225 }, { fills: [IMAGE] }),
						...(i === 2
							? []
							: [
									node(
										'RECTANGLE',
										{ x: i * 420, y: 0, width: 400, height: 225 },
										{ name: 'dim', fills: [solid(0, 0, 0, 1, 0.6)] }
									)
								])
					]
				}
			)
		);
		const f = normalizeFrame({
			pageId: 'p',
			pageName: 'p',
			image: null,
			node: node('FRAME', { x: 0, y: 0, width: 1920, height: 1080 }, { children: cards })
		});
		const est = estimateFocus(f, findRepeatGroups(f));
		expect(est.primary?.memberId).toBe('dim2');
		expect(est.primary?.evidence[0]).toContain('덮개 레이어 없음: "dim"');
	});

	it('GUI가 아닌 프레임은 포커스를 추정하지 않는다', () => {
		expect(analyzeFrame(sampleSpecFrame()).focus.primary).toBeNull();
	});
});

describe('글자 분류·앵커', () => {
	const cls = (characters: string) =>
		analysis.textClasses.get(frame.elements.find((e) => e.text?.characters === characters)?.id ?? '')?.class;

	it('반복 카드 안 글자는 예시 데이터, 순번 숫자는 ordinal, 나머지와 컴포넌트 안 글자는 fixed', () => {
		expect(cls('Sample title')).toBe('data');
		expect(cls('Sample place')).toBe('data');
		expect(cls('1')).toBe('ordinal');
		expect(cls('10')).toBe('ordinal');
		expect(cls('Popular now')).toBe('fixed');
		expect(cls('Home')).toBe('fixed');
		expect(cls('Watch now')).toBe('fixed');
	});

	it('보이는 요소 중 의미 있는 이름·컴포넌트·고정 글자·순번을 앵커로 쓴다', () => {
		const labels = analysis.anchors.map((a) => `${a.reason}:${a.label}`);
		expect(labels).toEqual(
			expect.arrayContaining([
				'component:GNB_bar',
				'fixed-text:Popular now',
				'fixed-text:Top 10',
				'ordinal:1',
				'name:Promo_card',
				'component:Btn_main(New)'
			])
		);
		expect(labels).not.toContain('fixed-text:디자이너 메모'); // 경계 밖
		expect(labels).not.toContain('ordinal:10'); // 경계 밖
		expect(labels.some((l) => l.includes('Line'))).toBe(false); // 일반명
	});

	it('개수를 센다', () => {
		expect(analysis.counts.hidden).toBe(14);
		expect(analysis.counts.clipped).toBeGreaterThan(0);
		expect(analysis.counts.total).toBe(frame.elements.length);
	});
});

describe('analyzeExport', () => {
	it('프레임마다 분석하고, 같은 입력이면 같은 결과', () => {
		const data = sampleExport([sampleHomeFrame(), sampleSpecFrame()]);
		expect(analyzeExport(data).map((a) => a.kind)).toEqual(['gui', 'spec']);
		expect(analyzeExport(data)).toEqual(analyzeExport(sampleExport([sampleHomeFrame(), sampleSpecFrame()])));
	});
});

function boxOf(n: ExportedNode): NonNullable<ExportedNode['box']> {
	if (n.box === null) throw new Error(`box 없음: ${n.id}`);
	return n.box;
}

function findNode(root: ExportedNode, id: string): ExportedNode {
	if (root.id === id) return root;
	for (const c of root.children) {
		try {
			return findNode(c, id);
		} catch {
			// 다음 자식
		}
	}
	throw new Error(`노드 없음: ${id}`);
}
