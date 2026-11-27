import { useEffect, useReducer, useState } from 'react';
import { api } from './api';
import { INITIAL_STREAM, reduceStream } from './live';
import type { StreamEvent, StreamState } from './live';

const EVENTS = ['live', 'run', 'progress', 'frame', 'log'] as const;

/**
 * 서버가 밀어 주는 실시간 상태 (/api/stream, SSE). 끊기면 브라우저가 저절로 다시 잇고,
 * 다시 이으면 서버가 지금 상태 전체를 먼저 보낸다.
 */
export function useLiveStream(): StreamState {
	const [state, dispatch] = useReducer((s: StreamState, e: StreamEvent) => reduceStream(s, e), INITIAL_STREAM);
	useEffect(() => {
		const source = new EventSource(api.streamUrl);
		source.onopen = () => dispatch({ type: 'open' });
		source.onerror = () => dispatch({ type: 'error' });
		for (const type of EVENTS) {
			source.addEventListener(type, (ev) => {
				try {
					dispatch({ type, data: JSON.parse((ev as MessageEvent<string>).data) } as StreamEvent);
				} catch {
					// 깨진 이벤트는 버린다 (다음 이벤트가 곧 온다)
				}
			});
		}
		return () => source.close();
	}, []);
	return state;
}

/** 일정 간격으로 바뀌는 지금 시각 (경과 시간 표시용) */
export function useNow(ms: number, active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const t = setInterval(() => setNow(Date.now()), ms);
		return () => clearInterval(t);
	}, [ms, active]);
	return now;
}
