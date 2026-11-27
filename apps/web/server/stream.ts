/**
 * 실시간 전달(SSE)에 쓰는 순수 조각: 이벤트 문자열, 로그 줄 나누기, 지금 볼 실행 고르기.
 * 부수 효과(파일·프로세스·응답)는 api.ts에 둔다.
 */

/** 서버가 보내는 이벤트 하나 (text/event-stream 형식) */
export function sseFrame(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 실행 로그: 프로세스 출력 조각을 줄로 나눠 최근 max줄만 둔다.
 * 조각이 줄 중간에서 끊겨 와도 줄이 끝날 때까지 기다렸다가 한 줄로 만든다. seq = 지금까지 받은 줄 수
 */
export class LogBuffer {
	readonly lines: string[] = [];
	seq = 0;
	private rest = '';

	constructor(private readonly max: number) {}

	/** 조각을 넣고 새로 끝난 줄을 돌려준다 (빈 줄은 뺀다) */
	push(chunk: string): string[] {
		const parts = (this.rest + chunk).split(/\r?\n/);
		this.rest = parts.pop() ?? '';
		return this.add(parts);
	}

	/** 남은 반쪽 줄을 마저 넣는다 (프로세스가 끝났을 때) */
	end(): string[] {
		const last = this.rest;
		this.rest = '';
		return this.add([last]);
	}

	private add(parts: string[]): string[] {
		const fresh = parts.filter((l) => l.trim() !== '');
		for (const line of fresh) {
			this.lines.push(line);
			this.seq++;
		}
		if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
		return fresh;
	}
}

/**
 * 지금 화면에 보일 실행: 이 서버가 띄운 검수가 실행 중이면 그것, 아니면 가장 최근 실행 폴더
 * (명령줄로 실행한 것 포함). 실행 폴더 이름은 tc-시각이라 이름 순서가 시간 순서다
 */
export function pickRunId(own: { runId: string; running: boolean } | null, names: readonly string[]): string | null {
	if (own?.running === true) return own.runId;
	const runs = names.filter((n) => /^tc-[\w-]+$/.test(n)).sort();
	return runs.at(-1) ?? null;
}

/** 실행 폴더 이름 (시각, 파일 이름에 쓸 수 있게) */
export function runIdAt(date: Date): string {
	return `tc-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

/**
 * 실행이 단계 도중에 끝났을 때(중지·오류) 진행 파일을 끝난 상태로 고친다. 이미 끝났으면 null (고칠 것 없음)
 */
export function markStopped(progress: Record<string, unknown>, exitCode: number): Record<string, unknown> | null {
	if (progress['stage'] === 'done' || (progress['stage'] === undefined && progress['finished'] === true)) return null;
	return {
		...progress,
		stage: 'done',
		finished: true,
		stopped: true,
		exitCode,
		current: null,
		currentStartedAt: null,
		phase: null,
		currentTrail: [],
		updatedAt: new Date().toISOString()
	};
}
