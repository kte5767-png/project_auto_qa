import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { matchesTruth, sampleTruthScript } from './truth';

const truth = {
	path: 'body>div:nth-of-type(1)>button:nth-of-type(2)',
	navPaths: [
		'body>div:nth-of-type(1)>button:nth-of-type(1)',
		'body>div:nth-of-type(1)>button:nth-of-type(2)',
		'body>div:nth-of-type(2)>a:nth-of-type(1)'
	]
};

describe('matchesTruth', () => {
	it('같은 요소와 정답 안쪽 요소는 맞음', () => {
		expect(matchesTruth(truth.path, truth)).toBe(true);
		expect(matchesTruth(`${truth.path}>span:nth-of-type(1)`, truth)).toBe(true);
	});

	it('포커스 가능 요소를 여러 개 감싼 바깥 요소는 틀림', () => {
		expect(matchesTruth('body>div:nth-of-type(1)', truth)).toBe(false);
	});

	it('정답 하나만 감싼 바깥 요소는 맞음', () => {
		const single = { path: 'body>div:nth-of-type(2)>a:nth-of-type(1)', navPaths: truth.navPaths };
		expect(matchesTruth('body>div:nth-of-type(2)', single)).toBe(true);
	});

	it('다른 요소·판단 없음은 틀림, 정답이 없으면 판단 없음만 맞음', () => {
		expect(matchesTruth('body>div:nth-of-type(2)>a:nth-of-type(1)', truth)).toBe(false);
		expect(matchesTruth(null, truth)).toBe(false);
		expect(matchesTruth(null, { path: null, navPaths: [] })).toBe(true);
		expect(matchesTruth('body', { path: null, navPaths: [] })).toBe(false);
	});

	it('경로 접두어가 겹치기만 하는 형제는 안쪽으로 보지 않는다', () => {
		expect(matchesTruth('body>div:nth-of-type(1)>button:nth-of-type(2)0', truth)).toBe(false);
	});
});

describe('sampleTruthScript', () => {
	it('구형 TV 엔진(ES2017)에서 파싱된다', () => {
		expect(() => parse(sampleTruthScript(), { ecmaVersion: 2017 })).not.toThrow();
	});
});
