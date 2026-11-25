import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * 장치별 로컬 기록 (에이전트 PC의 `.data/devices/<이름>.json`, 커밋하지 않음).
 * SSAP client-key는 TV에 리모컨 앱으로 등록된 증표이므로 비밀값처럼 다룬다.
 */
export interface DeviceRecord {
	name: string;
	host: string;
	ssapClientKey: string | null;
	pairedAt: string | null;
	/** 마지막으로 확인한 정보 */
	modelName?: string;
	sdkVersion?: string;
	firmwareVersion?: string;
	engine?: string;
	devModeRemaining?: string;
	checkedAt?: string;
}

export class DeviceStore {
	constructor(private readonly dir: string) {}

	private file(name: string): string {
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))
			throw new Error(`장치 이름 형식이 올바르지 않습니다: ${name}`);
		return join(this.dir, `${name}.json`);
	}

	async load(name: string): Promise<DeviceRecord | null> {
		try {
			return JSON.parse(await readFile(this.file(name), 'utf8')) as DeviceRecord;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw error;
		}
	}

	async save(record: DeviceRecord): Promise<void> {
		const path = this.file(record.name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
	}

	async update(name: string, host: string, patch: Partial<DeviceRecord>): Promise<DeviceRecord> {
		const current = (await this.load(name)) ?? { name, host, ssapClientKey: null, pairedAt: null };
		const next: DeviceRecord = { ...current, ...patch, name, host };
		await this.save(next);
		return next;
	}
}
