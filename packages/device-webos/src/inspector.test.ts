import { afterEach, describe, expect, it } from 'vitest';
import {
	CdpConnection,
	ScriptError,
	chromiumMajor,
	inspectorVersion,
	listTargets,
	normalizeDebuggerUrl,
	pickAppTarget
} from './inspector';
import type { InspectorTarget } from './inspector';
import { closedPort, startFakeInspector } from './testing/fakeTv';
import type { FakeInspector } from './testing/fakeTv';

let server: FakeInspector | null = null;
afterEach(async () => {
	await server?.close();
	server = null;
});

const page = (id: string, url: string, title = ''): InspectorTarget => ({
	id,
	type: 'page',
	title,
	url,
	webSocketDebuggerUrl: null
});

describe('대상 고르기', () => {
	it('앱 ID가 URL이나 제목에 있는 페이지를 고른다', () => {
		const targets = [
			page('1', 'file:///usr/palm/applications/com.webos.app.home/index.html'),
			page('2', 'file:///media/developer/apps/usr/palm/applications/com.autoqa.sampletvapp/index.html')
		];
		expect(pickAppTarget(targets, 'com.autoqa.sampletvapp')?.id).toBe('2');
	});

	it('앱 ID가 없으면 페이지가 하나일 때만 고른다', () => {
		expect(pickAppTarget([page('1', 'a')], null)?.id).toBe('1');
		expect(pickAppTarget([page('1', 'a'), page('2', 'b')], null)).toBeNull();
		expect(pickAppTarget([page('1', 'a'), page('2', 'b')], 'com.x.y')).toBeNull();
		// 앱 ID를 줬는데 맞는 페이지가 없으면, 페이지가 하나뿐이어도 다른 앱을 잡지 않는다
		expect(pickAppTarget([page('1', 'file:///com.webos.app.home/index.html')], 'com.x.y')).toBeNull();
	});

	it('웹소켓 주소의 호스트를 TV 주소로 바꾼다', () => {
		const target = { ...page('7', 'x'), webSocketDebuggerUrl: 'ws://127.0.0.1:9998/devtools/page/7' };
		expect(normalizeDebuggerUrl(target, '192.168.0.10', 9998)).toBe('ws://192.168.0.10:9998/devtools/page/7');
		expect(normalizeDebuggerUrl(page('8', 'x'), '192.168.0.10', 9998)).toBe(
			'ws://192.168.0.10:9998/devtools/page/8'
		);
	});

	it('Chromium 주 버전', () => {
		expect(chromiumMajor('Chrome/68.0.3440.106')).toBe(68);
		expect(chromiumMajor('Mozilla/5.0 (Web0S; Linux) AppleWebKit/537.36 Chrome/79.0.3945.79 Safari/537.36')).toBe(
			79
		);
		expect(chromiumMajor(undefined)).toBeNull();
	});
});

describe('가짜 Inspector', () => {
	it('/json/list가 없으면 /json으로 목록을 받는다', async () => {
		server = await startFakeInspector({ legacyListPath: true });
		const targets = await listTargets('127.0.0.1', server.port);
		expect(targets).toHaveLength(1);
		expect(await inspectorVersion('127.0.0.1', server.port)).toMatchObject({ Browser: 'Chrome/68.0.3440.106' });
	});

	it('연결할 수 없으면 개발자 모드·앱 실행을 확인하라고 알린다', async () => {
		await expect(listTargets('127.0.0.1', await closedPort(), { timeoutMs: 1000 })).rejects.toThrow(/개발자 모드/);
	});

	it('식을 평가하고, 페이지 예외는 ScriptError로 바꾼다', async () => {
		server = await startFakeInspector({
			evaluate: (expression) => {
				if (expression === 'boom') throw new Error('ReferenceError: boom is not defined');
				return { echoed: expression.length };
			}
		});
		const [target] = await listTargets('127.0.0.1', server.port);
		if (target === undefined) throw new Error('대상 없음');
		const cdp = await CdpConnection.connect(normalizeDebuggerUrl(target, '127.0.0.1', server.port));
		expect(await cdp.evaluate<{ echoed: number }>('1+1')).toEqual({ echoed: 3 });
		await expect(cdp.evaluate('boom')).rejects.toBeInstanceOf(ScriptError);
		await expect(cdp.evaluate('boom')).rejects.toThrow(/boom is not defined/);
		const shot = await cdp.captureScreenshot('jpeg', 60);
		expect(Buffer.from(shot).toString()).toBe('fake-image');
		cdp.close();
	});
});
