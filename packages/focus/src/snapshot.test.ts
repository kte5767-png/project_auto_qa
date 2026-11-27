import { PAGE_SCRIPT_ECMA_VERSION } from '@auto-qa/core';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { childrenOf, focusableCount, isAncestorNode, nodeTexts, snapshotScript, takeDomSnapshot } from './snapshot';
import type { DomNode, DomSnapshot } from './snapshot';

const node = (i: number, parent: number, extra: Partial<DomNode> = {}): DomNode => ({
	i,
	parent,
	tag: 'div',
	id: null,
	classes: [],
	spotlightId: null,
	container: false,
	role: null,
	label: null,
	ownText: '',
	value: null,
	rect: { x: 0, y: 0, width: 10, height: 10 },
	focusable: false,
	focused: false,
	probes: [],
	...extra
});

/** 0 ─ 1 ─ 2(글자, 포커스) / 0 ─ 3(입력란) */
const SNAP: DomSnapshot = {
	viewport: { width: 1920, height: 1080 },
	nodes: [
		node(0, -1),
		node(1, 0, { ownText: '추천 검색어' }),
		node(2, 1, { ownText: 'Tokyo', focusable: true }),
		node(3, 0, { tag: 'input', label: 'Search your place.', value: 'b', focusable: true })
	],
	truncated: false,
	errors: []
};

describe('snapshotScript', () => {
	it('구형 TV 엔진(ES2017)에서 파싱되는 문법만 쓴다', () => {
		const script = snapshotScript({ probes: [{ name: '4.2#1', selector: '.a', textIncludes: 'x' }] });
		expect(() => parse(script, { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
	});

	it('data-testid·data-sample-nav를 읽지 않는다 (탐지 금지 속성)', () => {
		const script = snapshotScript();
		expect(script).not.toContain('data-testid');
		expect(script).not.toContain('data-sample-nav');
	});

	it('주어진 실행기로 평가한다', async () => {
		const seen: string[] = [];
		const got = await takeDomSnapshot({
			evaluate: <T>(expression: string): Promise<T> => {
				seen.push(expression);
				return Promise.resolve(SNAP as T);
			}
		});
		expect(got.nodes).toHaveLength(4);
		expect(seen[0]).toContain('getBoundingClientRect');
	});
});

describe('스냅숏 순수 함수', () => {
	it('자식·조상 관계', () => {
		expect(childrenOf(SNAP)).toEqual([[1, 3], [2], [], []]);
		expect(isAncestorNode(SNAP, 0, 2)).toBe(true);
		expect(isAncestorNode(SNAP, 2, 0)).toBe(false);
		expect(isAncestorNode(SNAP, 3, 2)).toBe(false);
	});

	it('요소 안 글자는 자손의 글자·이름표·입력값을 문서 순서로 모은다', () => {
		expect(nodeTexts(SNAP, 0)).toEqual(['추천 검색어', 'Tokyo', 'Search your place.', 'b']);
		expect(nodeTexts(SNAP, 1)).toEqual(['추천 검색어', 'Tokyo']);
		expect(nodeTexts(SNAP, 0, 2)).toEqual(['추천 검색어', 'Tokyo']);
	});

	it('안에 든 포커스 가능 요소 수', () => {
		expect(focusableCount(SNAP)).toEqual([2, 1, 1, 1]);
	});
});
