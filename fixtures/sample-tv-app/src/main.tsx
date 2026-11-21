import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConfigError, parseConfig } from './config';
import { createClassEngine } from './focus/classEngine';
import { createSpotlightEngine } from './focus/spotlightEngine';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
	throw new Error('#root 요소가 없습니다.');
}

try {
	const config = parseConfig(window.location.search);
	const engine =
		config.focusMode === 'spotlight' ? createSpotlightEngine(rootElement) : createClassEngine(rootElement);
	engine.start();
	createRoot(rootElement).render(<App config={config} engine={engine} />);
} catch (error) {
	if (!(error instanceof ConfigError)) throw error;
	rootElement.textContent = error.message;
	rootElement.setAttribute('data-testid', 'config-error');
}
