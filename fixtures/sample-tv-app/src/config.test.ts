import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_BACK_KEY_CODE, parseConfig } from './config';

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
