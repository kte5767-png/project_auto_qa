import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConfigError, launchParamsToSearch, parseConfig } from './config';
import { createClassEngine } from './focus/classEngine';
import { createSpotlightEngine } from './focus/spotlightEngine';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
	throw new Error('#root 요소가 없습니다.');
}

/** TV(webOS)에서는 URL 쿼리 대신 앱 실행 인자로 설정을 받는다 */
function readLaunchParams(): unknown {
	const w = window as unknown as Record<string, { launchParams?: unknown } | undefined>;
	return w['webOSSystem']?.launchParams ?? w['PalmSystem']?.launchParams;
}

try {
	const search = window.location.search !== '' ? window.location.search : launchParamsToSearch(readLaunchParams());
	const config = parseConfig(search);
	const engine =
		config.focusMode === 'spotlight' ? createSpotlightEngine(rootElement) : createClassEngine(rootElement);
	engine.start();
	createRoot(rootElement).render(<App config={config} engine={engine} />);
} catch (error) {
	if (!(error instanceof ConfigError)) throw error;
	rootElement.textContent = error.message;
	rootElement.setAttribute('data-testid', 'config-error');
}
