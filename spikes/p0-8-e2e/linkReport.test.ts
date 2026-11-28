import type { Rect } from '@auto-qa/core';
import type { DomNode, DomSnapshot } from '@auto-qa/focus';
import { linkScreenToApp } from '@auto-qa/planner';
import type { NavCallout, NavScreen } from '@auto-qa/planner';
import { describe, expect, it } from 'vitest';
import { autoProbes, draftCallouts, gradeScreen, linkReportText, summarize, truthProbes } from './linkReport';
import { buildRegistry } from './profile';
import type { AppProfile } from './profile';

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

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

/** 샘플 앱 검색 화면 꼴: 검색창, 감싸는 요소 없는 검색어 버튼 줄, 제목 */
const SCREEN = snap([
	{ parent: -1, tag: 'body', rect: r(0, 0, 1920, 1080) },
	{ parent: 0, classes: ['screen', 'search'], rect: r(0, 0, 1920, 1080) },
	{
		parent: 1,
		classes: ['nav-item', 'search-field', 'spottable'],
		focusable: true,
		rect: r(483, 42, 953, 72),
		probes: ['truth:1']
	},
	{
		parent: 2,
		tag: 'input',
		label: 'Search your destination or interest.',
		focusable: true,
		rect: r(545, 62, 864, 33)
	},
	{
		parent: 1,
		tag: 'h2',
		classes: ['search-section-title'],
		ownText: 'Recommended Keywords',
		rect: r(210, 178, 367, 40)
	},
	{
		parent: 1,
		classes: ['nav-item', 'search-chip', 'spottable'],
		ownText: 'Walking in Bali',
		focusable: true,
		rect: r(210, 246, 320, 66),
		probes: ['truth:2']
	},
	{
		parent: 1,
		classes: ['nav-item', 'search-chip', 'spottable'],
		ownText: 'Family',
		focusable: true,
		rect: r(543, 246, 320, 66),
		probes: ['truth:2']
	},
	{
		parent: 1,
		classes: ['nav-item', 'search-back', 'spottable'],
		focusable: true,
		rect: r(60, 46, 64, 64),
		probes: ['truth:3']
	}
]);

const c = (
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
		c('1', '검색창', ['Search your destination or interest.'], r(470, 50, 980, 70), { down: '아래로' }),
		c('2', '추천 검색어', ['Walking in Bali', 'Romantic'], r(200, 240, 700, 80), { up: '위로' }),
		// 위치가 크게 틀려 다른 요소(검색창)를 고르는 경우
		c('3', '뒤로', [], r(500, 50, 900, 60)),
		c('4', '정답 없는 콜아웃', ['Recommended Keywords'], r(210, 178, 367, 40))
	]
};

const PROFILE: AppProfile = {
	format: 'auto-qa/app-profile',
	version: 1,
	name: 't',
	url: 'http://x',
	elements: { 뒤로: { selector: '.search-back', callout: '4.2#3' } },
	screens: {
		'4.2': {
			detect: '.search-field',
			entry: [],
			callouts: { '1': { selector: '.search-field', name: '검색창' }, '2': { selector: '.search-chip' } }
		}
	}
};

describe('truthProbes', () => {
	it('그 화면 콜아웃과 공통 요소의 callout을 정답 probe로', () => {
		const probes = truthProbes(buildRegistry(PROFILE), '4.2');
		expect(probes.map((p) => [p.name, p.selector]).sort()).toEqual([
			['truth:1', '.search-field'],
			['truth:2', '.search-chip'],
			['truth:3', '.search-back']
		]);
	});
});

describe('gradeScreen', () => {
	const probes = truthProbes(buildRegistry(PROFILE), '4.2');
	const link = linkScreenToApp(NAV, SCREEN);
	const rows = gradeScreen('4.2', link, SCREEN, null, probes);
	const grade = (no: string): string | undefined => rows.find((x) => x.no === no)?.grade;

	it('같은 상자면 일치, 목록 항목 정답은 형제 묶음과 비교한다', () => {
		expect(grade('1')).toBe('match');
		expect(grade('2')).toBe('match');
	});

	it('다른 요소를 고르면 다름, 정답이 없으면 채점에서 뺀다', () => {
		expect(grade('3')).toBe('wrong');
		expect(grade('4')).toBe('no-truth');
		expect(summarize(rows)).toMatchObject({ graded: 3, match: 2, wrong: 1, noTruth: 1 });
	});

	it('다시 읽은 화면에서 선택자를 검증하고, 하나로 좁힌 선택자만 초안에 넣는다', () => {
		const again = snap(
			SCREEN.nodes.map((n) => ({
				...n,
				probes: autoProbes(link)
					.filter((p) => n.classes.includes(p.selector.replace(/^\./, '')))
					.map((p) => p.name)
			}))
		);
		const checked = gradeScreen('4.2', link, SCREEN, again, probes);
		expect(checked.find((x) => x.no === '2')?.auto).toMatchObject({ selector: '.search-chip', verified: true });
		const draft = draftCallouts([link]);
		expect(draft['4.2']?.['2']).toEqual({ selector: '.search-chip', name: '추천 검색어' });
		expect(linkReportText(checked, ['4.9: 진입 실패'])[2]).toContain('일치 2/3 (67%)');
	});
});
