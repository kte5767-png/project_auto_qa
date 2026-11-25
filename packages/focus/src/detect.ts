import { pickByStyleDiff } from './styleDiff';
import type { FocusCandidate, FocusState } from './types';

/**
 * 포커스 방식 자동 탐지 (설계 7.8). 방향키를 몇 번 누르며 모은 상태 목록을 보고
 * 쓸 수 있는 어댑터 후보를 신뢰도 순으로 돌려준다. 최종 선택은 사용자가 확인한다.
 */
export interface DetectOptions {
	/** 이 비율 이상의 상태에서 신호가 있어야 후보로 본다 */
	minPresenceRatio: number;
	/** 이 비율 이상의 키 입력에서 포커스가 움직여야 후보로 본다 */
	minMoveRatio: number;
}

export const DEFAULT_DETECT_OPTIONS: DetectOptions = { minPresenceRatio: 0.8, minMoveRatio: 0.5 };

function ratio(count: number, total: number): number {
	return total === 0 ? 0 : count / total;
}

function moveRatio(paths: readonly (string | null)[]): number {
	let moves = 0;
	for (let i = 1; i < paths.length; i++) {
		if (paths[i] !== null && paths[i] !== paths[i - 1]) moves++;
	}
	return ratio(moves, paths.length - 1);
}

export function detectFocusAdapters(
	states: readonly FocusState[],
	options: DetectOptions = DEFAULT_DETECT_OPTIONS
): FocusCandidate[] {
	if (states.length < 2) return [];
	const candidates: FocusCandidate[] = [];
	const n = states.length;

	// 1) 실제 DOM 포커스
	const activePaths = states.map((s) => s.active?.path ?? null);
	const activePresence = ratio(activePaths.filter((p) => p !== null).length, n);
	const activeMoves = moveRatio(activePaths);
	if (activePresence >= options.minPresenceRatio && activeMoves >= options.minMoveRatio) {
		const spottable = states.filter(
			(s) => s.spottableCount > 1 && s.active?.classes.includes('spottable') === true
		).length;
		const spottableRatio = ratio(spottable, n);
		if (spottableRatio >= options.minPresenceRatio) {
			candidates.push({
				adapter: 'enact-spotlight',
				confidence: Math.min(1, spottableRatio * activeMoves + 0.05),
				evidence: `.spottable 요소 ${states[0]?.spottableCount ?? 0}개, 포커스 요소가 .spottable인 비율 ${Math.round(spottableRatio * 100)}%, 키 입력 시 이동 비율 ${Math.round(activeMoves * 100)}%`
			});
		}
		candidates.push({
			adapter: 'active-element',
			confidence: activePresence * activeMoves * 0.9,
			evidence: `activeElement가 있는 비율 ${Math.round(activePresence * 100)}%, 이동 비율 ${Math.round(activeMoves * 100)}%`
		});
	}

	// 2) 한 요소에만 붙어 다니는 클래스 (가상 포커스)
	const tokens = new Set(states.flatMap((s) => Object.keys(s.classHolders)));
	for (const token of tokens) {
		const holderPaths = states.map((s) => {
			const holders = s.classHolders[token];
			return holders !== undefined && holders.length === 1 ? (holders[0] ?? null) : null;
		});
		const presence = ratio(holderPaths.filter((p) => p !== null).length, n);
		const moves = moveRatio(holderPaths);
		if (presence >= options.minPresenceRatio && moves >= options.minMoveRatio) {
			candidates.push({
				adapter: 'selector',
				selector: `.${token}`,
				confidence: presence * moves * 0.95,
				evidence: `클래스 "${token}"가 한 요소에만 붙은 비율 ${Math.round(presence * 100)}%, 키 입력 시 다른 요소로 옮겨간 비율 ${Math.round(moves * 100)}%`
			});
		}
	}

	// 3) 스타일 변화 (최후 수단)
	let gainedTransitions = 0;
	for (let i = 1; i < n; i++) {
		const prev = states[i - 1];
		const next = states[i];
		if (prev !== undefined && next !== undefined && pickByStyleDiff(prev, next).path !== null) gainedTransitions++;
	}
	const styleRatio = ratio(gainedTransitions, n - 1);
	if (styleRatio > 0) {
		candidates.push({
			adapter: 'style-diff',
			confidence: styleRatio * 0.7,
			evidence: `키 입력 후 강조 스타일이 생긴 비율 ${Math.round(styleRatio * 100)}%`
		});
	}

	return candidates.sort((a, b) => b.confidence - a.confidence);
}
