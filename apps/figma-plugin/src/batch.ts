/**
 * 나눠 내보내기 (0.2.0): 프레임이 수백 개면 노드 트리와 PNG를 한 번에 메모리에 모았다가 Figma가 멈춘다.
 * N개씩 묶어 파일 하나로 저장하고, UI가 저장을 마쳐야 다음 묶음을 만든다(메모리를 묶음 크기로 묶어 둠).
 * 중간에 멈추면 시작 번호부터 다시 내보낼 수 있다.
 */

export interface Batch {
	/** 1부터 */
	part: number;
	parts: number;
	/** 대상 목록 안의 위치 [from, to) (0부터) */
	from: number;
	to: number;
}

/**
 * @param total 대상 프레임 수
 * @param size 한 파일에 담을 프레임 수 (0 이하 = 전부 한 파일)
 * @param start 시작 번호 (1부터, 중간에 멈춘 뒤 이어서 내보낼 때)
 */
export function planBatches(total: number, size: number, start = 1): Batch[] {
	const first = Math.min(Math.max(Math.floor(start) - 1, 0), total);
	const remaining = total - first;
	if (remaining <= 0) return [];
	const per = size > 0 ? Math.floor(size) : remaining;
	const parts = Math.ceil(remaining / per);
	const out: Batch[] = [];
	for (let i = 0; i < parts; i++) {
		const from = first + i * per;
		out.push({ part: i + 1, parts, from, to: Math.min(from + per, total) });
	}
	return out;
}

/** 파일 이름: `<Figma 파일>-auto-qa-<시각>[-p01of18].json` (`*-auto-qa-*.json`은 커밋하지 않는 이름) */
export function exportFileName(fileName: string, exportedAt: string, batch: Batch | null): string {
	const safe = fileName.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'figma';
	const stamp = exportedAt.replace(/[-:]/g, '').slice(0, 15);
	if (batch === null || batch.parts <= 1) return `${safe}-auto-qa-${stamp}.json`;
	const width = String(batch.parts).length < 2 ? 2 : String(batch.parts).length;
	const pad = (n: number): string => String(n).padStart(width, '0');
	return `${safe}-auto-qa-${stamp}-p${pad(batch.part)}of${pad(batch.parts)}.json`;
}
