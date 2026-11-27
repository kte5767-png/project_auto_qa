import { useEffect, useRef, useState } from 'react';
import { KEY_LABEL, api, counts, duration, labelOf, stepName } from '../api';
import type { LiveState, Run, Step } from '../api';
import { go } from '../App';
import { Chip } from '../ui';

export function LiveRun({ live }: { live: LiveState | null }) {
	const [run, setRun] = useState<Run | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const logRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let alive = true;
		const tick = (): void => {
			api.runs()
				.then((rs) => {
					if (!alive) return;
					setRun(rs[0] ?? null);
					setLoaded(true);
					setNow(Date.now());
				})
				.catch(() => setLoaded(true));
		};
		tick();
		const t = setInterval(tick, 1500);
		return () => {
			alive = false;
			clearInterval(t);
		};
	}, []);

	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
	}, [live?.log.length]);

	if (!loaded) return <main className="page">불러오는 중…</main>;
	if (run === null)
		return (
			<main className="page">
				<div className="card empty">
					진행 중인 검수가 없습니다. <a href="#/new">새 검수</a>를 시작하세요.
				</div>
			</main>
		);

	const planned =
		run.planned ??
		run.steps.map((s) => ({ key: s.key, screen: s.screen, callout: s.callout, label: s.title ?? '' }));
	const byKey = new Map(run.steps.map((s) => [s.key, s]));
	const total = planned.length;
	const c = counts(run.steps);
	const lastWithShot = [...run.steps].reverse().find((s) => s.screenshot !== null);
	const last: Step | undefined = run.steps.at(-1);
	const keys = (last?.trail ?? []).filter((t) => t.key !== null).slice(-10);
	const elapsed = (run.finished ? new Date(run.updatedAt).getTime() : now) - new Date(run.startedAt).getTime();
	const avg = run.steps.length === 0 ? 0 : elapsed / run.steps.length;
	const remain = run.finished ? 0 : avg * (total - run.steps.length);
	const flagged = run.steps.filter((s) => s.status === 'fail' || s.status === 'needs-review').reverse();
	const running = live?.running === true && !run.finished;

	return (
		<main className="page">
			<div className="card" style={{ marginBottom: 20 }}>
				<div className="row between">
					<div>
						<div className="row small muted">
							{running ? <Chip status="running" /> : <span className="chip pass">완료</span>}
							브라우저 · Chromium · 1920×1080 · {run.url}
						</div>
						<h1 style={{ fontSize: 30, margin: '6px 0 0' }}>{run.tc}</h1>
					</div>
					<div className="row" style={{ gap: 24 }}>
						<div>
							<div className="small muted">경과</div>
							<b style={{ fontSize: 20, color: 'var(--navy)' }}>{duration(elapsed)}</b>
						</div>
						<div>
							<div className="small muted">남은 시간 (예상)</div>
							<b style={{ fontSize: 20, color: 'var(--navy)' }}>
								{run.finished ? '-' : `약 ${duration(remain)}`}
							</b>
						</div>
						{running ? (
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
				<div className="card steplist">
					<div className="row between" style={{ padding: '14px 14px 10px' }}>
						<b style={{ color: 'var(--navy)', fontFamily: 'var(--head)' }}>단계 목록</b>
						<span className="small muted">Search 시트</span>
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
								<span className="t">{stepName(p)}</span>
								{s !== undefined ? (
									<Chip status={s.status} />
								) : (
									<Chip status={isCur ? 'running' : 'waiting'} />
								)}
							</div>
						);
					})}
				</div>

				<div>
					<div className="card">
						<div className="row between" style={{ marginBottom: 12 }}>
							<div className="row">
								<b style={{ color: 'var(--navy)', fontFamily: 'var(--head)', fontSize: 16 }}>
									실시간 미리보기
								</b>
								{running && <span className="livebadge">LIVE</span>}
							</div>
							<span className="small muted">
								{lastWithShot === undefined ? '' : `${lastWithShot.key} 캡처`}
							</span>
						</div>
						<div className="screen">
							{lastWithShot !== undefined && lastWithShot.screenshot !== null ? (
								<img
									src={`${api.fileUrl(run.id, lastWithShot.screenshot)}?t=${run.steps.length}`}
									alt="앱 화면"
								/>
							) : (
								<span>첫 단계 캡처를 기다리는 중</span>
							)}
						</div>
						<div style={{ marginTop: 14 }}>
							<div className="small muted">지금 확인 중</div>
							<div style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)', margin: '2px 0 10px' }}>
								{run.current === null
									? run.finished
										? '검수 완료'
										: '-'
									: `${run.current} ${stepName(planned.find((p) => p.key === run.current) ?? { screen: '', callout: null, label: '' })}`}
							</div>
							<div className="small muted" style={{ marginBottom: 6 }}>
								최근 입력한 리모컨 키 {last === undefined ? '' : `(${last.key})`}
							</div>
							<div className="keys">
								{keys.length === 0 && <span className="small muted">-</span>}
								{keys.map((t, i) => (
									<span
										key={i}
										className={`key ${i === keys.length - 1 ? '' : 'dim'}`}
										title={t.focus}
									>
										{KEY_LABEL[t.key ?? ''] ?? t.key}
									</span>
								))}
							</div>
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
					<div className="log" ref={logRef} style={{ marginTop: 16 }}>
						{(live?.log ?? []).slice(-120).join('\n') || '실행 로그 (이 화면에서 시작한 검수만 보입니다)'}
					</div>
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
							className={`qcard ${s.status === 'fail' ? 'fail' : ''}`}
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
