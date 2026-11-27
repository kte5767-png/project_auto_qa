/**
 * 진단 도구: 스냅숏(`--link`·`--auto`의 snapshots/*.json)에서 선택자에 맞는 요소의 조상 줄과 단계별 같은 꼴 형제 수를 출력한다.
 * 자동 연결이 왜 그 요소에서 멈췄는지(항목·목록 묶음을 못 찾음 등) 볼 때 쓴다. 글자(ownText·label·value)는 출력하지 않는다
 *
 *   npx tsx snapChain.ts <snapshot.json> "<선택자>" [선택자 …]
 */
import { readFile } from 'node:fs/promises';
import type { DomNode, DomSnapshot } from '@auto-qa/focus';
import { matchSelector } from '@auto-qa/planner';

const [file, ...selectors] = process.argv.slice(2);
if (file === undefined || selectors.length === 0) {
	console.error('사용법: npx tsx snapChain.ts <snapshot.json> "<선택자>" [선택자 …]');
	process.exit(2);
}
const snap = JSON.parse(await readFile(file, 'utf8')) as DomSnapshot;
const children = new Map<number, number[]>();
for (const n of snap.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n.i]);
const isItem = (n: DomNode): boolean => n.focusable && !n.container;
const items = (i: number): number => {
	let count = 0;
	const stack = [i];
	while (stack.length > 0) {
		const m = stack.pop() as number;
		const n = snap.nodes[m];
		if (n !== undefined && isItem(n)) count++;
		stack.push(...(children.get(m) ?? []));
	}
	return count;
};
const sig = (n: DomNode): string => `${n.tag}|${[...n.classes].sort().join(' ')}`;
const line = (n: DomNode): string => {
	const sibs = (children.get(n.parent) ?? []).filter((m) => snap.nodes[m] !== undefined);
	const same = sibs.filter((m) => sig(snap.nodes[m] as DomNode) === sig(n)).length;
	const flags = [isItem(n) ? '항목' : '', n.container ? '묶음' : '', n.focused ? '포커스' : '']
		.filter((f) => f !== '')
		.join(',');
	const { x, y, width, height } = n.rect;
	return [
		`#${n.i}`,
		n.tag,
		n.classes.length === 0 ? '' : `.${n.classes.join('.')}`,
		n.spotlightId === null ? '' : `[spot=${n.spotlightId}]`,
		flags === '' ? '' : `(${flags})`,
		`rect ${x},${y},${width},${height}`,
		`자식 ${(children.get(n.i) ?? []).length}`,
		`안쪽 항목 ${items(n.i)}`,
		`형제 ${sibs.length} 중 같은 꼴 ${same}`
	]
		.filter((p) => p !== '')
		.join(' ');
};
console.log(`viewport ${snap.viewport.width}x${snap.viewport.height}, 요소 ${snap.nodes.length}개`);
for (const css of selectors) {
	const hits = matchSelector(snap, css);
	console.log(`\n== ${css}: ${hits === null ? '읽을 수 없는 선택자' : `${hits.length}개`}`);
	for (const i of (hits ?? []).slice(0, 3)) {
		for (let n = snap.nodes[i], depth = 0; n !== undefined && depth < 12; n = snap.nodes[n.parent], depth++) {
			console.log(`${'  '.repeat(depth)}${line(n)}`);
		}
	}
}
