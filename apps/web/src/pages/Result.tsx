import { useEffect, useState } from 'react';
import { KEY_LABEL, api, counts, duration, finalStatus, labelOf, runMs, when } from '../api';
import type { Run, Step, StepStatus } from '../api';
import { go } from '../App';
import { Chip, Deco, DistBar, SectionTitle } from '../ui';

const ORACLE: Record<string, string> = { code: '코드', ai: 'AI', none: '확인 안 함' };

function verdictText(v: Step['results'][number]['verdict']): string {
	if (v === 'pass') return '통과';
	if (v === 'fail') return '실패';
	if (v === 'needs-review') return '확인 필요';
	return '-';
}

export function Result({ id }: { id: string | null }) {
	const [run, setRun] = useState<Run | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sel, setSel] = useState<string | null>(null);

	useEffect(() => {
		const load = async (): Promise<void> => {
			let target = id;
			if (target === null) {
				const runs = await api.runs();
				target = (runs.find((r) => r.finished) ?? runs[0])?.id ?? null;
			}
			if (target === null) {
				setError('아직 결과가 없습니다. 새 검수를 시작하세요.');
				return;
			}
			const r = await api.run(target);
			setRun(r);
			const first =
				r.steps.find((s) => s.status === 'fail') ??
				r.steps.find((s) => s.status === 'needs-review') ??
				r.steps[0];
			setSel(first?.key ?? null);
		};
		load().catch((e: unknown) => setError(String(e)));
	}, [id]);

	if (error !== null)
		return (
			<main className="page">
				<div className="card empty">{error}</div>
			</main>
		);
	if (run === null) return <main className="page">불러오는 중…</main>;

	const label = (s: Step): string => labelOf(run, s);
	const finals = run.steps.map((s) => ({ ...s, status: finalStatus(run, s) }));
	const c = counts(finals);
	const total = run.steps.length;
	const reviews = run.steps.filter((s) => s.status === 'needs-review');
	const decided = reviews.filter((s) => run.decisions?.[s.key] !== undefined).length;
	const fails = finals.filter((s) => s.status === 'fail');
	const idx = Math.max(
		0,
		run.steps.findIndex((s) => s.key === sel)
	);
	const step = run.steps[idx];
	const pct = (n: number): string => (total === 0 ? '0' : ((n / total) * 100).toFixed(1));

	const decide = (key: string, v: 'pass' | 'fail'): void => {
		const next = { ...(run.decisions ?? {}), [key]: v };
		setRun({ ...run, decisions: next });
		void api.decide(run.id, next);
	};

	const stat = (cls: StepStatus, label: string, icon: string, n: number, note: string) => (
		<div className={`stat white ${cls === 'needs-review' ? 'review' : cls === 'not-run' ? 'notrun' : cls}`}>
			<div className="label">
				{label}
				<span className={`icon c-${cls}`}>{icon}</span>
			</div>
			<div className="value">
				{n}
				<small>건</small>
			</div>
			<div className="note">{note}</div>
		</div>
	);

	return (
		<main className="page">
			<Deco />
			<div className="hero">
				<div>
					<div className="eyebrow">QA REPORT</div>
					<h1>검수 결과</h1>
					<p className="sub">
						<b style={{ color: 'var(--navy)' }}>{run.tc}</b> · {when(run.startedAt)} · 소요{' '}
						{duration(runMs(run))} · 브라우저 · {run.url}
					</p>
				</div>
				<div className="actions">
					<a className="btn" href="#/new">
						↻ 다시 검수
					</a>
					<a className="btn primary" href={api.tcUrl(run.id)}>
						⬇ 결과 TC 엑셀 내려받기
					</a>
				</div>
			</div>

			<div className="stats">
				{stat('pass', '통과', '✓', c.pass, `${pct(c.pass)}% · 전체 ${total}단계`)}
				{stat('fail', '실패', '✕', c.fail, `${pct(c.fail)}% · TC에 Failed + 이유 기록`)}
				{stat('needs-review', '확인 필요', '!', c['needs-review'], 'TC에 Passed + [확인 필요] 표시')}
				{stat('not-run', '미실행', '–', c['not-run'], '진입 경로·데이터 없음 등 (빈칸)')}
			</div>
			<div className="card row" style={{ marginTop: 14, padding: '12px 18px' }}>
				<b className="small" style={{ whiteSpace: 'nowrap', color: 'var(--navy)' }}>
					전체 판정 분포
				</b>
				<div style={{ flex: 1 }}>
					<DistBar c={c} total={total} />
				</div>
				<span className="small muted" style={{ whiteSpace: 'nowrap' }}>
					확정 진행 {decided} / {reviews.length}
				</span>
			</div>

			<div className="grid2">
				<div>
					<SectionTitle aside="자동 판정이 애매한 항목이에요">확인 필요 목록</SectionTitle>
					{reviews.length === 0 && <div className="card empty">확인할 항목이 없습니다.</div>}
					{reviews.map((s) => {
						const d = run.decisions?.[s.key];
						return (
							<div key={s.key} className={`card rcard ${d !== undefined ? 'done' : ''}`}>
								<div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setSel(s.key)}>
									<div className="row">
										<span className="tag">{s.key}</span>
										<b>{label(s)}</b>
										<Chip status="needs-review" />
									</div>
									<p className="reason">{s.explanation}</p>
									<div className="small muted" style={{ marginTop: 6 }}>
										판정 근거: {s.basis}
									</div>
								</div>
								<div className="btns">
									{d === undefined ? (
										<>
											<button className="btn ok small" onClick={() => decide(s.key, 'pass')}>
												✓ 통과로 확정
											</button>
											<button className="btn danger small" onClick={() => decide(s.key, 'fail')}>
												✕ 실패로 확정
											</button>
										</>
									) : (
										<Chip status={d} />
									)}
								</div>
							</div>
						);
					})}
				</div>
				<div>
					<SectionTitle>전체 단계</SectionTitle>
					<div className="card">
						<div className="cells">
							{finals.map((s, i) => (
								<button
									key={s.key}
									className={`c-${s.status} ${s.key === sel ? 'sel' : ''}`}
									title={`${s.key} ${label(s)}`}
									onClick={() => setSel(s.key)}
								>
									{i + 1}
								</button>
							))}
						</div>
						<div className="legend">
							<span>
								<i className="c-pass" />
								통과
							</span>
							<span>
								<i className="c-fail" />
								실패
							</span>
							<span>
								<i className="c-needs-review" />
								확인 필요
							</span>
							<span>
								<i className="c-not-run" />
								미실행
							</span>
						</div>
					</div>
					<SectionTitle>실패 항목</SectionTitle>
					<div className="card" style={{ padding: 0 }}>
						{fails.length === 0 && <div className="empty small">실패한 단계가 없습니다.</div>}
						{fails.map((s) => (
							<div
								key={s.key}
								className={`failitem ${s.key === sel ? 'sel' : ''}`}
								onClick={() => setSel(s.key)}
							>
								<div className="row">
									<span className="tag">{s.key}</span>
									<b className="small">{label(s)}</b>
								</div>
								<div className="r">{s.explanation.split('\n')[0]}</div>
							</div>
						))}
					</div>
				</div>
			</div>

			{step !== undefined && (
				<>
					<SectionTitle
						aside={
							<span className="row">
								<button
									className="btn small"
									disabled={idx === 0}
									onClick={() => setSel(run.steps[idx - 1]?.key ?? null)}
								>
									‹ 이전
								</button>
								<button
									className="btn small"
									disabled={idx >= run.steps.length - 1}
									onClick={() => setSel(run.steps[idx + 1]?.key ?? null)}
								>
									다음 ›
								</button>
							</span>
						}
					>
						단계 상세
					</SectionTitle>
					<div className="card">
						<div className="detail-head">
							<span className="tag">{step.key}</span>
							<h2>{label(step)}</h2>
							<Chip status={finalStatus(run, step)} />
							<span className="small muted" style={{ marginLeft: 'auto' }}>
								{step.tcId ?? ''} · {duration(step.ms)}
							</span>
						</div>
						<div className="grid2" style={{ marginTop: 16 }}>
							<div>
								<div
									className="small"
									style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}
								>
									앱 캡처 (목표 위치에 도착한 순간)
								</div>
								<div className="screen">
									{step.screenshot !== null ? (
										<img src={api.fileUrl(run.id, step.screenshot)} alt="앱 캡처" />
									) : (
										<span>캡처 없음 (실행하지 않은 단계)</span>
									)}
								</div>
								<div
									className="small"
									style={{ fontWeight: 700, color: 'var(--navy)', margin: '18px 0 8px' }}
								>
									조건별 판정 (TC 기대 결과를 조건으로 나눔)
								</div>
								<table>
									<thead>
										<tr>
											<th>조건 (TC 기대 결과)</th>
											<th>방법</th>
											<th>판정</th>
											<th>근거</th>
										</tr>
									</thead>
									<tbody>
										{step.results.map((r, i) => (
											<tr key={i} className={r.verdict === 'fail' ? 'bad' : ''}>
												<td className="small">{r.clause}</td>
												<td className="small muted" style={{ whiteSpace: 'nowrap' }}>
													{ORACLE[r.oracle] ?? r.oracle}
												</td>
												<td
													className={`small verdict-${r.verdict ?? 'none'}`}
													style={{ whiteSpace: 'nowrap' }}
												>
													{verdictText(r.verdict)}
												</td>
												<td className="small muted">{r.explanation}</td>
											</tr>
										))}
										{step.results.length === 0 && (
											<tr>
												<td colSpan={4} className="small muted">
													판정한 조건이 없습니다
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
							<div>
								<div className="card" style={{ background: 'var(--light)', border: 0 }}>
									<b style={{ color: 'var(--navy)' }}>판정 설명 (TC Issue Detail에 기록)</b>
									<p className="small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
										{step.explanation === ''
											? '이슈 없음 — 통과한 단계는 Issue Detail을 비웁니다'
											: step.explanation}
									</p>
									<div className="small muted">판정 근거: {step.basis}</div>
								</div>
								<div className="card" style={{ marginTop: 14 }}>
									<b style={{ color: 'var(--navy)' }}>리모컨 입력 경로</b>
									<div className="keys" style={{ marginTop: 10 }}>
										{step.trail
											.filter((t) => t.key !== null || t.action !== undefined)
											.slice(0, 40)
											.map((t, i) => (
												<span key={i} className="key dim" title={t.focus}>
													{t.action ?? KEY_LABEL[t.key ?? ''] ?? t.key}
												</span>
											))}
									</div>
									<div className="small muted" style={{ marginTop: 10 }}>
										TC 원본의 {step.sheet} 시트 {step.row}행에 기록 · 키에 마우스를 올리면 그때
										포커스가 보입니다
									</div>
								</div>
								<button className="btn small" style={{ marginTop: 14 }} onClick={() => go('/live')}>
									실행 화면으로
								</button>
							</div>
						</div>
					</div>
				</>
			)}
		</main>
	);
}
