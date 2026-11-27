import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AppContext } from './AppContext';
import type { AppContextValue } from './AppContext';
import type { SampleConfig } from './config';
import type { FocusEngine } from './focus/engine';
import { INITIAL_HOME_VIEW, nextHomeView } from './homeView';
import type { HomeView } from './homeView';
import { getLayout } from './layout';
import { DetailScreen } from './screens/DetailScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SearchScreen } from './screens/SearchScreen';

type Screen = { name: 'home' } | { name: 'detail'; itemId: string; originId: string } | { name: 'search' };

const OK_KEY_CODE = 13;
const UP_KEY_CODE = 38;
const DOWN_KEY_CODE = 40;
const INITIAL_FOCUS = 'thumb-1';
const MAX_RECENT_SEARCHES = 5;

interface AppProps {
	config: SampleConfig;
	engine: FocusEngine;
}

export function App({ config, engine }: AppProps) {
	const layout = useMemo(() => getLayout(config.defects), [config]);
	const [stack, setStack] = useState<Screen[]>([{ name: 'home' }]);
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const [homeView, setHomeView] = useState<HomeView>(INITIAL_HOME_VIEW);
	const pendingFocus = useRef<string | null>(INITIAL_FOCUS);
	const selectHandlers = useRef(new Map<string, () => void>());
	const backHandler = useRef<(() => boolean) | null>(null);
	const [recentSearches, setRecentSearches] = useState<string[]>([]);
	const [saveRecent, setSaveRecent] = useState(true);
	const screen: Screen = stack[stack.length - 1] ?? { name: 'home' };

	// 구독을 먼저 걸어야 첫 포커스 이동도 상태에 반영된다 (레이아웃 이펙트는 선언 순서대로 실행)
	useLayoutEffect(() => engine.subscribe(setFocusedId), [engine]);

	useLayoutEffect(() => {
		const id = pendingFocus.current;
		if (id !== null) {
			pendingFocus.current = null;
			engine.focus(id);
		}
	}, [stack, engine]);

	useLayoutEffect(() => {
		if (screen.name === 'home' && focusedId !== null) {
			setHomeView((view) => nextHomeView(view, focusedId, layout));
		}
	}, [focusedId, screen.name, layout]);

	const push = useCallback((next: Screen, focusId: string) => {
		pendingFocus.current = focusId;
		setStack((s) => [...s, next]);
	}, []);

	const back = useCallback(() => {
		if (screen.name === 'home') return;
		if (screen.name === 'search' && config.defects.has('D11')) return;
		if (backHandler.current?.() === true) return;
		let returnFocus: string;
		if (screen.name === 'detail') {
			returnFocus = config.defects.has('D10') ? 'gnb-home' : screen.originId;
		} else {
			returnFocus = 'gnb-search';
		}
		pendingFocus.current = returnFocus;
		setStack((s) => s.slice(0, -1));
	}, [screen, config.defects]);

	const latest = useRef({ back, engine });
	latest.current = { back, engine };

	// OK·Back 처리 (방향키는 포커스 엔진이 처리)
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.keyCode === OK_KEY_CODE) {
				const id = latest.current.engine.current();
				if (id !== null) selectHandlers.current.get(id)?.();
			} else if (event.keyCode === config.backKeyCode) {
				event.preventDefault();
				latest.current.back();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [config.backKeyCode]);

	// 키 입력을 가로채는 결함 (D08 반응 없는 키, D09 포커스 소실). 캡처 단계라 포커스 엔진보다 먼저 실행된다.
	useEffect(() => {
		const onKeyDownCapture = (event: KeyboardEvent): void => {
			const current = engine.current();
			if (config.defects.has('D08') && current === 'gnb-luggage' && event.keyCode === DOWN_KEY_CODE) {
				event.preventDefault();
				event.stopImmediatePropagation();
			} else if (config.defects.has('D09') && current === 'promo-button' && event.keyCode === UP_KEY_CODE) {
				event.preventDefault();
				event.stopImmediatePropagation();
				engine.blur();
			}
		};
		window.addEventListener('keydown', onKeyDownCapture, true);
		return () => window.removeEventListener('keydown', onKeyDownCapture, true);
	}, [engine, config.defects]);

	const registerSelect = useCallback((id: string, handler: () => void) => {
		selectHandlers.current.set(id, handler);
		return () => {
			if (selectHandlers.current.get(id) === handler) selectHandlers.current.delete(id);
		};
	}, []);

	const focus = useCallback((id: string) => engine.focus(id), [engine]);
	const setBackHandler = useCallback((handler: (() => boolean) | null) => {
		backHandler.current = handler;
	}, []);

	const addRecentSearch = useCallback(
		(query: string) => {
			if (!saveRecent) return;
			setRecentSearches((list) => [query, ...list.filter((q) => q !== query)].slice(0, MAX_RECENT_SEARCHES));
		},
		[saveRecent]
	);

	const contextValue = useMemo<AppContextValue>(
		() => ({
			config,
			layout,
			focusedId,
			registerSelect,
			focus,
			setBackHandler,
			recentSearches,
			addRecentSearch,
			saveRecent,
			setSaveRecent
		}),
		[config, layout, focusedId, registerSelect, focus, setBackHandler, recentSearches, addRecentSearch, saveRecent]
	);

	const openDetail = useCallback(
		(itemId: string, originId: string) => push({ name: 'detail', itemId, originId }, 'detail-play'),
		[push]
	);
	const onGnbSelect = useCallback(
		(id: string) => {
			if (id === 'gnb-search') push({ name: 'search' }, 'search-field');
		},
		[push]
	);

	const rootStyle = {
		width: layout.viewport.width,
		height: layout.viewport.height,
		background: layout.colors.background,
		color: layout.colors.text,
		fontFamily: layout.fontFamily,
		'--focus-border-color': layout.colors.focusBorder,
		'--focus-border-width': `${layout.top10.focusBorderWidth}px`,
		'--focus-scale': String(layout.top10.focusScale),
		'--gnb-bg': layout.colors.gnbBackground,
		'--gnb-focus-bg': layout.colors.gnbFocusBackground,
		'--chip-bg': layout.colors.chipBackground,
		'--sub-text': layout.colors.subText
	} as CSSProperties;

	return (
		<AppContext.Provider value={contextValue}>
			<div
				className={`app focus-${config.focusMode}`}
				style={rootStyle}
				data-testid="app"
				data-focus-mode={config.focusMode}
			>
				{screen.name === 'home' && (
					<HomeScreen view={homeView} onOpenDetail={openDetail} onGnbSelect={onGnbSelect} />
				)}
				{screen.name === 'detail' && <DetailScreen itemId={screen.itemId} />}
				{screen.name === 'search' && <SearchScreen onBack={back} />}
			</div>
		</AppContext.Provider>
	);
}
