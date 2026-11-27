import { KEY_LABEL } from './api';
import type { LiveState, Run, TrailItem } from './api';

/**
 * 검수 중 화면의 실시간 상태: 서버(/api/stream)가 보내는 이벤트를 모은다 (순수 함수).
 * 진행(progress)·실시간 화면(frame)은 지금 보는 실행(runId)의 것만 받는다.
 */
export interface StreamState {
	/** 서버와 이어져 있는가 (끊기면 브라우저가 저절로 다시 잇는다) */
	connected: boolean;
	live: LiveState | null;
	runId: string | null;
	run: Run | null;
	/** 실시간 화면(live.jpg) 판 번호. 없으면 null */
	frame: string | null;
	log: string[];
	/** 이 화면이 처음 이벤트를 받은 시각 이후 마지막으로 무엇이든 받은 시각 */
	receivedAt: number;
}

export type StreamEvent =
	| { type: 'open' }
	| { type: 'error' }
	| { type: 'live'; data: LiveState }
	| { type: 'run'; data: { id: string | null } }
	| { type: 'progress'; data: Run }
	| { type: 'frame'; data: { id: string; v: string } }
	| { type: 'log'; data: { reset?: boolean; lines: string[]; seq: number } };

export const LOG_MAX = 400;

export const INITIAL_STREAM: StreamState = {
	connected: false,
	live: null,
	runId: null,
	run: null,
	frame: null,
	log: [],
	receivedAt: 0
};

export function reduceStream(s: StreamState, e: StreamEvent, now = Date.now()): StreamState {
	switch (e.type) {
		case 'open':
			return { ...s, connected: true, receivedAt: now };
		case 'error':
			return { ...s, connected: false };
		case 'live':
			return { ...s, live: e.data, receivedAt: now };
		case 'run':
			// 다른 실행으로 바뀌면 이전 실행의 진행·화면은 버린다 (시작 직후 이전 실행이 '완료'로 보이지 않게)
			return e.data.id === s.runId ? s : { ...s, runId: e.data.id, run: null, frame: null, receivedAt: now };
		case 'progress':
			if (s.runId !== null && e.data.id !== s.runId) return s;
			return { ...s, runId: e.data.id, run: e.data, receivedAt: now };
		case 'frame':
			if (s.runId !== null && e.data.id !== s.runId) return s;
			return { ...s, frame: e.data.v, receivedAt: now };
		case 'log': {
			const lines = e.data.reset === true ? e.data.lines : [...s.log, ...e.data.lines];
			return { ...s, log: lines.length > LOG_MAX ? lines.slice(-LOG_MAX) : lines, receivedAt: now };
		}
	}
}

/** 화면에 보이는 실행 상태 */
export type ViewStage = 'preparing' | 'running' | 'writing' | 'done' | 'stopped' | 'ended-early';

export const VIEW_STAGE_LABEL: Record<ViewStage, string> = {
	preparing: '준비 중',
	running: '진행 중',
	writing: 'TC 파일에 쓰는 중',
	done: '완료',
	stopped: '중지됨',
	'ended-early': '중간에 끝남'
};

export function viewStage(run: Run | null, live: LiveState | null, runId: string | null): ViewStage | null {
	const own = live !== null && live.runId !== null && live.runId === runId;
	if (run === null) return own && live.running ? 'preparing' : null;
	if (run.stopped === true) return own && live.stopped ? 'stopped' : 'ended-early';
	// 이 화면에서 띄운 검수가 진행 파일을 끝내지 못하고 끝났으면 (서버가 고치기 전 잠깐)
	if (own && !live.running && run.stage !== 'done' && !run.finished) return live.stopped ? 'stopped' : 'ended-early';
	if (run.stage !== undefined) return run.stage;
	return run.finished ? 'done' : 'running';
}

/** 실행 중인가 (중지 버튼·경과 시간이 움직이는가) */
export function isActive(stage: ViewStage | null): boolean {
	return stage === 'preparing' || stage === 'running' || stage === 'writing';
}

/** 기록 한 칸을 화면에 보이는 짧은 글로: 키면 키 모양, 아니면 동작 이름 */
export interface TrailChip {
	label: string;
	kind: 'key' | 'action';
	detail: string;
}

export function trailChips(trail: readonly TrailItem[], max: number): TrailChip[] {
	return trail
		.slice(-max)
		.map((t) =>
			t.action !== undefined
				? { label: t.action, kind: 'action', detail: t.focus }
				: t.key !== null
					? { label: KEY_LABEL[t.key] ?? t.key, kind: 'key', detail: t.focus }
					: { label: shortNote(t.focus), kind: 'action', detail: t.focus }
		);
}

/** 키가 아닌 기록(앱 열기·홈으로 등)의 앞부분만 */
function shortNote(text: string): string {
	const head = text.split(/ → |\s\(/)[0] ?? text;
	return head.length > 16 ? `${head.slice(0, 16)}…` : head;
}

/** 지금 단계의 기록. 단계 사이(다음 단계 시작 전)에는 직전에 끝난 단계의 기록 */
export function shownTrail(run: Run): { key: string | null; trail: TrailItem[]; live: boolean } {
	if (run.current !== null && run.currentTrail !== undefined) {
		return { key: run.current, trail: run.currentTrail, live: true };
	}
	const last = run.steps.at(-1);
	return { key: last?.key ?? null, trail: last?.trail ?? [], live: false };
}

/** 로그 한 줄의 색 (단계 시작·판정 결과) */
export function logTone(line: string): 'step' | 'pass' | 'fail' | 'review' | 'muted' | null {
	const verdict = /^\s*= (Pass|Fail|확인 필요|미실행)(?=\s|$)/.exec(line)?.[1];
	if (verdict === 'Pass') return 'pass';
	if (verdict === 'Fail') return 'fail';
	if (verdict === '확인 필요') return 'review';
	if (verdict === '미실행') return 'muted';
	if (/^\s*\[(Fail|확인 필요)\]/.test(line)) return 'review';
	if (/^ {2}\S+![0-9]+ /.test(line)) return 'step';
	return null;
}

/** 단계 목록 위에 보일 시트 이름 (단계 키 "시트!행"에서) */
export function sheetNames(keys: readonly string[]): string {
	const sheets = [...new Set(keys.map((k) => k.split('!')[0] ?? '').filter((s) => s !== ''))];
	return sheets.length === 0 ? '' : `${sheets.join(', ')} 시트`;
}
