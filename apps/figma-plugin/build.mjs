import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * 플러그인 빌드: 본체(code.ts)와 UI 스크립트(ui.ts)를 ES2017 한 파일로 묶는다.
 * UI 스크립트는 ui.html 안에 넣는다 (Figma는 UI를 HTML 한 파일로 받는다).
 */

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist');
await mkdir(out, { recursive: true });

const common = {
	bundle: true,
	target: 'es2017',
	format: 'iife',
	write: false,
	legalComments: 'none',
	logLevel: 'warning'
};
const code = await build({ ...common, entryPoints: [join(root, 'src/code.ts')] });
const ui = await build({ ...common, entryPoints: [join(root, 'src/ui.ts')] });

const codeText = code.outputFiles[0]?.text ?? '';
const uiScript = (ui.outputFiles[0]?.text ?? '').replace(/<\/script/gi, '<\\/script');
const html = (await readFile(join(root, 'src/ui.html'), 'utf8')).replace(
	'<!-- SCRIPT -->',
	`<script>${uiScript}</script>`
);

await writeFile(join(out, 'code.js'), codeText);
await writeFile(join(out, 'ui.html'), html);
console.log(`dist/code.js ${codeText.length}B, dist/ui.html ${html.length}B`);
