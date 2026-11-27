import { normalizeFrame } from '@auto-qa/figma';
import { extractSpecScreen, mergeSpecScreens } from '@auto-qa/spec';
import { sampleSpecPage } from '@auto-qa/spec/testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYMAP_OPTIONS, buildKeyMap, describeEffect, nameTokens, parseKeyAction } from './keymap';
import type { NavCallout, NavScreen } from './keymap';
import { DEFAULT_ROUTE_OPTIONS, planRoute } from './route';
import { navScreenFromSpec } from './spec';

const MEMORY = ' (이동한 이력이 있을 경우: 마지막 포커스한 콘텐츠에 이동)';

/** 합성 검색 화면: ① 검색창, ② 추천 단어(이름은 영어), ③ 인기 목록, ④ 주간 도시, ⑤ 필터 메뉴 */
function sampleScreen(): NavScreen {
	const c = (no: string, name: string, rect: NavCallout['rect'], keys: NavCallout['keys']): NavCallout => ({
		no,
		names: [name],
		texts: [],
		rect,
		keys
	});
	return {
		screenId: '9.1',
		title: '합성 검색',
		callouts: [
			c(
				'1',
				'Search box 영역',
				{ x: 300, y: 100, width: 1000, height: 80 },
				{
					up: '동작 없음',
					down: '추천 단어 좌측 첫 번째 항목으로 이동',
					left: 'GNB 확장',
					right: '우측 필터 메뉴에 포커스'
				}
			),
			c(
				'2',
				'Suggested Words',
				{ x: 300, y: 250, width: 1300, height: 60 },
				{
					up: '“Search box 버튼 포커스',
					down: `Top Picks 영역 좌측 첫 번째 콘텐츠에 포커스${MEMORY}`,
					left: 'GNB 확장',
					right: '다음 항목으로 이동'
				}
			),
			c(
				'3',
				'Top Picks',
				{ x: 300, y: 400, width: 1500, height: 300 },
				{
					up: `Suggested Words 좌측 첫 번째 버튼 포커스${MEMORY}`,
					down: 'Weekly Cities 영역 좌측 첫 번째 항목에 포커스',
					left: 'GNB 확장',
					right: '다음 콘텐츠 노출'
				}
			),
			c(
				'4',
				'Weekly Cities',
				{ x: 300, y: 760, width: 1500, height: 300 },
				{
					up: `Top Picks 좌측 첫 번째 항목에 포커스${MEMORY}`,
					down: '동작 없음',
					left: 'GNB 확장',
					right: '다음 콘텐츠 노출 (더 이상 이동할 항목이 없을 경우 동작 없음)'
				}
			),
			c(
				'5',
				'Filter Option 메뉴',
				{ x: 1400, y: 100, width: 200, height: 80 },
				{
					up: '동작 없음',
					down: '추천 단어 좌측 첫 번째 항목으로 이동',
					left: '“Search box 버튼 포커스',
					right: '동작 없음'
				}
			)
		]
	};
}

function effects(screen: NavScreen): Record<string, string> {
	const out: Record<string, string> = {};
	for (const a of buildKeyMap(screen)) out[`${a.from}:${a.key}`] = describeEffect(a.effect);
	return out;
}

describe('키 동작 해석', () => {
	it('낱말에서 조사와 일반 낱말을 뺀다', () => {
		expect(nameTokens('Travel Now 영역 좌측 첫 번째 콘텐츠에 포커스')).toEqual(['travel', 'now']);
		expect(nameTokens('주간 인기 도시의')).toEqual(['주간', '인기', '도시']);
	});

	it('동작 없음·화면 밖·다음 항목·이름·이력 조건을 구분한다', () => {
		const e = effects(sampleScreen());
		expect(e['1:up']).toBe('none');
		expect(e['1:left']).toBe('leave:GNB');
		expect(e['2:right']).toBe('next');
		expect(e['2:up']).toBe('move:1:first'); // 짝이 안 맞는 따옴표
		expect(e['2:down']).toBe('move:3:first+memory');
		expect(e['3:down']).toBe('move:4:first');
		expect(e['4:right']).toBe('next');
	});

	it('키 방향과 같은 방향의 옆·아래 항목은 같은 목록 안 이동이다 (그리드)', () => {
		const screen = sampleScreen();
		const grid = screen.callouts[2];
		if (grid === undefined) throw new Error('콜아웃 없음');
		const parse = (key: 'up' | 'down' | 'left' | 'right', text: string): string =>
			describeEffect(parseKeyAction(grid, key, text, screen.callouts).effect);
		expect(parse('right', '우측 콘텐츠로 이동 (더 이상 이동할 항목이 없을 경우 동작 없음)')).toBe('next');
		expect(parse('down', '아래 콘텐츠로 이동')).toBe('row-next');
		expect(parse('up', '위쪽 항목으로 이동')).toBe('row-prev');
		// 키 방향의 다른 영역은 그 방향에서 가장 가까운 콜아웃 (문장이 방향으로 가리킴 — 추정 아님)
		const area = parseKeyAction(grid, 'down', '아래 쉘프 영역 마지막 포커스로 이동', screen.callouts);
		expect(describeEffect(area.effect)).toBe('move:4:first+memory');
		expect(area.estimate).toBeNull();
		// 방향이 키와 다르면 같은 목록 안 이동이 아니다
		expect(parse('down', '좌측 상단 첫 번째 콘텐츠 포커스')).not.toBe('row-next');
		expect(parse('up', '위 쉘프 영역 마지막 포커스로 이동')).not.toBe('row-prev');
	});

	it('이름 없이 "첫 번째 콘텐츠"만 말하면 키 방향에서 가장 가까운 콜아웃의 첫 항목이다', () => {
		const screen = sampleScreen();
		const from = screen.callouts[1];
		if (from === undefined) throw new Error('콜아웃 없음');
		const first = parseKeyAction(from, 'down', '좌측 상단 첫 번째 콘텐츠 포커스', screen.callouts);
		expect(describeEffect(first.effect)).toBe('move:3:first');
		expect(first.estimate).toBeNull();
		// 이름이 있으면 이름이 먼저
		expect(describeEffect(parseKeyAction(from, 'down', 'Weekly Cities 첫 번째 항목', screen.callouts).effect)).toBe(
			'move:4:first'
		);
		// 항목 낱말 없이 "첫 번째"만이면 정하지 않는다
		expect(parseKeyAction(from, 'down', '첫 번째 버튼 포커스', screen.callouts).effect.kind).not.toBe('move');
	});

	it('이름이 일부만 맞으면 키 방향이 맞을 때만 정한다', () => {
		const e = effects(sampleScreen());
		// "필터 메뉴" ↔ "Filter Option 메뉴": 이름 0.4 + 방향(오른쪽) 0.2
		expect(e['1:right']).toBe('move:5:first');
	});

	it('이름을 못 맞히면 추측하지 않고, 키 방향 후보는 따로 붙인다', () => {
		const map = buildKeyMap(sampleScreen());
		const down = map.find((a) => a.from === '1' && a.key === 'down');
		expect(down && describeEffect(down.effect)).toBe('element:추천 단어');
		expect(down?.estimate?.to).toBe('2');
		const fromMenu = map.find((a) => a.from === '5' && a.key === 'down');
		expect(fromMenu?.estimate?.to).toBe('2');
	});

	it('사람이 정한 다른 이름을 쓰면 이름으로 정한다', () => {
		const map = buildKeyMap(sampleScreen(), {
			...DEFAULT_KEYMAP_OPTIONS,
			aliases: { 'Suggested Words': ['추천 단어'] }
		});
		const down = map.find((a) => a.from === '1' && a.key === 'down');
		expect(down && describeEffect(down.effect)).toBe('move:2:first');
		expect(down?.estimate).toBeNull();
		const r = planRoute(map, { callout: '1', position: 1 }, { callout: '2', position: 3 }, ['OK']);
		expect(r.ok && r.estimated).toBe(false);
	});

	it('끝에서 멈춤 조건을 기록한다', () => {
		const right = buildKeyMap(sampleScreen()).find((a) => a.from === '4' && a.key === 'right');
		expect(right?.endNoop).toBe(true);
	});

	it('따옴표 안 이름은 같은 콜아웃의 항목이면 다음·이전, 다른 콜아웃의 항목이면 그 항목으로 간다', () => {
		const tabs: NavCallout = {
			no: '2',
			names: ['카테고리 필터 영역'],
			texts: ['All', 'Driving', 'Walking'],
			rect: { x: 100, y: 200, width: 800, height: 60 },
			keys: {}
		};
		const back: NavCallout = {
			no: '1',
			names: ['Back 버튼'],
			texts: [],
			rect: { x: 100, y: 80, width: 60, height: 60 },
			keys: {}
		};
		const all = [back, tabs];
		expect(describeEffect(parseKeyAction(tabs, 'right', '“Driving” 카테고리에 포커스', all).effect)).toBe('next');
		expect(describeEffect(parseKeyAction(back, 'down', '“All 버튼 포커스', all).effect)).toBe('move:2:item=all');
		expect(describeEffect(parseKeyAction(back, 'right', '“Option 버튼 포커스', all).effect)).toBe('element:option');
	});

	it('이름이 비슷한 콜아웃이 둘이면 정하지 않는다', () => {
		const a: NavCallout = { no: '1', names: ['Menu A'], texts: [], rect: null, keys: {} };
		const b: NavCallout = { no: '2', names: ['Menu B'], texts: [], rect: null, keys: {} };
		const from: NavCallout = { no: '3', names: ['Start'], texts: [], rect: null, keys: {} };
		const r = parseKeyAction(from, 'down', 'Menu 포커스', [a, b, from]);
		expect(r.effect.kind).toBe('element');
		expect(DEFAULT_KEYMAP_OPTIONS.ambiguityMargin).toBeGreaterThan(0);
	});
});

describe('경로 계산', () => {
	const map = buildKeyMap(sampleScreen());

	it('목록의 n번째 항목까지 가장 짧은 키 순서를 찾고 마지막 동작을 붙인다', () => {
		const r = planRoute(map, { callout: '1', position: 1 }, { callout: '2', position: 3 }, ['OK']);
		expect(r.ok && r.keys).toEqual(['DOWN', 'RIGHT', 'RIGHT', 'OK']);
		// ① ▼는 이름을 못 맞혀 키 방향으로 고른 길이다
		expect(r.ok && r.estimated).toBe(true);
	});

	it('추정 길을 쓰지 않으면 막힌 키 동작을 알려 준다', () => {
		const r = planRoute(map, { callout: '1', position: 1 }, { callout: '3', position: 1 }, [], {
			...DEFAULT_ROUTE_OPTIONS,
			allowEstimated: false
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.blocked.map((a) => `${a.from}:${a.key}`).sort()).toEqual(['1:down', '5:down']);
			expect(r.reason).toContain('해석하지 못한 키 동작 2개');
		}
	});

	it('이름으로 정한 길만 쓰면 추정 표시가 없다', () => {
		const r = planRoute(map, { callout: '2', position: 1 }, { callout: '4', position: 2 });
		expect(r.ok && r.keys).toEqual(['DOWN', 'DOWN', 'RIGHT']);
		expect(r.ok && r.estimated).toBe(false);
	});

	it('이동 이력 조건을 따라간다', () => {
		// ② 3번째에서 ▼ → ③, ▲ → ②의 마지막 위치(3번째)라 ▼▲로는 첫 항목에 못 간다.
		// ▲(① 검색창) → ▼(조건 없음, 첫 항목)으로 간다. 키 순서상 ▼▲를 먼저 시도하므로 이력을 무시하면 ▼▲가 나온다
		const r = planRoute(map, { callout: '2', position: 3 }, { callout: '2', position: 1 });
		expect(r.ok && r.keys).toEqual(['UP', 'DOWN']);
		const strict = planRoute(map, { callout: '2', position: 3 }, { callout: '2', position: 1 }, [], {
			...DEFAULT_ROUTE_OPTIONS,
			allowEstimated: false
		});
		expect(strict.ok).toBe(false);
	});

	it('같은 입력이면 같은 경로다', () => {
		const a = planRoute(map, { callout: '5', position: 1 }, { callout: '4', position: 1 });
		const b = planRoute(map, { callout: '5', position: 1 }, { callout: '4', position: 1 });
		expect(a).toEqual(b);
		expect(a.ok && a.keys).toEqual(['DOWN', 'DOWN', 'DOWN']);
	});
});

describe('화면설계서 → 이동 지도', () => {
	it('합친 화면설계서의 콜아웃 이름·키 동작·대상 위치를 옮긴다', () => {
		const frame = normalizeFrame(sampleSpecPage());
		const [merged] = mergeSpecScreens([extractSpecScreen(frame)]);
		expect(merged).toBeDefined();
		if (merged === undefined) return;
		const nav = navScreenFromSpec(merged, new Map([[frame.id, frame]]));
		const first = nav.callouts.find((c) => c.no === '1');
		expect(first?.names).toContain('Search 영역');
		expect(first?.keys.down).toContain('아래 첫 항목으로 이동');
		expect(first?.rect).not.toBeNull();
		const down = buildKeyMap(nav).find((a) => a.from === '1' && a.key === 'down');
		expect(down?.effect).toMatchObject({ memory: true });
	});
});
