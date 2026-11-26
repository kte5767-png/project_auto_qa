import type { Callout, CalloutDescription, SpecScreen } from './types';

/**
 * 한 화면이 여러 장으로 나뉜 화면설계서("… VKB 닫힘(1/2)", "(2/2)")를 화면 하나로 합친다.
 * 장마다 목업이 다르므로(예: 2/2는 아래로 스크롤한 긴 목업) GUI 연결은 장 단위로 하고,
 * 콜아웃은 번호로 묶어 설명이 있는 장을 기준(owner)으로 삼는다.
 */

export interface PagePart {
	base: string;
	part: number;
	total: number;
}

const PART = /\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*$/;

/** 제목 끝의 "(n/m)"을 떼어 낸다 */
export function pagePart(title: string | null): PagePart | null {
	const m = PART.exec(title ?? '');
	if (m === null || title === null) return null;
	return { base: title.slice(0, m.index).trim(), part: Number(m[1]), total: Number(m[2]) };
}

export interface MergedCallout {
	no: string;
	label: string | null;
	description: CalloutDescription | null;
	/** 설명이 있는 장 (없으면 처음 나온 장) */
	ownerFrameId: string;
	/** 이 번호가 나온 장들 */
	parts: { frameId: string; part: number; callout: Callout }[];
}

export interface MergedSpecScreen {
	screenId: string | null;
	title: string | null;
	/** 장 순서대로 */
	parts: SpecScreen[];
	total: number | null;
	missingParts: number[];
	callouts: MergedCallout[];
	diagnostics: string[];
}

const byNo = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

export function mergeSpecScreens(screens: readonly SpecScreen[]): MergedSpecScreen[] {
	// 같은 프레임이 여러 내보내기 파일에 들어 있으면 하나만 쓴다 (나중 것이 최신)
	const unique = new Map<string, SpecScreen>();
	for (const s of screens) unique.set(s.frameId, s);

	const groups = new Map<string, { title: string | null; items: { screen: SpecScreen; part: PagePart | null }[] }>();
	for (const screen of unique.values()) {
		const part = pagePart(screen.title);
		const title = part?.base ?? screen.title;
		const key = `${screen.screenId ?? screen.frameId}|${title ?? ''}`;
		const g = groups.get(key) ?? { title, items: [] };
		g.items.push({ screen, part });
		groups.set(key, g);
	}

	const out: MergedSpecScreen[] = [];
	for (const { title, items: all } of groups.values()) {
		const diagnostics: string[] = [];
		// 같은 장이 두 번 있으면(사본 파일에 복사한 프레임 등) 나중 것만 쓴다
		const byPart = new Map<number, { screen: SpecScreen; part: PagePart | null }>();
		for (const item of all) {
			const n = item.part?.part ?? 1;
			if (byPart.has(n))
				diagnostics.push(
					`같은 장이 여러 번 있음: ${item.part === null ? '' : `${n}장 `}(나중 프레임 ${item.screen.frameName} 사용)`
				);
			byPart.set(n, item);
		}
		const items = [...byPart.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
		const totals = [...new Set(items.flatMap((i) => (i.part === null ? [] : [i.part.total])))];
		if (totals.length > 1) diagnostics.push(`장 수 표기가 서로 다름: ${totals.join(', ')}`);
		const total = totals[0] ?? null;
		const have = new Set(items.map((i) => i.part?.part ?? 1));
		const missingParts =
			total === null ? [] : Array.from({ length: total }, (_, i) => i + 1).filter((n) => !have.has(n));
		if (missingParts.length > 0)
			diagnostics.push(`없는 장: ${missingParts.map((n) => `${n}/${total}`).join(', ')}`);

		const callouts = new Map<string, MergedCallout>();
		for (const { screen, part } of items) {
			for (const c of screen.callouts) {
				const entry = { frameId: screen.frameId, part: part?.part ?? 1, callout: c };
				const m = callouts.get(c.no);
				if (m === undefined) {
					callouts.set(c.no, {
						no: c.no,
						label: c.label,
						description: c.description,
						ownerFrameId: screen.frameId,
						parts: [entry]
					});
					continue;
				}
				m.parts.push(entry);
				if (c.description === null) continue;
				if (m.description === null) {
					m.label = c.label;
					m.description = c.description;
					m.ownerFrameId = screen.frameId;
				} else if (m.label !== c.label) {
					diagnostics.push(`콜아웃 ${c.no} 설명이 장마다 다름: "${m.label ?? ''}" / "${c.label ?? ''}"`);
				}
			}
		}
		for (const m of callouts.values())
			if (m.description === null) diagnostics.push(`콜아웃 ${m.no}: 어느 장에도 설명이 없음`);

		const first = items[0]?.screen;
		out.push({
			screenId: first?.screenId ?? null,
			title,
			parts: items.map((i) => i.screen),
			total,
			missingParts,
			callouts: [...callouts.values()].sort((a, b) => byNo(a.no, b.no)),
			diagnostics
		});
	}
	return out.sort((a, b) => byNo(a.screenId ?? '', b.screenId ?? '') || (a.title ?? '').localeCompare(b.title ?? ''));
}
