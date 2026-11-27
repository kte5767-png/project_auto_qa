import type { RemoteKey } from '@auto-qa/core';
import type { SpecKey } from '@auto-qa/spec';
import type { KeyAction } from './keymap';

/**
 * 이동 지도 위에서 현재 포커스부터 목표까지 가장 짧은 키 순서를 찾는다 (D-036).
 * 너비 우선 탐색이고 키는 정해진 순서로 시도하므로, 같은 입력이면 항상 같은 경로가 나온다.
 * 위치는 콜아웃 번호 + 목록 안 순번(1부터) 또는 항목 이름이다. 목록 길이는 화면설계서에 없으므로
 * 순번 상한(maxIndex)을 두고, 실제로 그만큼 있는지는 TV에서 확인한다.
 */

export type Position = number | 'last' | { item: string };

export interface FocusPoint {
	callout: string;
	position: Position;
}

export interface RouteOptions {
	/** 같은 길이의 경로가 여럿일 때 먼저 시도하는 키 순서 */
	keyOrder: SpecKey[];
	/** 키 방향으로 고른 추정 대상도 길로 쓸지 (쓰면 결과에 estimated 표시) */
	allowEstimated: boolean;
	/** 목록 안 순번 상한 */
	maxIndex: number;
	/** 탐색할 상태 수 상한 */
	maxStates: number;
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
	keyOrder: ['down', 'right', 'up', 'left'],
	allowEstimated: true,
	maxIndex: 20,
	maxStates: 5000
};

export interface RouteStep {
	key: RemoteKey;
	from: FocusPoint;
	to: FocusPoint;
	action: KeyAction;
	estimated: boolean;
}

export type RouteResult =
	| { ok: true; keys: RemoteKey[]; steps: RouteStep[]; estimated: boolean }
	| { ok: false; reason: string; blocked: KeyAction[] };

const REMOTE: Record<SpecKey, RemoteKey> = {
	up: 'UP',
	down: 'DOWN',
	left: 'LEFT',
	right: 'RIGHT',
	ok: 'OK',
	back: 'BACK'
};

interface State {
	at: FocusPoint;
	/** 콜아웃별 마지막 위치 (이동 이력) */
	memory: Map<string, Position>;
}

function samePosition(a: Position, b: Position): boolean {
	if (typeof a === 'number' || typeof b === 'number' || a === 'last' || b === 'last') return a === b;
	return a.item.toLowerCase() === b.item.toLowerCase();
}

function positionKey(p: Position): string {
	return typeof p === 'number' ? String(p) : p === 'last' ? 'last' : `item:${p.item.toLowerCase()}`;
}

function stateKey(s: State): string {
	const mem = [...s.memory.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([c, p]) => `${c}=${positionKey(p)}`)
		.join(',');
	return `${s.at.callout}@${positionKey(s.at.position)}|${mem}`;
}

/** 키 하나를 눌렀을 때 도착하는 상태 (지도로 알 수 없으면 null) */
function apply(state: State, action: KeyAction, options: RouteOptions): { next: State; estimated: boolean } | null {
	const e = action.effect;
	if (e.kind === 'step') {
		const p = state.at.position;
		if (typeof p !== 'number') return null;
		const index = p + e.delta;
		if (index < 1 || index > options.maxIndex) return null;
		return { next: { at: { callout: state.at.callout, position: index }, memory: state.memory }, estimated: false };
	}
	let to: string;
	let entry: Position;
	let memoryAware: boolean;
	let estimated = false;
	if (e.kind === 'move') {
		to = e.to;
		entry = e.item !== null ? { item: e.item } : e.position === 'last' ? 'last' : 1;
		memoryAware = e.memory;
	} else if ((e.kind === 'element' || e.kind === 'unknown') && action.estimate !== null && options.allowEstimated) {
		to = action.estimate.to;
		entry = 1;
		memoryAware = e.kind === 'element' && e.memory;
		estimated = true;
	} else {
		return null;
	}
	const remembered = memoryAware ? state.memory.get(to) : undefined;
	const memory = new Map(state.memory);
	memory.set(state.at.callout, state.at.position);
	return { next: { at: { callout: to, position: remembered ?? entry }, memory }, estimated };
}

/**
 * start에서 goal까지의 최단 키 순서. finish(예: ['OK'])는 도착 뒤에 붙인다.
 * 이동 이력이 없는 상태(앱을 막 연 상태)에서 시작한다고 본다.
 */
export function planRoute(
	actions: readonly KeyAction[],
	start: FocusPoint,
	goal: FocusPoint,
	finish: readonly RemoteKey[] = [],
	options: RouteOptions = DEFAULT_ROUTE_OPTIONS
): RouteResult {
	const byFrom = new Map<string, Map<SpecKey, KeyAction>>();
	for (const a of actions) {
		const m = byFrom.get(a.from) ?? new Map<SpecKey, KeyAction>();
		m.set(a.key, a);
		byFrom.set(a.from, m);
	}
	const done = (s: State): boolean => s.at.callout === goal.callout && samePosition(s.at.position, goal.position);

	interface Node {
		state: State;
		steps: RouteStep[];
	}
	const first: Node = { state: { at: start, memory: new Map() }, steps: [] };
	const seen = new Set<string>([stateKey(first.state)]);
	const queue: Node[] = [first];
	const blocked = new Map<string, KeyAction>();
	for (let head = 0; head < queue.length; head++) {
		const node = queue[head];
		if (node === undefined) break;
		if (done(node.state)) {
			const keys = [...node.steps.map((s) => s.key), ...finish];
			return { ok: true, keys, steps: node.steps, estimated: node.steps.some((s) => s.estimated) };
		}
		if (seen.size > options.maxStates) break;
		const outgoing = byFrom.get(node.state.at.callout);
		for (const key of options.keyOrder) {
			const action = outgoing?.get(key);
			if (action === undefined) continue;
			const r = apply(node.state, action, options);
			if (r === null) {
				if (action.effect.kind === 'element' || action.effect.kind === 'unknown') {
					blocked.set(`${action.from}:${action.key}`, action);
				}
				continue;
			}
			const k = stateKey(r.next);
			if (seen.has(k)) continue;
			seen.add(k);
			queue.push({
				state: r.next,
				steps: [
					...node.steps,
					{ key: REMOTE[key], from: node.state.at, to: r.next.at, action, estimated: r.estimated }
				]
			});
		}
	}
	const where = `${goal.callout}번 ${positionKey(goal.position)}`;
	return {
		ok: false,
		reason:
			blocked.size > 0
				? `${where}까지 가는 길을 지도에서 찾지 못함 — 해석하지 못한 키 동작 ${blocked.size}개 (TV에서 확인 필요)`
				: `${where}까지 가는 길이 키 동작(TC·화면설계서)에 없음`,
		blocked: [...blocked.values()]
	};
}
