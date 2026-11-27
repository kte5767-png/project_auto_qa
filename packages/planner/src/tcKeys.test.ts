import { describe, expect, it } from 'vitest';
import { expectAfterKey } from './expect';
import { buildKeyMap, describeEffect } from './keymap';
import type { NavCallout, NavScreen } from './keymap';
import { keyClauseText, overrideKeyTexts, withCalloutNames } from './tcKeys';

const MEMORY = ' (이동한 이력이 있을 경우: 마지막 포커스한 콘텐츠에 이동)';

/** 합성 화면: 화면설계서 판에는 ④의 [▼]가 "동작 없음"이고 ⑤(맨 위로) 설명이 없다 */
function specScreen(): NavScreen {
	const c = (no: string, name: string, rect: NavCallout['rect'], keys: NavCallout['keys']): NavCallout => ({
		no,
		names: [name],
		texts: [],
		rect,
		keys
	});
	return {
		screenId: '9.2',
		title: '합성 검색',
		callouts: [
			c(
				'1',
				'Search box 영역',
				{ x: 300, y: 100, width: 1000, height: 80 },
				{ up: '동작 없음', down: 'Top Picks 영역 좌측 첫 번째 콘텐츠에 포커스', left: 'GNB 확장' }
			),
			c(
				'3',
				'Top Picks',
				{ x: 300, y: 400, width: 1500, height: 300 },
				{
					up: '“Search box 버튼 포커스',
					down: `Weekly Cities 영역 좌측 첫 번째 항목에 포커스${MEMORY}`,
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
					right: '다음 콘텐츠 노출'
				}
			)
		]
	};
}

describe('keyClauseText', () => {
	it('키 표시를 떼고, " / " 뒤 조건은 괄호로 붙인다 (화면설계서 설명과 같은 꼴)', () => {
		expect(
			keyClauseText(
				'[▼] Top Picks 영역 좌측 첫 번째 콘텐츠에 포커스 / 이동한 이력이 있을 경우: 마지막 포커스한 콘텐츠에 이동'
			)
		).toBe('Top Picks 영역 좌측 첫 번째 콘텐츠에 포커스 (이동한 이력이 있을 경우: 마지막 포커스한 콘텐츠에 이동)');
		expect(keyClauseText('[︎►] 동작 없음')).toBe('동작 없음');
		expect(keyClauseText('[▲]: “Search box 버튼 포커스')).toBe('“Search box 버튼 포커스');
		expect(keyClauseText('[▼]')).toBe('');
	});
});

describe('withCalloutNames', () => {
	it('TC·프로필 이름을 더하고, 화면설계서에 없는 콜아웃은 이름만으로 더한다', () => {
		const screen = withCalloutNames(specScreen(), '9.2', {
			'3': ['인기 목록', 'Top Picks'],
			'5': ['Back to Top', '맨 위로'],
			'6': ['  ']
		});
		expect(screen.callouts.map((c) => c.no)).toEqual(['1', '3', '4', '5']);
		expect(screen.callouts.find((c) => c.no === '3')?.names).toEqual(['Top Picks', '인기 목록']);
		expect(screen.callouts.find((c) => c.no === '5')).toMatchObject({
			names: ['Back to Top', '맨 위로'],
			rect: null
		});
	});

	it('화면설계서가 없는 화면은 이름만으로 만든다', () => {
		const screen = withCalloutNames(null, '9.4', { '1': ['Search Option'] });
		expect(screen).toMatchObject({ screenId: '9.4', callouts: [{ no: '1', names: ['Search Option'], keys: {} }] });
	});
});

describe('overrideKeyTexts (TC 기준 판정, D-046)', () => {
	const screen = withCalloutNames(specScreen(), '9.2', { '5': ['Back to Top'] });
	const actions = buildKeyMap(screen);

	it('화면설계서와 TC가 다르면 TC 문장으로 기대 위치를 정한다', () => {
		const spec = expectAfterKey(actions, '4', 'down');
		expect(spec).toMatchObject({ ok: true, target: { kind: 'same' } });
		const o = overrideKeyTexts(actions, screen, '4', { down: '[▼] Back to Top 버튼 포커스' });
		expect(describeEffect(o.tc.down?.effect ?? { kind: 'unknown' })).toBe('move:5:first');
		expect(o.spec.down?.text).toBe('동작 없음');
		expect(expectAfterKey(o.actions, '4', 'down')).toMatchObject({
			ok: true,
			target: { kind: 'callout', no: '5' }
		});
		// 다른 키·다른 콜아웃의 동작은 화면설계서 그대로
		expect(o.actions.filter((a) => !(a.from === '4' && a.key === 'down'))).toEqual(
			actions.filter((a) => !(a.from === '4' && a.key === 'down'))
		);
	});

	it('TC의 " / 이력" 조건은 이력 조건으로 읽고 "마지막"을 마지막 항목으로 읽지 않는다', () => {
		const o = overrideKeyTexts(actions, screen, '3', {
			down: '[▼] Weekly Cities 영역 좌측 첫 번째 항목에 포커스 / 이동한 이력이 있을 경우: 마지막 포커스한 콘텐츠에 이동'
		});
		expect(describeEffect(o.tc.down?.effect ?? { kind: 'unknown' })).toBe('move:4:first+memory');
	});

	it('화면설계서에 그 키 동작이 없어도 TC 문장으로 확인한다', () => {
		const o = overrideKeyTexts(actions, screen, '5', {
			up: '[▲] Weekly Cities 좌측 첫 번째 항목에 포커스',
			down: '[▼] 동작 없음'
		});
		expect(expectAfterKey(actions, '5', 'up')).toMatchObject({ ok: false });
		expect(expectAfterKey(o.actions, '5', 'up')).toMatchObject({ ok: true, target: { kind: 'callout', no: '4' } });
		expect(expectAfterKey(o.actions, '5', 'down')).toMatchObject({ ok: true, target: { kind: 'same' } });
		expect(o.spec).toEqual({});
	});

	it('출발 콜아웃이 없거나 TC 문장이 비면 그대로 둔다', () => {
		expect(overrideKeyTexts(actions, screen, '9', { down: '[▼] 동작 없음' }).actions).toEqual(actions);
		expect(overrideKeyTexts(actions, screen, '4', { down: '[▼]' }).actions).toEqual(actions);
	});
});
