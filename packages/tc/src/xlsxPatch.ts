/**
 * xlsx 원본 보존 쓰기 (D-028). 엑셀 라이브러리로 다시 저장하면 메모·인쇄 설정·조건부 서식 등이 바뀌거나 빠지므로,
 * zip 안의 시트 XML에서 결과 칸 요소만 바꾸고 나머지 바이트는 그대로 둔다. 여기는 문자열만 다루는 순수 함수다.
 */

export type PatchStatus = 'written' | 'skipped-existing' | 'skipped-formula';

const ATTR_RE = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function attributes(text: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const m of text.matchAll(ATTR_RE)) map.set(m[1] ?? '', m[3] ?? m[4] ?? '');
	return map;
}

function attributeText(map: Map<string, string>): string {
	return [...map].map(([k, v]) => ` ${k}="${v}"`).join('');
}

export function unescapeXml(text: string): string {
	return text.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-f]+|#\d+);/gi, (_, e: string) => {
		const lower = e.toLowerCase();
		if (lower === 'lt') return '<';
		if (lower === 'gt') return '>';
		if (lower === 'quot') return '"';
		if (lower === 'apos') return "'";
		if (lower === 'amp') return '&';
		const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
		return String.fromCodePoint(code);
	});
}

export function escapeXml(text: string): string {
	return (
		text
			// XML 1.0에서 쓸 수 없는 제어 문자 제거 (탭·줄바꿈은 유지)
			// eslint-disable-next-line no-control-regex
			.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
	);
}

/** 상대 경로 정리: base 폴더 기준 target ("/xl/..."는 절대) */
export function resolvePart(baseDir: string, target: string): string {
	const base = baseDir === '' || baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
	const parts = (target.startsWith('/') ? target.slice(1) : `${base}${target}`).split('/');
	const out: string[] = [];
	for (const p of parts) {
		if (p === '..') out.pop();
		else if (p !== '.' && p !== '') out.push(p);
	}
	return out.join('/');
}

function relationships(relsXml: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const m of relsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
		const a = attributes(m[1] ?? '');
		const id = a.get('Id');
		const target = a.get('Target');
		if (id !== undefined && target !== undefined) map.set(id, target);
	}
	return map;
}

/** 관계 파일의 [Type, Target] 목록 */
export function relationshipTargets(relsXml: string): [string, string][] {
	const out: [string, string][] = [];
	for (const m of relsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
		const a = attributes(m[1] ?? '');
		out.push([a.get('Type') ?? '', a.get('Target') ?? '']);
	}
	return out;
}

/** 패키지 루트 관계(_rels/.rels)에서 통합 문서 파트 경로 */
export function workbookPartPath(rootRelsXml: string): string {
	for (const m of rootRelsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
		const a = attributes(m[1] ?? '');
		if ((a.get('Type') ?? '').endsWith('/officeDocument')) return resolvePart('', a.get('Target') ?? '');
	}
	throw new Error('통합 문서 파트를 찾지 못했습니다 (_rels/.rels)');
}

/** 시트 이름 → zip 안 시트 XML 경로 */
export function sheetPartPaths(
	workbookPath: string,
	workbookXml: string,
	workbookRelsXml: string
): Map<string, string> {
	const baseDir = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1) : '';
	const rels = relationships(workbookRelsXml);
	const map = new Map<string, string>();
	for (const m of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
		const a = attributes(m[1] ?? '');
		const name = a.get('name');
		const rid = [...a].find(([k]) => /^[\w]+:id$/.test(k))?.[1];
		const target = rid === undefined ? undefined : rels.get(rid);
		if (name !== undefined && target !== undefined) map.set(unescapeXml(name), resolvePart(baseDir, target));
	}
	return map;
}

/** sharedStrings.xml → 문자열 목록 (서식 조각은 이어 붙이고, 윗주(rPh)는 뺀다) */
export function parseSharedStrings(xml: string): string[] {
	const prefix = /<(\w+:)?sst\b/.exec(xml)?.[1] ?? '';
	const items: string[] = [];
	for (const si of xml.matchAll(new RegExp(`<${prefix}si\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/${prefix}si>)`, 'g'))) {
		const body = (si[1] ?? '').replace(new RegExp(`<${prefix}rPh\\b[\\s\\S]*?<\\/${prefix}rPh>`, 'g'), '');
		items.push(textOf(body, prefix));
	}
	return items;
}

function textOf(body: string, prefix: string): string {
	let text = '';
	for (const t of body.matchAll(new RegExp(`<${prefix}t\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/${prefix}t>)`, 'g'))) {
		text += unescapeXml(t[1] ?? '');
	}
	return text;
}

/** 칸 요소 안의 값이 공백뿐이거나 없으면 빈 칸 */
function cellHasText(
	inner: string,
	type: string | undefined,
	prefix: string,
	sharedStrings: readonly string[] | undefined
): boolean {
	if (type === 'inlineStr') {
		const is = new RegExp(`<${prefix}is\\b[^>]*?>([\\s\\S]*?)<\\/${prefix}is>`).exec(inner);
		return textOf(is?.[1] ?? '', prefix).trim() !== '';
	}
	const v = new RegExp(`<${prefix}v\\b[^>]*?>([\\s\\S]*?)<\\/${prefix}v>`).exec(inner);
	if (v === null) return false;
	if (type === 's' && sharedStrings !== undefined) return (sharedStrings[Number(v[1])] ?? '').trim() !== '';
	return unescapeXml(v[1] ?? '').trim() !== '';
}

function splitAddress(address: string): { column: string; row: number } {
	const m = /^([A-Z]+)(\d+)$/.exec(address);
	if (m === null) throw new Error(`칸 주소가 올바르지 않습니다: ${address}`);
	return { column: m[1] ?? '', row: Number(m[2]) };
}

function columnNumber(letters: string): number {
	let n = 0;
	for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n;
}

/** 열 스타일 (<cols><col min max style>) */
function columnStyle(sheetXml: string, prefix: string, column: number): string | undefined {
	for (const m of sheetXml.matchAll(new RegExp(`<${prefix}col\\b([^>]*?)\\/?>`, 'g'))) {
		const a = attributes(m[1] ?? '');
		if (Number(a.get('min')) <= column && column <= Number(a.get('max'))) return a.get('style');
	}
	return undefined;
}

/**
 * 시트 XML의 한 칸에 글자를 쓴다 (inlineStr). 칸 스타일(s)은 유지하고, 수식 칸은 쓰지 않는다.
 * 공백만 있는 값은 빈 칸으로 본다 (공유 문자열은 sharedStrings로 풀어서 판단).
 * 칸·행 요소가 없으면 열 순서·행 순서에 맞춰 만든다.
 */
export function setCellText(
	sheetXml: string,
	address: string,
	value: string,
	options: { overwrite?: boolean; sharedStrings?: readonly string[] } = {}
): { xml: string; status: PatchStatus } {
	const prefix = /<(\w+:)?worksheet\b/.exec(sheetXml)?.[1] ?? '';
	const { column, row } = splitAddress(address);
	const col = columnNumber(column);
	const inline = (attrs: Map<string, string>): string => {
		const a = new Map(attrs);
		for (const key of ['t', 'cm', 'vm']) a.delete(key);
		a.set('t', 'inlineStr');
		return `<${prefix}c${attributeText(a)}><${prefix}is><${prefix}t xml:space="preserve">${escapeXml(value)}</${prefix}t></${prefix}is></${prefix}c>`;
	};

	const dataStart = new RegExp(`<${prefix}sheetData\\b[^>]*?(\\/?)>`).exec(sheetXml);
	if (dataStart === null) throw new Error('시트 XML에 sheetData가 없습니다');
	if (dataStart[1] === '/') {
		const cell = inline(new Map([['r', address]]));
		const xml = `${sheetXml.slice(0, dataStart.index)}<${prefix}sheetData><${prefix}row r="${row}">${cell}</${prefix}row></${prefix}sheetData>${sheetXml.slice(dataStart.index + dataStart[0].length)}`;
		return { xml, status: 'written' };
	}
	const dataEnd = sheetXml.indexOf(`</${prefix}sheetData>`, dataStart.index);

	// 행 찾기
	const rowRe = new RegExp(`<${prefix}row\\b([^>]*?)(\\/?)>`, 'g');
	rowRe.lastIndex = dataStart.index;
	let insertRowAt = dataEnd;
	for (let m = rowRe.exec(sheetXml); m !== null && m.index < dataEnd; m = rowRe.exec(sheetXml)) {
		const rowAttrs = attributes(m[1] ?? '');
		const r = Number(rowAttrs.get('r'));
		if (r > row) {
			insertRowAt = m.index;
			break;
		}
		if (r !== row) continue;

		const selfClosing = m[2] === '/';
		const contentStart = m.index + m[0].length;
		const rowEnd = selfClosing ? contentStart : sheetXml.indexOf(`</${prefix}row>`, contentStart);
		const content = sheetXml.slice(contentStart, rowEnd);
		const cellRe = new RegExp(`<${prefix}c\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${prefix}c>)`, 'g');
		let insertCellAt = content.length;
		for (const c of content.matchAll(cellRe)) {
			const cellAttrs = attributes(c[1] ?? '');
			const ref = cellAttrs.get('r');
			if (ref === undefined) throw new Error(`${row}행에 주소(r) 없는 칸이 있어 위치를 정할 수 없습니다`);
			const cc = columnNumber(splitAddress(ref).column);
			if (cc > col) {
				insertCellAt = c.index;
				break;
			}
			if (cc !== col) continue;
			const inner = c[3] ?? '';
			if (new RegExp(`<${prefix}f\\b`).test(inner)) return { xml: sheetXml, status: 'skipped-formula' };
			const hasValue = cellHasText(inner, cellAttrs.get('t'), prefix, options.sharedStrings);
			if (hasValue && options.overwrite !== true) return { xml: sheetXml, status: 'skipped-existing' };
			const start = contentStart + c.index;
			const xml = `${sheetXml.slice(0, start)}${inline(cellAttrs)}${sheetXml.slice(start + c[0].length)}`;
			return { xml, status: 'written' };
		}
		// 칸 요소가 없음: 행 스타일(customFormat) 또는 열 스타일을 물려받아 새로 만든다
		const style =
			rowAttrs.get('customFormat') === '1' || rowAttrs.get('customFormat') === 'true'
				? rowAttrs.get('s')
				: columnStyle(sheetXml, prefix, col);
		const cellAttrs = new Map([['r', address]]);
		if (style !== undefined) cellAttrs.set('s', style);
		const newRowAttrs = new Map(rowAttrs);
		newRowAttrs.delete('spans'); // 최적화 힌트라 새 칸이 범위를 벗어나면 지운다
		const newContent = `${content.slice(0, insertCellAt)}${inline(cellAttrs)}${content.slice(insertCellAt)}`;
		const rowXml = `<${prefix}row${attributeText(newRowAttrs)}>${newContent}</${prefix}row>`;
		const end = selfClosing ? contentStart : rowEnd + `</${prefix}row>`.length;
		return { xml: `${sheetXml.slice(0, m.index)}${rowXml}${sheetXml.slice(end)}`, status: 'written' };
	}
	const rowXml = `<${prefix}row r="${row}">${inline(new Map([['r', address]]))}</${prefix}row>`;
	return { xml: `${sheetXml.slice(0, insertRowAt)}${rowXml}${sheetXml.slice(insertRowAt)}`, status: 'written' };
}
