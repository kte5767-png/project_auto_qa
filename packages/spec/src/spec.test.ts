import { normalizeFrame } from '@auto-qa/figma';
import { describe, expect, it } from 'vitest';
import { compareVersions, normalizeLabel, parseDescription, parseScreenTitle, parseVersions } from './describe';
import { extractSpecScreen, findMarkers, findMockup } from './extract';
import { sampleSpecPage } from './testing';

const frame = normalizeFrame(sampleSpecPage());
const spec = extractSpecScreen(frame);
const callout = (no: string) => {
	const c = spec.callouts.find((x) => x.no === no);
	if (c === undefined) throw new Error(`콜아웃 ${no} 없음`);
	return c;
};

describe('parseDescription', () => {
	it('이름·요약·묶음·키 동작으로 나누고, 키 아래 조건 줄은 그 키에 붙인다', () => {
		const d = parseDescription(
			'Search 영역\n_검색어 입력 칸\n1)표시 내용\n플레이스홀더\n2)포커스 된 상태에서 4way key 입력 시\n[▲]: 동작 없음\n[▼]: 아래로 이동\n이동한 이력이 있을 경우: 마지막 위치\n[︎►]: 메뉴로\n[OK]: 선택\n[Back]: 닫기'
		);
		expect(d.label).toBe('Search 영역');
		expect(d.summary).toEqual(['검색어 입력 칸']);
		expect(d.sections.map((s) => [s.title, s.items.length])).toEqual([
			['표시 내용', 1],
			['포커스 된 상태에서 4way key 입력 시', 6]
		]);
		expect(d.keys).toEqual({
			up: '동작 없음',
			down: '아래로 이동 (이동한 이력이 있을 경우: 마지막 위치)',
			right: '메뉴로',
			ok: '선택',
			back: '닫기'
		});
	});
});

describe('헤더 글자', () => {
	it('화면 번호 제목, 버전 이력, 이름 비교', () => {
		expect(parseScreenTitle('4.1.1. 검색어 자동 완성')).toEqual({ screenId: '4.1.1', title: '검색어 자동 완성' });
		expect(parseScreenTitle('4. Search')).toEqual({ screenId: '4', title: 'Search' });
		expect(parseScreenTitle('Search')).toBeNull();
		expect(parseVersions('[v1.0.1]\n정의\n추가\n[v2.0.1] 변경')).toEqual([
			{ version: '1.0.1', changes: ['정의', '추가'] },
			{ version: '2.0.1', changes: ['변경'] }
		]);
		expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
		expect(normalizeLabel('Search field 영역')).toBe('search field');
		expect(normalizeLabel('VKB(Virtual Keyboard)')).toBe('vkb');
		expect(normalizeLabel('“Travel Now”')).toBe('travel now');
	});
});

describe('findMarkers / findMockup', () => {
	it('원 + 번호 묶음과, 묶이지 않은 원 + 번호를 모두 마커로 찾는다', () => {
		const markers = findMarkers(frame);
		expect(markers.map((m) => m.no).sort()).toEqual(['1', '1', '2', '2', '3', '3', '4', '4', '5', '5', '6']);
		expect(markers.find((m) => m.no === '6')?.rect).toEqual({ x: 115, y: 752, width: 43, height: 43 });
	});

	it('화면 비율의 가장 큰 상자를 목업으로 본다', () => {
		expect(findMockup(frame)?.name).toBe('Rectangle 944');
	});
});

describe('extractSpecScreen', () => {
	it('헤더: 화면 번호·제목·상위 화면·버전 이력(최신순)·수정 표시·쪽 번호', () => {
		expect(spec).toMatchObject({
			screenId: '2.1.1',
			title: '샘플 화면 - 진입 시',
			parents: [{ screenId: '2.1', title: '샘플 목록' }],
			modified: true,
			pageNumber: '42'
		});
		expect(spec.versions.map((v) => v.version)).toEqual(['2.0.0', '1.10.0', '1.0.1']);
	});

	it('진입 조건·Default Focus·추가 설명·음성 안내·경계 밖 메모', () => {
		expect(spec.entryConditions).toEqual(['샘플 페이지 진입 시 화면(Default Focus: 첫 번째 카드)']);
		expect(spec.defaultFocus).toBe('첫 번째 카드');
		expect(spec.notes).toEqual(['재진입 시 마지막 위치 유지']);
		expect(spec.audioGuidance).toEqual(['진입 시', '🔊 <"Search">']);
		expect(spec.offFrameNotes).toEqual(['디자이너 메모']);
	});

	it('목업 배율 = 화면 너비 ÷ 목업 너비', () => {
		expect(spec.mockup).toMatchObject({ rect: { x: 39, y: 187, width: 1200, height: 675 }, scale: 1.6 });
	});

	it('목업 마커와 설명 마커를 번호로 잇고, 헤더 선 바로 아래에서 시작하는 설명도 찾는다', () => {
		expect(spec.callouts.map((c) => [c.no, c.label])).toEqual([
			['1', 'Search 영역'],
			['2', 'Popular 영역'],
			['3', '강조 영역'],
			['4', 'Keyboard(가상 키보드)'],
			['5', '설정 버튼'],
			['6', null]
		]);
		expect(callout('1').description?.keys.right).toBe('메뉴로 이동');
		expect(callout('5').description?.keys).toEqual({ ok: '팝업 열기', back: '닫기' });
	});

	it('대상: 강조 상자 → 같은 이름 글자 → 감싼 상자 → 가장 가까운(같은 높이 우선) 요소', () => {
		const target = (no: string) => {
			const t = callout(no).target;
			return [t?.method, t?.name ?? t?.text];
		};
		expect(target('1')).toEqual(['nearest', expect.stringMatching(/^Group/)]);
		expect(callout('1').target?.specRect).toEqual({ x: 341, y: 213, width: 596, height: 45 });
		expect(target('2')).toEqual(['label', 'Popular']);
		expect(target('3')).toEqual(['annotation-box', 'Rectangle 1020']);
		expect(target('4')).toEqual(['container', 'keyboard']);
		expect(target('5')).toEqual(['nearest', 'Group 48100810']);
		expect(target('6')).toEqual(['nearest', 'Trending']);
	});

	it('대상 위치를 화면 좌표로 바꾸고 화면 범위로 자른다', () => {
		expect(callout('1').target?.screenRect).toEqual({ x: 483.2, y: 41.6, width: 953.6, height: 72 });
		expect(callout('3').target?.screenRect).toEqual({ x: 0, y: 550.4, width: 1920, height: 108.8 });
	});

	it('설명이 없는 마커는 진단으로 남긴다', () => {
		expect(spec.diagnostics).toEqual(['콜아웃 6: 설명이 없음 (같은 화면의 다른 쪽에 있을 수 있음)']);
	});

	it('목업이 없으면 콜아웃 없이 진단을 남긴다', () => {
		const page = sampleSpecPage();
		page.node.children = page.node.children.filter((c) => c.name !== 'Rectangle 944');
		const s = extractSpecScreen(normalizeFrame(page));
		expect(s.mockup).toBeNull();
		expect(s.callouts).toEqual([]);
		expect(s.diagnostics[0]).toContain('목업');
		expect(s.screenId).toBe('2.1.1');
	});

	it('같은 입력이면 같은 결과', () => {
		expect(extractSpecScreen(normalizeFrame(sampleSpecPage()))).toEqual(spec);
	});
});
