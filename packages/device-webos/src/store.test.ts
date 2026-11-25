import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceStore } from './store';

let dir = '';
afterEach(async () => {
	if (dir !== '') await rm(dir, { recursive: true, force: true });
});

describe('DeviceStore', () => {
	it('없으면 null, 저장 후 다시 읽고 일부만 갱신한다', async () => {
		dir = await mkdtemp(join(tmpdir(), 'devices-'));
		const store = new DeviceStore(dir);
		expect(await store.load('tv')).toBeNull();
		await store.update('tv', '10.0.0.1', { ssapClientKey: 'k1', pairedAt: '2026-11-25T00:00:00Z' });
		await store.update('tv', '10.0.0.1', { modelName: 'WEBOS6.0' });
		expect(await store.load('tv')).toEqual({
			name: 'tv',
			host: '10.0.0.1',
			ssapClientKey: 'k1',
			pairedAt: '2026-11-25T00:00:00Z',
			modelName: 'WEBOS6.0'
		});
		expect(await readFile(join(dir, 'tv.json'), 'utf8')).toContain('"k1"');
	});

	it('경로를 벗어나는 이름은 거부한다', async () => {
		dir = await mkdtemp(join(tmpdir(), 'devices-'));
		await expect(new DeviceStore(dir).load('../secret')).rejects.toThrow(/형식/);
	});
});
