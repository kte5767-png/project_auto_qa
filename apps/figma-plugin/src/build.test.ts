import { join } from 'node:path';
import { parse } from 'acorn';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * Figma 샌드박스의 문법 지원은 버전·보고마다 다르므로(공식 문서는 ES2020+, 예전 보고는 ES2015),
 * 플러그인은 ES2017로 낮춰 빌드한다. 빌드 결과가 ES2017 문법으로 파싱되는지 확인한다.
 */

const src = join(import.meta.dirname, '.');

describe('플러그인 빌드', () => {
	for (const entry of ['code.ts', 'ui.ts']) {
		it(`${entry}는 ES2017 한 파일로 묶인다 (정규화 코드는 들어가지 않음)`, async () => {
			const result = await build({
				entryPoints: [join(src, entry)],
				bundle: true,
				target: 'es2017',
				format: 'iife',
				write: false,
				logLevel: 'silent'
			});
			const text = result.outputFiles[0]?.text ?? '';
			expect(() => parse(text, { ecmaVersion: 2017 })).not.toThrow();
			expect(text).not.toContain('estimateFocus');
			expect(text).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
		});
	}
});
