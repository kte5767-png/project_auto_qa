/**
 * 샘플 앱을 webOS 앱 폴더(dist-webos)로 빌드한다. 이 폴더를 ares-package로 ipk로 만든다.
 *
 *   pnpm --filter @auto-qa/sample-tv-app build:webos
 *   ares-package fixtures/sample-tv-app/dist-webos -o <출력 폴더>
 *
 * 설정(포커스 방식·결함)은 URL 대신 실행 인자로 넘긴다:
 *   ares-launch -d <장치> com.autoqa.sampletvapp -p "{'focus':'class','defects':'none'}"
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'vite';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SAMPLE_APP_ID = 'com.autoqa.sampletvapp';

const APPINFO = {
	id: SAMPLE_APP_ID,
	version: '0.0.1',
	vendor: 'auto-qa',
	type: 'web',
	main: 'index.html',
	title: 'Auto QA Sample',
	icon: 'icon.png',
	resolution: '1920x1080',
	// Back(461) 키를 앱이 직접 받는다 (샘플 앱이 Back 흐름을 스스로 처리)
	disableBackHistoryAPI: true
};

/** 단색 PNG (ares-package가 아이콘 파일을 요구한다) */
function solidPng(size: number, rgb: [number, number, number]): Buffer {
	const chunk = (type: string, data: Buffer): Buffer => {
		const head = Buffer.alloc(4);
		head.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([head, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // 비트 깊이
	ihdr[9] = 2; // RGB
	const row = Buffer.alloc(1 + size * 3);
	for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
	const raw = Buffer.concat(Array.from({ length: size }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** webOS 앱 폴더를 만들고 경로를 돌려준다 */
export async function buildWebosApp(): Promise<string> {
	await build({ root: APP_ROOT, configFile: join(APP_ROOT, 'vite.webos.config.ts'), logLevel: 'warn' });
	const out = join(APP_ROOT, 'dist-webos');
	await writeFile(join(out, 'appinfo.json'), `${JSON.stringify(APPINFO, null, '\t')}\n`);
	await writeFile(join(out, 'icon.png'), solidPng(80, [229, 0, 80]));
	return out;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const out = await buildWebosApp();
	console.log(`webOS 앱 폴더: ${out}`);
	console.log(`다음: ares-package "${out}" -o <출력 폴더>`);
}
