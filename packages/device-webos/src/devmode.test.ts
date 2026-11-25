import { describe, expect, it } from 'vitest';
import { AresCli } from './ares';
import { DevModeError, checkDevModeSession, parseDevModeResponse, parseRemaining, readDevModeToken } from './devmode';

describe('남은 시간 해석', () => {
	it('시:분:초', () => {
		expect(parseRemaining('999:58:40')).toBe(((999 * 60 + 58) * 60 + 40) * 1000);
		expect(parseRemaining('0:00:05')).toBe(5000);
		expect(parseRemaining('12:61:00')).toBeNull();
		expect(parseRemaining('GNL')).toBeNull();
	});

	it('성공 응답', () => {
		expect(parseDevModeResponse({ result: 'success', errorCode: '200', errorMsg: '999:58:40' })).toEqual({
			remainingMs: 3_599_920_000,
			remainingText: '999:58:40'
		});
	});

	it('실패·이상 응답은 DevModeError', () => {
		expect(() =>
			parseDevModeResponse({ result: 'fail', errorCode: 'ERR_005', errorMsg: 'Check user session' })
		).toThrow(/ERR_005/);
		expect(() => parseDevModeResponse({ result: 'success', errorCode: '200', errorMsg: 'GNL' })).toThrow(
			DevModeError
		);
		expect(() => parseDevModeResponse('nope')).toThrow(DevModeError);
	});
});

describe('토큰과 조회', () => {
	it('TV에서 토큰을 읽는다', async () => {
		const ares = new AresCli('tv', (_cmd, args) =>
			Promise.resolve({
				code: 0,
				stdout: args.includes('--run') ? 'ABCDEF0123456789\n' : '',
				stderr: '',
				notFound: false,
				timedOut: false
			})
		);
		expect(await readDevModeToken(ares)).toBe('ABCDEF0123456789');
	});

	it('토큰이 이상하면 Developer Mode 앱에서 확인하라고 알린다', async () => {
		const ares = new AresCli('tv', () =>
			Promise.resolve({ code: 0, stdout: 'cat: permission denied', stderr: '', notFound: false, timedOut: false })
		);
		await expect(readDevModeToken(ares)).rejects.toThrow(/Developer Mode 앱/);
	});

	it('토큰만 담아 조회한다', async () => {
		const urls: string[] = [];
		const session = await checkDevModeSession('ABCDEF0123456789', {
			fetchImpl: (url) => {
				urls.push(url);
				return Promise.resolve({
					ok: true,
					status: 200,
					text: () => Promise.resolve('{"result":"success","errorCode":"200","errorMsg":"10:00:00"}')
				});
			}
		});
		expect(session.remainingText).toBe('10:00:00');
		expect(urls).toEqual([
			'https://developer.lge.com/secure/CheckDevModeSession.dev?sessionToken=ABCDEF0123456789'
		]);
	});
});
