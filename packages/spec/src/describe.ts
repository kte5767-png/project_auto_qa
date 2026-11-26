import type { CalloutDescription, SpecKey, VersionEntry } from './types';

/**
 * 화면설계서 글자 해석 (순수 함수). 글머리 기호는 Figma 목록 서식이라 글자에 없고, 줄 단위로 들어온다.
 */

const KEY_MAP: Record<string, SpecKey> = {
	'▲': 'up',
	'▼': 'down',
	'◀': 'left',
	'▶': 'right',
	'◄': 'left',
	'►': 'right',
	ok: 'ok',
	back: 'back'
};

const KEY_LINE = /^\[\s*(▲|▼|◀|▶|◄|►|OK|Back)\s*\]\s*[:：]?\s*(.*)$/i;
const SECTION_LINE = /^(\d+)\)\s*(.+)$/;

export function lines(text: string): string[] {
	return text
		.replace(/[\uFE0E\uFE0F]/g, '') // 이체 선택자(▶︎ 등) 제거
		.split('\n')
		.map((l) => l.replace(/\s+/g, ' ').trim())
		.filter((l) => l !== '');
}

/** 콜아웃 설명 글자 → 이름, 요약, 묶음, 키 동작 */
export function parseDescription(text: string): CalloutDescription {
	const all = lines(text);
	const [label = '', ...rest] = all;
	const summary: string[] = [];
	const sections: CalloutDescription['sections'] = [];
	const keys: CalloutDescription['keys'] = {};
	let lastKey: SpecKey | null = null;
	for (const line of rest) {
		const section = SECTION_LINE.exec(line);
		if (section !== null) {
			sections.push({ title: (section[2] ?? '').trim(), items: [] });
			lastKey = null;
			continue;
		}
		const key = KEY_LINE.exec(line);
		const current = sections[sections.length - 1];
		if (key !== null) {
			const name = KEY_MAP[(key[1] ?? '').toLowerCase()];
			if (name !== undefined) {
				keys[name] = (key[2] ?? '').trim();
				lastKey = name;
			}
			current?.items.push(line);
			continue;
		}
		if (current === undefined) {
			summary.push(line.replace(/^_\s*/, ''));
			continue;
		}
		// 키 줄 바로 아래 조건 줄(예: "이동한 이력이 있을 경우: …")은 그 키 동작에 이어 붙인다
		if (lastKey !== null) keys[lastKey] = `${keys[lastKey] ?? ''} (${line})`;
		current.items.push(line);
	}
	return { label, summary, sections, keys, lines: all };
}

/** "[v1.0.1]\n변경…\n[v2.0.1]\n…" → 버전별 변경 내용 */
export function parseVersions(text: string): VersionEntry[] {
	const out: VersionEntry[] = [];
	let current: VersionEntry | null = null;
	for (const line of lines(text)) {
		const m = /^\[v(\d+(?:\.\d+)*)\]\s*(.*)$/i.exec(line);
		if (m !== null) {
			current = { version: m[1] ?? '', changes: m[2] ? [m[2]] : [] };
			out.push(current);
		} else if (current !== null) {
			current.changes.push(line);
		}
	}
	return out;
}

/** 버전 비교 (1.10.0 > 1.9.9) */
export function compareVersions(a: string, b: string): number {
	const x = a.split('.').map(Number);
	const y = b.split('.').map(Number);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

/** 이름 비교용: "영역", 괄호 안 내용, 따옴표를 빼고 소문자로 */
export function normalizeLabel(text: string): string {
	return text
		.replace(/\([^)]*\)/g, ' ')
		.replace(/영역\s*$/, '')
		.replace(/["'“”‘’]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** "4.1.1. 검색어 자동 완성" → { screenId: "4.1.1", title: "검색어 자동 완성" } */
export function parseScreenTitle(text: string): { screenId: string; title: string } | null {
	const first = lines(text)[0] ?? '';
	const m = /^(\d+(?:\.\d+)*)\.?\s+(.+)$/.exec(first);
	if (m === null) return null;
	return { screenId: m[1] ?? '', title: (m[2] ?? '').trim() };
}
