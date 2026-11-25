/**
 * TV(webOS) 설치용 빌드 설정. `pnpm --filter @auto-qa/sample-tv-app build:webos`
 *
 * - webOS 앱은 file:// 경로에서 열리므로 ES 모듈 스크립트(CORS 대상) 대신 하나의 일반 스크립트(IIFE)로 만든다.
 * - 가장 오래된 지원 엔진(webOS 5.x, Chromium 68)에 맞춰 문법을 낮춘다.
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/** 모듈 스크립트 태그를 일반 스크립트(defer)로 바꾼다 */
function classicScript(): Plugin {
	return {
		name: 'webos-classic-script',
		enforce: 'post',
		transformIndexHtml(html) {
			return html
				.replace(/<script type="module" crossorigin/g, '<script defer')
				.replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"')
				.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
		}
	};
}

export default defineConfig({
	base: './',
	plugins: [react(), classicScript()],
	build: {
		outDir: 'dist-webos',
		emptyOutDir: true,
		target: 'chrome68',
		modulePreload: false,
		cssCodeSplit: false,
		assetsInlineLimit: 0,
		rollupOptions: {
			output: {
				format: 'iife',
				entryFileNames: 'app.js',
				assetFileNames: '[name][extname]'
			}
		}
	}
});
