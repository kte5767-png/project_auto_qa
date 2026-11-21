/** `body>div:nth-of-type(1)>…` 형식 경로의 조상·자손 관계 계산 */

export function segments(path: string): string[] {
	return path.split('>');
}

/** a가 b의 조상(자기 자신 제외)인지 */
export function isAncestor(a: string, b: string): boolean {
	return b.length > a.length && b.startsWith(`${a}>`);
}

/** a가 b와 같거나 조상인지 */
export function isSelfOrAncestor(a: string, b: string): boolean {
	return a === b || isAncestor(a, b);
}

/** 경로들의 가장 가까운 공통 조상 (자기 자신 포함) */
export function commonAncestor(paths: readonly string[]): string | null {
	const first = paths[0];
	if (first === undefined) return null;
	let common = segments(first);
	for (const path of paths.slice(1)) {
		const segs = segments(path);
		let i = 0;
		while (i < common.length && i < segs.length && common[i] === segs[i]) i++;
		common = common.slice(0, i);
	}
	return common.length === 0 ? null : common.join('>');
}

export function depth(path: string): number {
	return segments(path).length;
}
