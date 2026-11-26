/**
 * 샘플 케이스의 이미지(확인 영역만 잘라낸 화면)를 샘플 TV 앱에서 만든다.
 *   pnpm --filter @auto-qa/spike-p0-8-llm images
 * 결함을 켠 화면 / 끈 화면을 같은 위치로 잘라 pass·fail 짝을 만든다 (회사 화면이 아니므로 커밋해도 된다).
 * 잘라낼 위치는 샘플 앱의 data-testid로 찾는다 — 케이스를 만드는 도구일 뿐 QA 판정에는 쓰지 않는다 (D-018).
 * 로컬 Chrome을 쓰려면 CHROME_PATH 환경 변수를 지정한다.
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stableWaitScript } from '@auto-qa/core';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const APP_ROOT = fileURLToPath(new URL('../../fixtures/sample-tv-app/', import.meta.url));
const OUT = fileURLToPath(new URL('./cases/images/', import.meta.url));

interface Shot {
	file: string;
	defects: string;
	keys: string[];
	target: string;
	margin: number;
}

const SHOTS: Shot[] = [
	{ file: 'card-focus-ok.png', defects: 'none', keys: ['ArrowDown'], target: 'top10-card-1', margin: 36 },
	{ file: 'card-focus-no-border.png', defects: 'D05', keys: ['ArrowDown'], target: 'top10-card-1', margin: 36 },
	{
		file: 'search-placeholder-ok.png',
		defects: 'none',
		keys: ['ArrowLeft', 'Enter'],
		target: 'search-field-box',
		margin: 16
	},
	{
		file: 'search-placeholder-wrong.png',
		defects: 'D12',
		keys: ['ArrowLeft', 'Enter'],
		target: 'search-field-box',
		margin: 16
	},
	{
		file: 'promo-description-ok.png',
		defects: 'none',
		keys: ['ArrowDown', 'ArrowDown'],
		target: 'promo-card',
		margin: 8
	},
	{
		file: 'promo-description-cut.png',
		defects: 'D06',
		keys: ['ArrowDown', 'ArrowDown'],
		target: 'promo-card',
		margin: 8
	}
];

await mkdir(OUT, { recursive: true });
await build({ root: APP_ROOT, logLevel: 'warn' });
const server = await preview({ root: APP_ROOT, logLevel: 'warn', preview: { port: 4175, strictPort: false } });
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://localhost:4175/';
const browser = await chromium.launch({
	executablePath: process.env['CHROME_PATH'] || undefined,
	channel: process.env['CHROME_PATH'] ? undefined : 'chrome',
	headless: true
});
try {
	for (const shot of SHOTS) {
		const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
		await page.addInitScript('globalThis.__name = globalThis.__name || function (f) { return f; };');
		await page.goto(`${baseUrl}?focus=class&defects=${shot.defects}`);
		await page.waitForSelector('[data-testid="screen-home"]');
		await page.evaluate(stableWaitScript());
		for (const key of shot.keys) {
			await page.keyboard.press(key);
			await page.evaluate(stableWaitScript());
		}
		const box = await page.locator(`[data-testid="${shot.target}"]`).boundingBox();
		if (box === null) throw new Error(`${shot.file}: ${shot.target}를 찾지 못함`);
		const x = Math.max(0, Math.floor(box.x - shot.margin));
		const y = Math.max(0, Math.floor(box.y - shot.margin));
		const clip = {
			x,
			y,
			width: Math.min(1920 - x, Math.ceil(box.width + shot.margin * 2)),
			height: Math.min(1080 - y, Math.ceil(box.height + shot.margin * 2))
		};
		await page.screenshot({ path: `${OUT}${shot.file}`, clip });
		console.log(`${shot.file}: ${clip.width}×${clip.height}`);
		await page.close();
	}
} finally {
	await browser.close();
	await server.close();
}
