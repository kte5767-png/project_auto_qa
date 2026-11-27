/**
 * 실행 중 상황을 사용자 UI(apps/web)에 바로 알린다 (판정과 무관).
 * - progress.json: 단계가 끝날 때만이 아니라 키 하나·하는 일이 바뀔 때마다 다시 쓴다 (최소 간격으로 모아서)
 * - live.jpg: 앱 화면의 가장 최근 프레임 (브라우저가 보내 주는 화면, 앱 DOM을 건드리지 않음)
 * 파일은 임시 파일에 쓴 뒤 이름을 바꿔, 읽는 쪽이 반쯤 쓴 파일을 보지 않게 한다.
 */
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Trail } from './common';

export const PROGRESS_FILE = 'progress.json';
export const LIVE_FRAME_FILE = 'live.jpg';

export interface LiveOptions {
	/** progress.json을 다시 쓰는 최소 간격 (ms). 그 사이 바뀐 것은 모아서 한 번에 쓴다 */
	writeMs: number;
	/** live.jpg를 다시 쓰는 최소 간격 (ms). 0이면 실시간 화면을 받지 않는다 */
	frameMs: number;
}

export const DEFAULT_LIVE_OPTIONS: LiveOptions = { writeMs: 200, frameMs: 250 };

/** 실행 전체의 단계: 준비(TC·브라우저) → 실행 → TC 파일에 결과 쓰기 → 끝 */
export type RunStage = 'preparing' | 'running' | 'writing' | 'done';

/** 실행 폴더 이름 (사용자 UI가 정해 넘길 때). 경로 밖으로 나가지 않게 이름만 허용 */
export function isRunId(id: string): boolean {
	return /^tc-[\w-]+$/.test(id);
}

/**
 * 잦은 알림을 모아 최소 간격마다 한 번 실행한다. 처음 알림은 바로(다음 틱), 간격 안의 알림은 간격이 끝날 때 한 번.
 * 실행 중에 온 알림은 끝난 뒤 한 번 더. 실행 오류는 삼킨다 (보고용이라 검수를 멈추지 않는다)
 */
export class Coalescer {
	private last = Number.NEGATIVE_INFINITY;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running: Promise<void> | null = null;
	private dirty = false;

	constructor(
		private readonly task: () => Promise<void>,
		private readonly minMs: number,
		private readonly now: () => number = Date.now
	) {}

	notify(): void {
		this.dirty = true;
		if (this.timer !== null || this.running !== null) return;
		const wait = Math.max(0, this.last + this.minMs - this.now());
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.fire();
		}, wait);
	}

	/** 남은 알림을 바로 실행하고 끝날 때까지 기다린다 */
	async flush(): Promise<void> {
		this.clear();
		while (this.running !== null) {
			await this.running;
			this.clear();
		}
		if (this.dirty) await this.fire();
		this.clear();
	}

	private clear(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	private async fire(): Promise<void> {
		if (!this.dirty) return;
		this.dirty = false;
		this.last = this.now();
		this.running = this.task().catch(() => undefined);
		await this.running;
		this.running = null;
		if (this.dirty) this.notify();
	}
}

/** 임시 파일에 쓰고 이름을 바꾼다. 이름 바꾸기가 막히면(Windows에서 읽는 중 등) 그대로 덮어쓴다 */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
	const tmp = `${path}.tmp`;
	await writeFile(tmp, data);
	try {
		await rename(tmp, path);
	} catch {
		await writeFile(path, data);
		await rm(tmp, { force: true }).catch(() => undefined);
	}
}

/** progress.json에 더하는 실시간 칸 (단계 안에서 지금 하는 일) */
export interface LiveFields {
	stage: RunStage;
	finished: boolean;
	/** 모든 단계와 결과 쓰기를 마치지 못하고 끝남 (오류·중지) */
	stopped: boolean;
	/** 지금 실행 중인 단계 (시트!행) */
	current: string | null;
	currentStartedAt: string | null;
	/** 단계 안에서 지금 하는 일 (앱 열기·진입·키 확인 등) */
	phase: string | null;
	/** 지금 단계에서 지금까지 누른 키·동작 */
	currentTrail: readonly Trail[];
	updatedAt: string;
}

export class LiveReporter {
	private stageNow: RunStage = 'preparing';
	private stopped = false;
	private current: string | null = null;
	private currentStartedAt: string | null = null;
	private phaseNow: string | null = null;
	private trail: readonly Trail[] = [];
	private frame: Uint8Array | null = null;
	private readonly progress: Coalescer;
	private readonly frames: Coalescer;

	constructor(
		private readonly dir: string,
		/** 실행 전체 정보 (TC 이름·계획·끝난 단계). 쓸 때마다 다시 읽는다 */
		private readonly base: () => Record<string, unknown>,
		readonly options: LiveOptions = DEFAULT_LIVE_OPTIONS
	) {
		this.progress = new Coalescer(() => writeAtomic(join(dir, PROGRESS_FILE), this.text()), options.writeMs);
		this.frames = new Coalescer(() => this.writeFrame(), Math.max(1, options.frameMs));
	}

	/** 실시간 화면을 받는가 */
	get framesOn(): boolean {
		return this.options.frameMs > 0;
	}

	fields(now = new Date()): LiveFields {
		return {
			stage: this.stageNow,
			finished: this.stageNow === 'done',
			stopped: this.stopped,
			current: this.current,
			currentStartedAt: this.currentStartedAt,
			phase: this.phaseNow,
			currentTrail: this.trail,
			updatedAt: now.toISOString()
		};
	}

	text(): string {
		return `${JSON.stringify({ ...this.base(), ...this.fields() })}\n`;
	}

	stage(stage: RunStage, phase: string | null = null): void {
		this.stageNow = stage;
		this.phaseNow = phase;
		this.touch();
	}

	/** 단계 시작: 이 단계의 기록(trail)은 실행하며 늘어나는 배열을 그대로 본다 */
	begin(key: string, trail: readonly Trail[]): void {
		this.stageNow = 'running';
		this.current = key;
		this.currentStartedAt = new Date().toISOString();
		this.phaseNow = null;
		this.trail = trail;
		this.touch();
	}

	/** 단계 끝 (끝난 단계는 base의 steps에 들어간다) */
	end(): void {
		this.current = null;
		this.currentStartedAt = null;
		this.phaseNow = null;
		this.trail = [];
		this.touch();
	}

	phase(text: string): void {
		if (this.phaseNow === text) return;
		this.phaseNow = text;
		this.touch();
	}

	/** 바뀐 것이 있다 (기록이 늘었다 등) → 곧 다시 쓴다 */
	touch(): void {
		this.progress.notify();
	}

	/** 앱 화면 프레임 하나 (가장 최근 것만 쓴다) */
	onFrame(jpeg: Uint8Array): void {
		if (!this.framesOn) return;
		this.frame = jpeg;
		this.frames.notify();
	}

	private async writeFrame(): Promise<void> {
		const frame = this.frame;
		if (frame === null) return;
		this.frame = null;
		await writeAtomic(join(this.dir, LIVE_FRAME_FILE), frame);
	}

	/** 남은 것을 모두 쓴다 */
	async flush(): Promise<void> {
		await this.frames.flush();
		await this.progress.flush();
	}

	/** 끝: 단계를 done으로 두고 마지막 상태를 쓴다. completed = 모든 단계와 결과 쓰기를 마침 (아니면 오류·중지로 끝남) */
	async finish(completed: boolean): Promise<void> {
		this.stageNow = 'done';
		this.stopped = !completed;
		this.current = null;
		this.currentStartedAt = null;
		this.phaseNow = null;
		this.trail = [];
		this.touch();
		await this.flush();
	}
}
