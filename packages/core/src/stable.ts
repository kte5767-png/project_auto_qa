import { DEFAULT_STABLE_OPTIONS } from './driver';
import type { StableOptions, StableResult } from './driver';
import { pageExpression } from './pageScript';

/**
 * 페이지 안에서 실행되는 안정화 대기 (설계 7.6). 고정 시간 대신 DOM 변경과 실행 중인 유한 애니메이션이
 * quietMs 동안 없을 때까지 기다린다. 무한 반복 애니메이션(로딩 스피너 등)은 무시한다.
 *
 * 구형 엔진 문법(ES2017)만 쓴다. `document.getAnimations`가 없으면(Chromium 84 미만)
 * 전환·애니메이션 시작/끝 이벤트와 더 긴 정지 시간(legacyQuietMs)으로 대신 판단한다.
 */
function stableInPage(opts: StableOptions): Promise<StableResult> {
	return new Promise((resolve) => {
		const doc = document as Document & { getAnimations?: () => Animation[] };
		const hasAnimations = typeof doc.getAnimations === 'function';
		const quiet = hasAnimations ? opts.quietMs : Math.max(opts.quietMs, opts.legacyQuietMs);
		const start = performance.now();
		let lastChange = start;
		const bump = (): void => {
			lastChange = performance.now();
		};
		const observer = new MutationObserver(bump);
		observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
		const events = ['transitionend', 'animationstart', 'animationend'];
		if (!hasAnimations) {
			for (const name of events) document.addEventListener(name, bump, true);
		}
		const finish = (stable: boolean): void => {
			observer.disconnect();
			if (!hasAnimations) {
				for (const name of events) document.removeEventListener(name, bump, true);
			}
			resolve({
				stable: stable,
				waitedMs: Math.round(performance.now() - start),
				mode: hasAnimations ? 'animations' : 'legacy'
			});
		};
		const tick = (): void => {
			const now = performance.now();
			if (hasAnimations && doc.getAnimations !== undefined) {
				const running = doc.getAnimations().some((a) => {
					const effect = a.effect;
					const iterations = effect === null ? 1 : effect.getTiming().iterations;
					return a.playState === 'running' && iterations !== Infinity;
				});
				if (running) lastChange = now;
			}
			if (now - lastChange >= quiet) {
				finish(true);
			} else if (now - start >= opts.timeoutMs) {
				finish(false);
			} else {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
}

/** 안정화 대기 스크립트(JS 식). 드라이버가 평가하면 StableResult를 돌려준다. */
export function stableWaitScript(options: Partial<StableOptions> = {}): string {
	const merged: StableOptions = {
		quietMs: options.quietMs ?? DEFAULT_STABLE_OPTIONS.quietMs,
		timeoutMs: options.timeoutMs ?? DEFAULT_STABLE_OPTIONS.timeoutMs,
		legacyQuietMs: options.legacyQuietMs ?? DEFAULT_STABLE_OPTIONS.legacyQuietMs
	};
	return pageExpression(stableInPage, merged);
}
