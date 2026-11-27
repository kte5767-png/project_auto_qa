import { useEffect, useState } from 'react';
import { api } from './api';
import type { LiveState } from './api';
import { Dashboard } from './pages/Dashboard';
import { LiveRun } from './pages/LiveRun';
import { NewRun } from './pages/NewRun';
import { Result } from './pages/Result';

export type Route = { page: 'home' } | { page: 'new' } | { page: 'live' } | { page: 'result'; id: string | null };

function parse(hash: string): Route {
	const [, page, id] = hash.replace(/^#/, '').split('/');
	if (page === 'new') return { page: 'new' };
	if (page === 'live') return { page: 'live' };
	if (page === 'result') return { page: 'result', id: id ?? null };
	return { page: 'home' };
}

export function go(path: string): void {
	window.location.hash = path;
}

export function App() {
	const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
	const [live, setLive] = useState<LiveState | null>(null);

	useEffect(() => {
		const on = (): void => setRoute(parse(window.location.hash));
		window.addEventListener('hashchange', on);
		return () => window.removeEventListener('hashchange', on);
	}, []);

	useEffect(() => {
		let alive = true;
		const tick = (): void => {
			api.live()
				.then((s) => alive && setLive(s))
				.catch(() => undefined);
		};
		tick();
		const t = setInterval(tick, 2000);
		return () => {
			alive = false;
			clearInterval(t);
		};
	}, []);

	const running = live?.running === true;
	const tab = (page: Route['page'], href: string, label: string) => (
		<a href={href} className={route.page === page ? 'on' : ''}>
			{label}
			{page === 'live' && (
				<span className={running ? 'dot live' : 'dot'} style={running ? undefined : { opacity: 0 }} />
			)}
		</a>
	);

	return (
		<>
			<header className="top">
				<a className="brand" href="#/">
					<span className="brand-mark" />
					TVLens QA
				</a>
				<nav className="nav">
					{tab('home', '#/', '홈')}
					{tab('new', '#/new', '새 검수')}
					{tab('live', '#/live', '검수 중')}
					{tab('result', '#/result', '결과')}
				</nav>
				<span className="who">로컬 PC · 로컬 LLM만 사용</span>
			</header>
			{route.page === 'home' && <Dashboard live={live} />}
			{route.page === 'new' && <NewRun running={running} />}
			{route.page === 'live' && <LiveRun live={live} />}
			{route.page === 'result' && <Result id={route.id} />}
			<footer className="foot">
				<span>
					<b>TVLens QA</b>AI 기반 TV 앱 UX 시나리오·TC 자동 검수
				</span>
				<span>규칙 기반 판정 + 로컬 AI 보조 · 회사 자료는 이 PC 밖으로 나가지 않음</span>
			</footer>
		</>
	);
}
