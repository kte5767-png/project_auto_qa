import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_BACK_KEY_CODE, launchParamsToSearch, parseConfig } from './config';

const IDS = ['D01', 'D02', 'D03'];

describe('parseConfig', () => {
	it('기본값: spotlight, Back 461, 결함 없음', () => {
		const config = parseConfig('', IDS);
		expect(config.focusMode).toBe('spotlight');
		expect(config.backKeyCode).toBe(DEFAULT_BACK_KEY_CODE);
		expect(config.defects.size).toBe(0);
	});

	it('focus=class와 back 키 코드를 읽는다', () => {
		const config = parseConfig('?focus=class&back=10009', IDS);
		expect(config.focusMode).toBe('class');
		expect(config.backKeyCode).toBe(10009);
	});

	it('defects=all은 모든 결함을 켠다', () => {
		expect([...parseConfig('?defects=all', IDS).defects]).toEqual(IDS);
	});

	it('쉼표로 고른 결함만 켜고, 소문자·공백을 허용한다', () => {
		expect([...parseConfig('?defects=d01, D03', IDS).defects]).toEqual(['D01', 'D03']);
	});

	it('defects=none과 빈 값은 결함 없음', () => {
		expect(parseConfig('?defects=none', IDS).defects.size).toBe(0);
		expect(parseConfig('?defects=', IDS).defects.size).toBe(0);
	});

	it('잘못된 focus 값은 오류', () => {
		expect(() => parseConfig('?focus=mouse', IDS)).toThrow(ConfigError);
	});

	it('잘못된 back 값은 오류', () => {
		expect(() => parseConfig('?back=abc', IDS)).toThrow(ConfigError);
		expect(() => parseConfig('?back=0', IDS)).toThrow(ConfigError);
	});

	it('OK·방향키와 겹치는 back 키 코드는 오류', () => {
		expect(() => parseConfig('?back=13', IDS)).toThrow(ConfigError);
		expect(() => parseConfig('?back=38', IDS)).toThrow(ConfigError);
	});

	it('알 수 없는 결함 id는 오류', () => {
		expect(() => parseConfig('?defects=D01,D99', IDS)).toThrow(/D99/);
	});
});

describe('launchParamsToSearch', () => {
	it('webOS 실행 인자(JSON 문자열)를 쿼리 문자열로 바꾼다', () => {
		const search = launchParamsToSearch('{"focus":"class","defects":"D05,D07","back":461}');
		expect(parseConfig(search, ['D05', 'D07']).focusMode).toBe('class');
		expect(search).toBe('?focus=class&back=461&defects=D05%2CD07');
	});

	it('객체도 받는다', () => {
		expect(launchParamsToSearch({ focus: 'spotlight' })).toBe('?focus=spotlight');
	});

	it('없거나 해석할 수 없으면 빈 문자열(기본값)', () => {
		expect(launchParamsToSearch(undefined)).toBe('');
		expect(launchParamsToSearch('')).toBe('');
		expect(launchParamsToSearch('{oops')).toBe('');
		expect(launchParamsToSearch('[1,2]')).toBe('');
		expect(launchParamsToSearch('{}')).toBe('');
	});

	it('다른 키와 객체 값은 무시한다', () => {
		expect(launchParamsToSearch({ focus: 'class', other: 'x', defects: { a: 1 } })).toBe('?focus=class');
	});
});
