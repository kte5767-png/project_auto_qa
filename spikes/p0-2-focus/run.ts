/**
 * P0-2 포커스 판별 + 프로필 탐지 스파이크 (브라우저 시뮬레이터).
 *
 * 샘플 앱 (정답 있음):
 *   pnpm spike:focus
 * 실제 앱 (정답 없음 → 어댑터 간 일치율 + 스크린샷 리포트로 사람이 확인):
 *   pnpm spike:focus --url http://localhost:8091
 *
 * 옵션: --keys "RIGHT*4 DOWN*3 …"  --modes spotlight,class  --out <폴더>  --headed
 * 실기기 버전은 spikes/p0-6-device (같은 측정 흐름·리포트를 쓴다).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BrowserDriver, launchBrowser } from '@auto-qa/browser';
import { parseKeySequence } from '@auto-qa/core';
import type { FocusAdapterId } from '@auto-qa/focus';
import { sampleTruthScript } from '@auto-qa/sample-tv-app/truth';
import type { SampleTruth } from '@auto-qa/sample-tv-app/truth';
import { DEFAULT_MEASURE_KEYS, renderFocusReport, runFocusMeasurement, summarize } from '@auto-qa/spike-shared';
import type { FocusRunResult } from '@auto-qa/spike-shared';
import { build, preview } from 'vite';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE_APP_ROOT = resolve(HERE, '../../fixtures/sample-tv-app');

interface Target {
	name: string;
	url: string;
	/** 샘플 앱이면 정답(data-sample-nav)으로 채점한다 (D-018) */
	hasTruth: boolean;
	expected: { adapter: FocusAdapterId; selector?: string } | null;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			url: { type: 'string' },
			keys: { type: 'string', default: DEFAULT_MEASURE_KEYS },
			modes: { type: 'string', default: 'spotlight,class' },
			out: { type: 'string', default: join(HERE, 'out') },
			headed: { type: 'boolean', default: false }
		}
	});
	const keys = parseKeySequence(values.keys);
	const outDir = resolve(values.out);
	await mkdir(outDir, { recursive: true });

	const targets: Target[] = [];
	let closeServer: (() => void) | null = null;
	if (values.url !== undefined) {
		targets.push({ name: 'external', url: values.url, hasTruth: false, expected: null });
	} else {
		await build({ root: SAMPLE_APP_ROOT, logLevel: 'warn' });
		const server = await preview({
			root: SAMPLE_APP_ROOT,
			logLevel: 'warn',
			preview: { port: 4180, strictPort: false }
		});
		const base = server.resolvedUrls?.local[0];
		if (base === undefined) throw new Error('샘플 앱 서버 주소를 얻지 못했습니다.');
		closeServer = () => server.httpServer.close();
		for (const mode of values.modes.split(',')) {
			targets.push({
				name: `sample-${mode}`,
				url: `${base}?focus=${mode}&defects=none`,
				hasTruth: true,
				expected:
					mode === 'class' ? { adapter: 'selector', selector: '.focused' } : { adapter: 'enact-spotlight' }
			});
		}
	}

	const browser = await launchBrowser({ headless: !values.headed });
	const results: FocusRunResult[] = [];
	try {
		for (const target of targets) {
			console.log(`\n[${target.name}] ${target.url}`);
			const driver = await BrowserDriver.open(browser, target.url);
			try {
				const result = await runFocusMeasurement(driver, {
					name: target.name,
					description: target.url,
					meta: { 실행: '브라우저 시뮬레이터 (CDP 키 입력)' },
					keys,
					outDir,
					reset: () => driver.reload(),
					readTruth: target.hasTruth ? () => driver.evaluate<SampleTruth>(sampleTruthScript()) : null,
					expected: target.expected
				});
				results.push(result);
				for (const line of summarize(result)) console.log(`  ${line}`);
			} finally {
				await driver.close();
			}
		}
	} finally {
		await browser.close();
		closeServer?.();
	}

	await writeFile(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
	await writeFile(join(outDir, 'report.html'), renderFocusReport('P0-2 포커스 판별 스파이크 (시뮬레이터)', results));
	console.log(`\n리포트: ${join(outDir, 'report.html')}`);
}

await main();
