import { useEffect, useRef } from 'react';
import { api, counts, duration, labelOf, stepName } from '../api';
import type { Planned, Run, Step } from '../api';
import { go } from '../App';
import { VIEW_STAGE_LABEL, isActive, logTone, sheetNames, shownTrail, trailChips, viewStage } from '../live';
import type { StreamState, ViewStage } from '../live';
import { Chip } from '../ui';
import { useNow } from '../useLiveStream';

/** 리모컨 입력 칸에 보일 최근 기록 수 */
const TRAIL_SHOWN = 14;
/** 진행 파일이 이만큼 갱신되지 않으면 마지막 갱신 시각을 보여 준다 (오래 기다리는 중인지 알 수 있게) */
const STALE_MS = 10_000;

const STAGE_CHIP: Record<ViewStage, string> = {
	preparing: 'running',
	running: 'running',
	writing: 'running',
	done: 'pass',
	stopped: 'not-run',
	'ended-early': 'fail'
};

function StageChip({ stage }: { stage: ViewStage }) {
	return <span className={`chip ${STAGE_CHIP[stage]}`}>{VIEW_STAGE_LABEL[stage]}</span>;
}

function Connection({ connected }: { connected: boolean }) {
	return (
		<span className={`conn ${connected ? 'on' : ''}`} title="검수 중 화면은 바뀌는 즉시 받습니다">
			<i />
			{connected ? '실시간 연결' : '다시 연결 중…'}
		</span>
	);
}

/** 단계 목록: 지금 단계가 늘 보이게 따라 내려간다 */
function StepList({
	run,
	planned,
	byKey,
	phase,
	stepElapsed
}: {
	run: Run;
	planned: Planned[];
	byKey: Map<string, Step>;
	phase: string | null;
	stepElapsed: number | null;
}) {
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = box.current?.querySelector<HTMLElement>('.item.current');
		const c = box.current;
		if (el == null || c === null) return;
		const top = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
		c.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
	}, [run.current]);
	return (
		<div className="card steplist" ref={box}>
			<div className="row between" style={{ padding: '14px 14px 10px' }}>
				<b style={{ color: 'var(--navy)', fontFamily: 'var(--head)' }}>단계 목록</b>
				<span className="small muted">{sheetNames(planned.map((p) => p.key))}</span>
			</div>
			{planned.map((p) => {
				const s = byKey.get(p.key);
				const isCur = p.key === run.current && s === undefined;
				return (
					<div
						key={p.key}
						className={`item ${isCur ? 'current' : ''} ${s === undefined && !isCur ? 'waiting' : ''}`}
						onClick={() => s !== undefined && go(`/result/${run.id}`)}
					>
						<span className="k">{p.key}</span>
						<span className="t">
							{stepName(p)}
							{isCur && (
								<span className="sub-phase">
									{phase ?? '시작'}
									{stepElapsed !== null && ` · ${duration(stepElapsed)}`}
								</span>
							)}
						</span>
						{s !== undefined ? <Chip status={s.status} /> : <Chip status={isCur ? 'running' : 'waiting'} />}
					</div>
				);
			})}
		</div>
	);
}

/** 실행 로그: 맨 아래를 보고 있을 때만 따라 내려간다 (위로 올려 읽는 중이면 그대로) */
function Log({ lines, own }: { lines: string[]; own: boolean }) {
	const box = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	useEffect(() => {
		const c = box.current;
		if (c !== null && stick.current) c.scrollTop = c.scrollHeight;
	}, [lines]);
	return (
		<div
			className="log"
			ref={box}
			style={{ marginTop: 16 }}
			onScroll={(e) => {
				const c = e.currentTarget;
				stick.current = c.scrollTop + c.clientHeight >= c.scrollHeight - 24;
			}}
		>
			{lines.length === 0 ? (
				<span className="muted">
					{own ? '실행 로그를 기다리는 중…' : '실행 로그 (이 화면에서 시작한 검수만 보입니다)'}
				</span>
			) : (
				lines.map((line, i) => {
					const tone = logTone(line);
					return (
						<div key={i} className={tone === null ? undefined : `l-${tone}`}>
							{line}
						</div>
					);
				})
			)}
		</div>
	);
}

export function LiveRun({ stream }: { stream: StreamState }) {
	const { run, live, runId, frame, connected } = stream;
	const stage = viewStage(run, live, runId);
	const active = isActive(stage);
	const now = useNow(500, active);

	if (!connected && live === null) return <main className="page">불러오는 중…</main>;
	if (run === null) {
		if (stage === 'preparing')
			return (
				<main className="page">
					<div className="card">
						<div className="row small muted">
							<StageChip stage="preparing" />
							<Connection connected={connected} />
						</div>
						<h1 style={{ fontSize: 26, margin: '10px 0 6px' }}>검수를 준비하고 있습니다</h1>
						<div className="muted">TC 파일과 화면설계서를 읽고 브라우저를 여는 중입니다.</div>
					</div>
					<Log lines={stream.log} own />
				</main>
			);
		return (
			<main className="page">
				<div className="card empty">
					진행 중인 검수가 없습니다. <a href="#/new">새 검수</a>를 시작하세요.
				</div>
			</main>
		);
	}

	const planned =
		run.planned ??
		run.steps.map((s) => ({ key: s.key, screen: s.screen, callout: s.callout, label: s.title ?? '' }));
	const byKey = new Map(run.steps.map((s) => [s.key, s]));
	const total = planned.length;
	const c = counts(run.steps);
	const lastWithShot = [...run.steps].reverse().find((s) => s.screenshot !== null);
	const last: Step | undefined = run.steps.at(-1);
	const shown = shownTrail(run);
	const chips = trailChips(shown.trail, TRAIL_SHOWN);
	const lastDetail = shown.trail.at(-1)?.focus ?? null;
	const end = active ? now : new Date(run.updatedAt).getTime();
	const elapsed = Math.max(0, end - new Date(run.startedAt).getTime());
	const stepElapsed =
		run.currentStartedAt == null ? null : Math.max(0, now - new Date(run.currentStartedAt).getTime());
	const avg = run.steps.length === 0 ? 0 : elapsed / run.steps.length;
	const remain = active && run.steps.length > 0 ? avg * (total - run.steps.length) : null;
	const flagged = run.steps.filter((s) => s.status === 'fail' || s.status === 'needs-review').reverse();
	const own = live?.runId === run.id;
	const stopable = own && live.running;
	const sinceUpdate = now - new Date(run.updatedAt).getTime();
	const currentPlan = planned.find((p) => p.key === run.current);
	const useFrame = frame !== null && (active || lastWithShot === undefined);
	const preview = useFrame
		? `${api.fileUrl(run.id, 'live.jpg')}?v=${encodeURIComponent(frame)}`
		: lastWithShot?.screenshot != null
			? api.fileUrl(run.id, lastWithShot.screenshot)
			: null;

	return (
		<main className="page">
			<div className="card" style={{ marginBottom: 20 }}>
				<div className="row between">
					<div>
						<div className="row small muted">
							{stage !== null && <StageChip stage={stage} />}
							<Connection connected={connected} />
							브라우저 · Chromium · 1920×1080 · {run.url}
						</div>
						<h1 style={{ fontSize: 30, margin: '6px 0 0' }}>{run.tc}</h1>
						{active && sinceUpdate > STALE_MS && (
							<div className="small muted" style={{ marginTop: 4 }}>
								마지막 갱신 {duration(sinceUpdate)} 전 — 화면이 준비되기를 기다리는 중일 수 있습니다
							</div>
						)}
					</div>
					<div className="row" style={{ gap: 24 }}>
						<div>
							<div className="small muted">경과</div>
							<b style={{ fontSize: 20, color: 'var(--navy)' }}>{duration(elapsed)}</b>
						</div>
						<div>
							<div className="small muted">남은 시간 (예상)</div>
							<b style={{ fontSize: 20, color: 'var(--navy)' }}>
								{remain === null ? '-' : `약 ${duration(remain)}`}
							</b>
						</div>
						{stopable ? (
							<button className="btn danger" onClick={() => void api.stop()}>
								■ 중지
							</button>
						) : (
							<button className="btn primary" onClick={() => go(`/result/${run.id}`)}>
								결과 보기 →
							</button>
						)}
					</div>
				</div>
				<div className="row" style={{ marginTop: 14, alignItems: 'flex-end', gap: 18 }}>
					<div>
						<div className="small muted">진행률</div>
						<span
							style={{ fontFamily: 'var(--head)', fontSize: 40, fontWeight: 800, color: 'var(--navy)' }}
						>
							{run.steps.length}
						</span>
						<span className="muted" style={{ fontSize: 20 }}>
							{' '}
							/ {total}
						</span>
						<b style={{ marginLeft: 8, color: 'var(--navy)' }}>
							{total === 0 ? 0 : Math.round((run.steps.length / total) * 100)}%
						</b>
					</div>
					<div style={{ flex: 1 }}>
						<div className="segments">
							{planned.map((p) => {
								const s = byKey.get(p.key);
								const cls = s !== undefined ? `c-${s.status}` : p.key === run.current ? 'running' : '';
								return <span key={p.key} className={cls} title={`${p.key} ${stepName(p)}`} />;
							})}
						</div>
						<div className="legend">
							<span>
								<i className="c-pass" />
								통과 {c.pass}
							</span>
							<span>
								<i className="c-fail" />
								실패 {c.fail}
							</span>
							<span>
								<i className="c-needs-review" />
								확인 필요 {c['needs-review']}
							</span>
							<span>
								<i className="c-not-run" />
								미실행 {c['not-run']}
							</span>
							<span>대기 {total - run.steps.length}</span>
						</div>
					</div>
				</div>
			</div>

			<div className="grid3">
				<StepList
					run={run}
					planned={planned}
					byKey={byKey}
					phase={run.phase ?? null}
					stepElapsed={stepElapsed}
				/>

				<div>
					<div className="card">
						<div className="row between" style={{ marginBottom: 12 }}>
							<div className="row">
								<b style={{ color: 'var(--navy)', fontFamily: 'var(--head)', fontSize: 16 }}>
									실시간 미리보기
								</b>
								{useFrame && active && <span className="livebadge">LIVE</span>}
							</div>
							<span className="small muted">
								{useFrame
									? '앱 화면 (바뀌는 즉시)'
									: lastWithShot === undefined
										? ''
										: `${lastWithShot.key} 캡처`}
							</span>
						</div>
						<div className="screen">
							{preview !== null ? (
								<img src={preview} alt="앱 화면" />
							) : (
								<span>{active ? '앱 화면을 기다리는 중' : '캡처 없음'}</span>
							)}
						</div>
						<div style={{ marginTop: 14 }}>
							<div className="small muted">지금 확인 중</div>
							<div style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)', margin: '2px 0 4px' }}>
								{run.current === null
									? stage === null
										? '-'
										: stage === 'running'
											? '다음 단계 준비 중'
											: VIEW_STAGE_LABEL[stage]
									: `${run.current} ${stepName(currentPlan ?? { screen: '', callout: null, label: '' })}`}
							</div>
							{active && (run.phase != null || stepElapsed !== null) && (
								<div className="phase">
									<i />
									{run.phase ?? '시작'}
									{stepElapsed !== null && (
										<span className="muted"> · 이 단계 {duration(stepElapsed)}</span>
									)}
								</div>
							)}
							<div className="small muted" style={{ margin: '10px 0 6px' }}>
								리모컨 입력{' '}
								{shown.key === null ? '' : `(${shown.key}${shown.live ? ' · 실시간' : ' · 끝난 단계'})`}
							</div>
							<div className="keys">
								{chips.length === 0 && <span className="small muted">-</span>}
								{chips.map((t, i) => (
									<span
										key={shown.trail.length - chips.length + i}
										className={`key ${t.kind === 'action' ? 'act' : ''} ${i === chips.length - 1 ? 'last' : 'dim'}`}
										title={t.detail}
									>
										{t.label}
									</span>
								))}
							</div>
							{lastDetail !== null && (
								<div className="small muted focusline" title={lastDetail}>
									→ {lastDetail}
								</div>
							)}
						</div>
					</div>
					{last !== undefined && (
						<div className="card" style={{ marginTop: 16 }}>
							<div className="row" style={{ marginBottom: 10 }}>
								<span className="tag">{last.key}</span>
								<b>{labelOf(run, last)}</b>
								<Chip status={last.status} />
							</div>
							<table>
								<tbody>
									{last.results.slice(0, 6).map((r, i) => (
										<tr key={i}>
											<td className="small">{r.clause}</td>
											<td
												className={`small verdict-${r.verdict ?? 'none'}`}
												style={{ whiteSpace: 'nowrap' }}
											>
												{r.verdict === 'pass'
													? '✓ 일치'
													: r.verdict === 'fail'
														? '✕ 다름'
														: r.verdict === 'needs-review'
															? '확인 필요'
															: '확인 안 함'}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<Log lines={own ? stream.log : []} own={own} />
				</div>

				<div className="card quick">
					<div className="quick-head">
						<h3>바로 확인</h3>
						<div className="row">
							<span className="chip fail">실패 {c.fail}</span>
							<span className="chip needs-review">확인 필요 {c['needs-review']}</span>
						</div>
					</div>
					{flagged.length === 0 && (
						<div className="empty small">아직 없습니다. 실패·확인 필요 항목이 생기면 위에 쌓입니다.</div>
					)}
					{flagged.map((s) => (
						<div
							key={s.key}
							className={`qcard ${s.status === 'fail' ? 'fail' : ''} fresh`}
							onClick={() => go(`/result/${run.id}`)}
						>
							<div style={{ flex: 1 }}>
								<div className="row">
									<span className="tag">{s.key}</span>
									<Chip status={s.status} />
								</div>
								<div className="t">{labelOf(run, s)}</div>
								<div className="small muted">{s.explanation.split('\n')[0]}</div>
							</div>
							{s.screenshot !== null && <img src={api.fileUrl(run.id, s.screenshot)} alt="" />}
						</div>
					))}
				</div>
			</div>
		</main>
	);
}
