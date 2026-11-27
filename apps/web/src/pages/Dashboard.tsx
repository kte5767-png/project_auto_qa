import { useEffect, useState } from 'react';
import { api, counts, duration, finalStatus, labelOf, runMs, when } from '../api';
import type { LiveState, Run } from '../api';
import { go } from '../App';
import { Chip, Deco, DistBar, SectionTitle } from '../ui';

export function Dashboard({ live }: { live: LiveState | null }) {
	const [runs, setRuns] = useState<Run[] | null>(null);

	useEffect(() => {
		api.runs()
			.then(setRuns)
			.catch(() => setRuns([]));
	}, [live?.running]);

	const done = (runs ?? []).filter((r) => r.finished && r.steps.length > 0);
	const current = (runs ?? []).find((r) => !r.finished);
	const latest = done[0];
	const passRate =
		done.length === 0 ? null : done.reduce((a, r) => a + counts(r.steps).pass / r.steps.length, 0) / done.length;
	const review = latest === undefined ? [] : latest.steps.filter((s) => finalStatus(latest, s) === 'needs-review');
	const avgMs = done.length === 0 ? 0 : done.reduce((a, r) => a + runMs(r), 0) / done.length;

	return (
		<main className="page">
			<Deco />
			<div className="hero">
				<div>
					<div className="eyebrow">TV APP AUTO QA</div>
					<h1>검수 대시보드</h1>
					<p className="sub">
						TC 엑셀과 UX 시나리오(화면설계서)로 TV 앱을 리모컨 조작하며 자동 검수하고, 결과를 TC 원본에
						기록합니다.
					</p>
				</div>
				<div className="actions">
					<a className="btn" href="#/live">
						● 검수 중 보기
					</a>
					<a className="btn primary" href="#/new">
						+ 새 검수
					</a>
				</div>
			</div>

			{current !== undefined && (
				<div className="card row between" style={{ marginBottom: 18 }}>
					<div>
						<span className="chip running">진행 중</span>
						<div style={{ fontWeight: 800, color: 'var(--navy)', marginTop: 6 }}>{current.tc}</div>
					</div>
					<div style={{ flex: 1, margin: '0 24px' }}>
						<div className="row between small">
							<span>{current.current ?? '마무리 중'}</span>
							<b>
								{current.steps.length} / {current.planned?.length ?? '?'} 단계
							</b>
						</div>
						<DistBar c={counts(current.steps)} total={current.planned?.length ?? current.steps.length} />
					</div>
					<a className="btn small" href="#/live">
						실시간 보기 →
					</a>
				</div>
			)}

			<div className="stats">
				<div className="stat">
					<div className="label">완료한 검수</div>
					<div className="value">
						{done.length}
						<small>회</small>
					</div>
					<div className="note">이 PC에서 실행한 기록</div>
				</div>
				<div className="stat">
					<div className="label">평균 통과율</div>
					<div className="value">
						{passRate === null ? '-' : (passRate * 100).toFixed(1)}
						<small>%</small>
					</div>
					<div className="note">자동 대상 단계 기준</div>
				</div>
				<div className="stat">
					<div className="label">확인 필요 대기</div>
					<div className="value" style={{ color: 'var(--review)' }}>
						{review.length}
						<small>건</small>
					</div>
					<div className="note">최근 검수에서 사람이 확정할 항목</div>
				</div>
				<div className="stat">
					<div className="label">평균 검수 시간</div>
					<div className="value">
						{avgMs < 60000 ? Math.round(avgMs / 1000) : Math.round(avgMs / 60000)}
						<small>{avgMs < 60000 ? '초' : '분'}</small>
					</div>
					<div className="note">단계 실행 시간 합</div>
				</div>
			</div>

			<div className="grid2">
				<div>
					<SectionTitle>최근 검수</SectionTitle>
					<div className="card" style={{ padding: 0 }}>
						{runs === null && <div className="empty">불러오는 중…</div>}
						{runs !== null && runs.length === 0 && (
							<div className="empty">아직 실행한 검수가 없습니다. 새 검수를 시작하세요.</div>
						)}
						{runs !== null && runs.length > 0 && (
							<table>
								<thead>
									<tr>
										<th>TC 파일</th>
										<th>실행 일시</th>
										<th style={{ width: 230 }}>결과 (통과 / 실패 / 확인 필요)</th>
										<th>상태</th>
									</tr>
								</thead>
								<tbody>
									{runs.slice(0, 8).map((r) => {
										const c = counts(r.steps);
										const total = r.planned?.length ?? r.steps.length;
										return (
											<tr
												key={r.id}
												className="click"
												onClick={() => go(r.finished ? `/result/${r.id}` : '/live')}
											>
												<td>
													<b>{r.tc}</b>
													<div className="small muted">{total}단계 · 브라우저</div>
												</td>
												<td className="small">{when(r.startedAt)}</td>
												<td>
													<div className="small" style={{ marginBottom: 4 }}>
														<b style={{ color: 'var(--pass)' }}>{c.pass}</b> /{' '}
														<b style={{ color: 'var(--fail)' }}>{c.fail}</b> /{' '}
														<b style={{ color: 'var(--review)' }}>{c['needs-review']}</b>
														<span className="muted"> · 미실행 {c['not-run']}</span>
													</div>
													<DistBar c={c} total={total} />
												</td>
												<td>
													{r.finished ? (
														<span className="chip pass">완료 · {duration(runMs(r))}</span>
													) : (
														<Chip status="running" />
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						)}
					</div>
				</div>
				<div>
					<SectionTitle>처리 과정</SectionTitle>
					<div className="process">
						<div className="p">
							<span className="stepbadge">Step 1</span>
							<b>파일 올리기</b>
							<span className="small muted">TC 엑셀 · UX 시나리오(화면설계서) · 앱 프로필</span>
						</div>
						<div className="p">
							<span className="stepbadge">Step 2</span>
							<b>리모컨 자동 조작</b>
							<span className="small muted">화면설계서 키 동작으로 길을 계산하고 한 키씩 확인</span>
						</div>
						<div className="p">
							<span className="stepbadge">Step 3</span>
							<b>판정 · TC 원본에 기록</b>
							<span className="small muted">
								조건별 코드 판정 → P/F · Issue Detail (고객 양식 그대로)
							</span>
						</div>
					</div>
					<SectionTitle>확인 필요 대기</SectionTitle>
					<div className="card" style={{ padding: 0 }}>
						{review.length === 0 && <div className="empty">확인할 항목이 없습니다.</div>}
						{latest !== undefined &&
							review.slice(0, 5).map((s) => (
								<div key={s.key} className="failitem" onClick={() => go(`/result/${latest.id}`)}>
									<div className="row between">
										<b className="small">{labelOf(latest, s)}</b>
										<span className="small muted">{s.key}</span>
									</div>
									<div className="small muted" style={{ marginTop: 4 }}>
										{s.explanation.split('\n')[0]}
									</div>
								</div>
							))}
					</div>
				</div>
			</div>
		</main>
	);
}
