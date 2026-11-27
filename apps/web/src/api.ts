export type StepStatus = 'pass' | 'fail' | 'needs-review' | 'not-run';

export interface Clause {
	clause: string;
	kind: string;
	oracle: string;
	verdict: 'pass' | 'fail' | 'needs-review' | null;
	explanation: string;
}

export interface TrailItem {
	key: string | null;
	focus: string;
	stable: boolean;
	action?: string;
}

export interface Step {
	key: string;
	sheet: string;
	row: number;
	tcId: string | null;
	title: string | null;
	screen: string;
	callout: string | null;
	status: StepStatus;
	explanation: string;
	basis: string;
	results: Clause[];
	trail: TrailItem[];
	screenshot: string | null;
	ms: number;
}

export interface Planned {
	key: string;
	screen: string;
	callout: string | null;
	label: string;
}

export interface Run {
	id: string;
	tc: string;
	tcPath?: string;
	url: string;
	startedAt: string;
	updatedAt: string;
	finished: boolean;
	current: string | null;
	planned: Planned[] | null;
	steps: Step[];
	decisions?: Record<string, 'pass' | 'fail'>;
}

export interface Settings {
	tc: string;
	profile: string;
	spec: string;
	url: string;
	headed: boolean;
	overwrite: boolean;
}

export interface LiveState {
	running: boolean;
	exitCode: number | null;
	startedAt: string | null;
	log: string[];
}

async function json<T>(res: Response): Promise<T> {
	const data = (await res.json()) as T & { error?: string };
	if (!res.ok) throw new Error(data.error ?? `${res.status}`);
	return data;
}

export const api = {
	runs: () => fetch('/api/runs').then((r) => json<Run[]>(r)),
	run: (id: string) => fetch(`/api/runs/${id}`).then((r) => json<Run>(r)),
	live: () => fetch('/api/live').then((r) => json<LiveState>(r)),
	settings: () => fetch('/api/settings').then((r) => json<Settings>(r)),
	check: (path: string) =>
		fetch(`/api/check?path=${encodeURIComponent(path)}`).then((r) => json<{ exists: boolean }>(r)),
	ping: (url: string) =>
		fetch(`/api/ping?url=${encodeURIComponent(url)}`).then((r) =>
			json<{ ok: boolean; status: number; ms: number }>(r)
		),
	start: (s: Settings) =>
		fetch('/api/run', { method: 'POST', body: JSON.stringify(s) }).then((r) => json<{ startedAt: string }>(r)),
	stop: () => fetch('/api/stop', { method: 'POST' }).then((r) => json<{ stopped: boolean }>(r)),
	decide: (id: string, decisions: Record<string, 'pass' | 'fail'>) =>
		fetch(`/api/runs/${id}/decisions`, { method: 'POST', body: JSON.stringify(decisions) }).then((r) =>
			json<{ saved: boolean }>(r)
		),
	fileUrl: (id: string, name: string) => `/api/runs/${id}/file/${encodeURIComponent(name)}`,
	tcUrl: (id: string) => `/api/runs/${id}/tc`
};

export const STATUS_LABEL: Record<StepStatus | 'waiting' | 'running', string> = {
	pass: '통과',
	fail: '실패',
	'needs-review': '확인 필요',
	'not-run': '미실행',
	waiting: '대기',
	running: '진행 중'
};

export const KEY_LABEL: Record<string, string> = {
	UP: '▲',
	DOWN: '▼',
	LEFT: '◀',
	RIGHT: '▶',
	OK: 'OK',
	BACK: 'Back',
	HOME: 'Home'
};

export function counts(steps: Step[]): Record<StepStatus, number> {
	const c: Record<StepStatus, number> = { pass: 0, fail: 0, 'needs-review': 0, 'not-run': 0 };
	for (const s of steps) c[s.status]++;
	return c;
}

export function circled(callout: string | null): string {
	if (callout === null) return '';
	const n = Number(callout);
	return Number.isInteger(n) && n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${callout})`;
}

export function stepName(s: { screen: string; callout: string | null; title?: string | null; label?: string }): string {
	return `${s.screen} ${circled(s.callout)} ${s.label ?? s.title ?? ''}`.replace(/\s+/g, ' ').trim();
}

export function duration(ms: number): string {
	const sec = Math.round(ms / 1000);
	return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

export function when(iso: string): string {
	const d = new Date(iso);
	const p = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function runMs(run: Run): number {
	return run.steps.reduce((a, s) => a + s.ms, 0);
}

/** 사람이 확정한 결과를 반영한 상태 (확인 필요 → 통과/실패) */
export function finalStatus(run: Run, s: Step): StepStatus {
	const d = run.decisions?.[s.key];
	return s.status === 'needs-review' && d !== undefined ? d : s.status;
}

/** 단계 이름: 실행 계획의 콜아웃 이름(TC 참조)이 있으면 그것, 없으면 TC 제목 */
export function labelOf(run: Run, s: Step): string {
	const p = run.planned?.find((x) => x.key === s.key);
	return stepName(p ?? s);
}
