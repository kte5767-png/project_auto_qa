import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Settings } from '../api';
import { go } from '../App';
import { Deco, SectionTitle } from '../ui';

type Check = boolean | null;

function useExists(path: string): Check {
	const [ok, setOk] = useState<Check>(null);
	useEffect(() => {
		if (path.trim() === '') {
			setOk(null);
			return;
		}
		const t = setTimeout(() => {
			api.check(path)
				.then((r) => setOk(r.exists))
				.catch(() => setOk(false));
		}, 300);
		return () => clearTimeout(t);
	}, [path]);
	return ok;
}

function FileBox({
	title,
	hint,
	value,
	ok,
	onChange
}: {
	title: string;
	hint: string;
	value: string;
	ok: Check;
	onChange: (v: string) => void;
}) {
	return (
		<div className={`file ${ok === true ? 'ok' : ''}`}>
			<label>
				{title}
				<span style={{ color: ok === true ? 'var(--pass)' : ok === false ? 'var(--fail)' : 'var(--review)' }}>
					{ok === true ? '● 확인됨' : ok === false ? '● 없음' : '필요'}
				</span>
			</label>
			<input type="text" value={value} placeholder={hint} onChange={(e) => onChange(e.target.value)} />
		</div>
	);
}

export function NewRun({ running }: { running: boolean }) {
	const [s, setS] = useState<Settings | null>(null);
	const [ping, setPing] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api.settings()
			.then(setS)
			.catch((e: unknown) => setError(String(e)));
	}, []);

	const tcOk = useExists(s?.tc ?? '');
	const specOk = useExists(s?.spec ?? '');
	const profileOk = useExists(s?.profile ?? '');

	if (s === null) return <main className="page">{error ?? '불러오는 중…'}</main>;
	const set = (patch: Partial<Settings>): void => setS({ ...s, ...patch });
	const ready = tcOk === true && specOk === true && profileOk === true && !running;

	const start = async (): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			await api.start(s);
			go('/live');
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const checkUrl = async (): Promise<void> => {
		setPing('확인 중…');
		const r = await api.ping(s.url);
		setPing(
			r.ok
				? `연결됨 · 응답 ${r.status} · ${(r.ms / 1000).toFixed(1)}초`
				: '연결 안 됨 — 대상 앱(enact serve)이 켜져 있는지 확인하세요'
		);
	};

	return (
		<main className="page">
			<Deco />
			<div className="small muted">홈 › 새 검수</div>
			<h1>새 검수</h1>
			<p className="sub">TC 엑셀과 UX 시나리오만 있으면 리모컨 조작부터 판정, TC 기록까지 자동으로 진행합니다.</p>

			<div className="grid2" style={{ marginTop: 12 }}>
				<div>
					<SectionTitle aside={`${[tcOk, specOk, profileOk].filter((x) => x === true).length} / 3`}>
						<span className="stepbadge">Step 1</span> 파일
					</SectionTitle>
					<div className="files">
						<FileBox
							title="TC 엑셀 (결과를 기록할 원본)"
							hint="C:/Users/.../TC.xlsx"
							value={s.tc}
							ok={tcOk}
							onChange={(tc) => set({ tc })}
						/>
						<FileBox
							title="UX 시나리오 (화면설계서)"
							hint="spikes/p0-8-e2e/spec"
							value={s.spec}
							ok={specOk}
							onChange={(spec) => set({ spec })}
						/>
						<FileBox
							title="앱 프로필"
							hint="spikes/p0-8-e2e/profile.local.json"
							value={s.profile}
							ok={profileOk}
							onChange={(profile) => set({ profile })}
						/>
					</div>
					<p className="small muted" style={{ marginTop: 8 }}>
						GUI는 TC 판정에 쓰지 않고, 별도 디자인 비교 기능으로 제공합니다 (기획 고정 D-044). 기록 전 TC
						원본은 자동으로 백업됩니다.
					</p>

					<SectionTitle>
						<span className="stepbadge">Step 2</span> 앱 주소
					</SectionTitle>
					<div className="card">
						<div className="small" style={{ fontWeight: 700, color: 'var(--navy)' }}>
							검수할 웹 TV 앱 URL (비우면 앱 프로필의 주소)
						</div>
						<div className="row" style={{ marginTop: 4 }}>
							<input
								type="text"
								value={s.url}
								placeholder="http://localhost:8091/"
								onChange={(e) => set({ url: e.target.value })}
							/>
							<button
								className="btn"
								style={{ marginTop: 8 }}
								disabled={s.url.trim() === ''}
								onClick={() => void checkUrl()}
							>
								연결 확인
							</button>
						</div>
						{ping !== null && (
							<div
								className="small"
								style={{
									marginTop: 8,
									color: ping.startsWith('연결됨') ? 'var(--pass)' : 'var(--gray)'
								}}
							>
								{ping}
							</div>
						)}
					</div>

					<SectionTitle>
						<span className="stepbadge">Step 3</span> 실행 환경
					</SectionTitle>
					<div className="envs">
						<button
							className={`env ${s.device === true ? 'off' : 'on'}`}
							type="button"
							onClick={() => set({ device: false })}
						>
							<b style={{ color: 'var(--navy)' }}>브라우저 (시뮬레이터)</b>
							<div className="small muted">Chromium에서 앱을 열고 리모컨 키를 보냅니다 · 1920×1080</div>
							<label className="small row" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
								<input
									type="checkbox"
									checked={s.headed}
									onChange={(e) => set({ headed: e.target.checked })}
								/>
								실행 화면 띄워서 보기
							</label>
							<label className="small row" style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
								<input
									type="checkbox"
									checked={s.overwrite}
									onChange={(e) => set({ overwrite: e.target.checked })}
								/>
								이미 값이 있는 P/F 칸도 다시 쓰기
							</label>
						</button>
						<button
							className={`env ${s.device === true ? 'on' : 'off'}`}
							type="button"
							onClick={() => set({ device: true })}
						>
							<b style={s.device === true ? { color: 'var(--navy)' } : {}}>TV 실기기 (webOS)</b>{' '}
							<span className="chip waiting">시험</span>
							<div className="small">
								개발자 모드 TV에 직접 연결해 검수합니다 · 프로젝트 .env의 WEBOS_HOST·WEBOS_APP_ID, 처음
								한 번은 TV에서 연결 허용
							</div>
						</button>
					</div>

					<SectionTitle>
						<span className="stepbadge">Step 4</span> 검수할 시트
					</SectionTitle>
					<div className="card row">
						<span className="okdot">✓</span>
						<div>
							<b>Search</b>{' '}
							<span className="small muted">— 화면 4.x 자동 대상 단계 (음성 안내 단계는 TV 연결 후)</span>
						</div>
					</div>
				</div>

				<aside>
					<div className="card summary">
						<div className="head">
							<div className="small" style={{ letterSpacing: '0.12em', opacity: 0.8 }}>
								SUMMARY
							</div>
							<h3>검수 준비 확인</h3>
						</div>
						<ul>
							<li>
								<span className={`okdot ${tcOk === true ? '' : 'no'}`}>
									{tcOk === true ? '✓' : '!'}
								</span>
								<div>
									<b>TC 엑셀</b>
									<div className="small muted">{s.tc === '' ? '경로를 입력하세요' : s.tc}</div>
								</div>
							</li>
							<li>
								<span className={`okdot ${specOk === true && profileOk === true ? '' : 'no'}`}>
									{specOk === true && profileOk === true ? '✓' : '!'}
								</span>
								<div>
									<b>UX 시나리오 · 앱 프로필</b>
									<div className="small muted">화면 진입·요소 위치 확인용</div>
								</div>
							</li>
							<li>
								<span className="okdot">✓</span>
								<div>
									<b>실행 환경</b>
									<div className="small muted">
										{s.device === true
											? 'TV 실기기 (webOS)'
											: `브라우저 · ${s.headed ? '화면 보기' : '화면 없이'}`}
									</div>
								</div>
							</li>
						</ul>
						<div style={{ padding: '0 20px 20px' }}>
							<button
								className="btn primary"
								style={{ width: '100%', justifyContent: 'center' }}
								disabled={!ready || busy}
								onClick={() => void start()}
							>
								▶ 시작
							</button>
							<div className="small muted" style={{ textAlign: 'center', marginTop: 8 }}>
								{running
									? '이미 실행 중인 검수가 있습니다'
									: ready
										? '시작하면 검수 중 화면으로 이동합니다'
										: '파일 3개를 확인하면 시작할 수 있어요'}
							</div>
							{error !== null && (
								<div className="small" style={{ color: 'var(--fail)', marginTop: 8 }}>
									{error}
								</div>
							)}
						</div>
					</div>
					<div className="card small muted" style={{ marginTop: 12 }}>
						검수 중 실패·확인 필요 항목은 <b style={{ color: 'var(--navy)' }}>바로 확인</b> 패널에
						실시간으로 쌓입니다.
					</div>
				</aside>
			</div>
		</main>
	);
}
