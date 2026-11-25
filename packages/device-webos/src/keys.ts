import { pageExpression } from '@auto-qa/core';
import type { RemoteKey } from '@auto-qa/core';

/** 리모컨 키 → SSAP 포인터 소켓 버튼 이름 */
export const SSAP_BUTTONS: Record<RemoteKey, string> = {
	UP: 'UP',
	DOWN: 'DOWN',
	LEFT: 'LEFT',
	RIGHT: 'RIGHT',
	OK: 'ENTER',
	BACK: 'BACK',
	HOME: 'HOME'
};

/**
 * SSAP 키 입력은 TV 시스템을 거쳐 비동기로 앱에 도착한다. 고정 시간 대신 "앱이 keydown을 받았는지"를 확인한다.
 * 페이지에 keydown 수를 세는 수동(passive) 리스너를 한 번 붙인다. 앱 동작은 바꾸지 않는다 (preventDefault 없음).
 * 구형 엔진 문법(ES2017)만 쓴다.
 */
interface KeyProbeArg {
	before: number;
	timeoutMs: number;
}

interface KeyProbeState {
	count: number;
	lastKeyCode: number;
}

function installKeyProbeInPage(): number {
	const w = window as unknown as { __autoQaKeyProbe?: KeyProbeState };
	if (w.__autoQaKeyProbe === undefined) {
		const state: KeyProbeState = { count: 0, lastKeyCode: 0 };
		w.__autoQaKeyProbe = state;
		window.addEventListener(
			'keydown',
			(event) => {
				state.count++;
				state.lastKeyCode = event.keyCode;
			},
			true
		);
	}
	return w.__autoQaKeyProbe.count;
}

function waitKeyInPage(arg: KeyProbeArg): Promise<{ delivered: boolean; latencyMs: number; keyCode: number }> {
	return new Promise((resolve) => {
		const w = window as unknown as { __autoQaKeyProbe?: KeyProbeState };
		const start = performance.now();
		const tick = (): void => {
			const state = w.__autoQaKeyProbe;
			const elapsed = performance.now() - start;
			if (state !== undefined && state.count > arg.before) {
				resolve({ delivered: true, latencyMs: Math.round(elapsed), keyCode: state.lastKeyCode });
			} else if (elapsed >= arg.timeoutMs) {
				resolve({ delivered: false, latencyMs: Math.round(elapsed), keyCode: 0 });
			} else {
				setTimeout(tick, 5);
			}
		};
		tick();
	});
}

/** 리스너를 붙이고(한 번만) 지금까지 받은 keydown 수를 돌려주는 식 */
export function keyProbeInstallScript(): string {
	return pageExpression(installKeyProbeInPage, null);
}

/** before보다 keydown 수가 늘 때까지 기다리는 식 (최대 timeoutMs) */
export function keyProbeWaitScript(before: number, timeoutMs: number): string {
	return pageExpression(waitKeyInPage, { before, timeoutMs });
}
