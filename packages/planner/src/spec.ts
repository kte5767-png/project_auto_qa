import type { Rect } from '@auto-qa/core';
import { isShown } from '@auto-qa/figma';
import type { NormalizedFrame } from '@auto-qa/figma';
import type { MergedSpecScreen } from '@auto-qa/spec';
import type { NavCallout, NavScreen } from './keymap';

const inside = (r: Rect, x: number, y: number): boolean =>
	x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** 대상 영역 안(중심 기준)의 보이는 글자, 줄마다 */
function textsIn(frame: NormalizedFrame | undefined, rect: Rect): string[] {
	if (frame === undefined) return [];
	const out: string[] = [];
	for (const e of frame.elements) {
		if (e.kind !== 'text' || e.text === null || !isShown(e)) continue;
		if (!inside(rect, e.rect.x + e.rect.width / 2, e.rect.y + e.rect.height / 2)) continue;
		for (const line of e.text.characters.split('\n')) if (line.trim() !== '') out.push(line.trim());
	}
	return out;
}

/**
 * 합친 화면설계서 화면을 이동 지도 입력으로 바꾼다.
 * frames(프레임 id → 정규화 프레임)를 주면 대상 영역 안의 목업 글자를 항목 이름 찾기에 쓴다.
 */
export function navScreenFromSpec(
	screen: MergedSpecScreen,
	frames: ReadonlyMap<string, NormalizedFrame> = new Map()
): NavScreen {
	const callouts: NavCallout[] = screen.callouts.map((c) => {
		const owner = c.parts.find((p) => p.frameId === c.ownerFrameId) ?? c.parts[0];
		const withTarget = c.parts.find((p) => p.callout.target !== null) ?? owner;
		const target = withTarget?.callout.target ?? null;
		const names = [c.description?.label ?? null, c.label].filter((n): n is string => n !== null && n.trim() !== '');
		const texts = target === null ? [] : textsIn(frames.get(withTarget?.frameId ?? ''), target.specRect);
		if (target?.text !== null && target?.text !== undefined) texts.unshift(target.text);
		return {
			no: c.no,
			names: [...new Set(names)],
			texts: [...new Set(texts)],
			rect: target?.screenRect ?? null,
			keys: c.description?.keys ?? {}
		};
	});
	const defaultFocus = screen.parts.map((p) => p.defaultFocus).find((d) => d !== null && d.trim() !== '') ?? null;
	return { screenId: screen.screenId, title: screen.title, callouts, defaultFocus };
}
