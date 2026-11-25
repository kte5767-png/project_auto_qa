import { describe, expect, it } from 'vitest';
import {
	escapeXml,
	parseSharedStrings,
	relationshipTargets,
	resolvePart,
	setCellText,
	sheetPartPaths,
	unescapeXml,
	workbookPartPath
} from './xlsxPatch';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const sheet = (data: string, extra = ''): string =>
	`<?xml version="1.0" encoding="UTF-8"?><worksheet ${NS}>${extra}<sheetData>${data}</sheetData><mergeCells count="1"><mergeCell ref="H4:H5"/></mergeCells></worksheet>`;

describe('workbookPartPath / sheetPartPaths', () => {
	it('관계 파일을 따라 시트 이름별 XML 경로를 찾는다 (이름의 &amp; 등은 풀어서)', () => {
		const root = `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
		const path = workbookPartPath(root);
		expect(path).toBe('xl/workbook.xml');
		const wb = `<workbook xmlns:r="r"><sheets><sheet name="Touch &amp; 매직" sheetId="3" r:id="rId2"/><sheet name="Main" sheetId="1" r:id="rId1"/></sheets></workbook>`;
		const rels = `<Relationships><Relationship Target="worksheets/sheet2.xml" Id="rId2" Type="…/worksheet"/><Relationship Id="rId1" Type="…/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>`;
		expect([...sheetPartPaths(path, wb, rels)]).toEqual([
			['Touch & 매직', 'xl/worksheets/sheet2.xml'],
			['Main', 'xl/worksheets/sheet1.xml']
		]);
	});
});

describe('resolvePart / relationshipTargets', () => {
	it('관계 대상 경로를 zip 안 경로로 바꾼다', () => {
		expect(resolvePart('xl', 'sharedStrings.xml')).toBe('xl/sharedStrings.xml');
		expect(resolvePart('xl/', '../docProps/app.xml')).toBe('docProps/app.xml');
		expect(resolvePart('xl', '/xl/styles.xml')).toBe('xl/styles.xml');
		expect(
			relationshipTargets(
				'<Relationships><Relationship Id="a" Type="t/sharedStrings" Target="s.xml"/></Relationships>'
			)
		).toEqual([['t/sharedStrings', 's.xml']]);
	});
});

describe('parseSharedStrings', () => {
	it('서식 조각은 이어 붙이고 윗주는 뺀다', () => {
		const xml =
			'<sst><si><t>PASS</t></si><si><t xml:space="preserve"> </t></si><si><r><t>A</t></r><r><rPr><b/></rPr><t>&amp;B</t></r></si><si><t>漢</t><rPh sb="0" eb="1"><t>かん</t></rPh></si><si/></sst>';
		expect(parseSharedStrings(xml)).toEqual(['PASS', ' ', 'A&B', '漢', '']);
	});
});

describe('escapeXml / unescapeXml', () => {
	it('특수 문자를 바꾸고 XML에서 쓸 수 없는 제어 문자는 지운다', () => {
		expect(escapeXml('a<b & "c"\u000b\n')).toBe('a&lt;b &amp; &quot;c&quot;\n');
		expect(unescapeXml('&lt;&amp;&#x41;&#66;')).toBe('<&AB');
	});
});

describe('setCellText', () => {
	it('빈 칸 요소에 쓰고 스타일은 유지한다', () => {
		const xml = sheet('<row r="2" spans="1:9"><c r="G2" s="5" t="s"><v>1</v></c><c r="H2" s="7"/></row>');
		const { xml: out, status } = setCellText(xml, 'H2', 'PASS & 확인');
		expect(status).toBe('written');
		expect(out).toContain(
			'<c r="H2" s="7" t="inlineStr"><is><t xml:space="preserve">PASS &amp; 확인</t></is></c></row>'
		);
		expect(out).toContain('<c r="G2" s="5" t="s"><v>1</v></c>');
		expect(out.replace(/<c r="H2"[\s\S]*?<\/c>/, '')).toBe(xml.replace('<c r="H2" s="7"/>', ''));
	});

	it('값이 있으면 건너뛰고, overwrite면 바꾼다', () => {
		const xml = sheet('<row r="3"><c r="H3" s="7" t="s"><v>4</v></c></row>');
		expect(setCellText(xml, 'H3', 'FAIL').status).toBe('skipped-existing');
		const { xml: out, status } = setCellText(xml, 'H3', 'FAIL', { overwrite: true });
		expect(status).toBe('written');
		expect(out).toContain('<c r="H3" s="7" t="inlineStr"><is><t xml:space="preserve">FAIL</t></is></c>');
		expect(out).not.toContain('<v>4</v>');
	});

	it('공백뿐인 값(공유 문자열 포함)은 빈 칸으로 보고 쓴다', () => {
		const xml = sheet(
			'<row r="3"><c r="H3" t="s"><v>1</v></c><c r="I3" t="inlineStr"><is><t> </t></is></c><c r="J3" t="s"><v>0</v></c></row>'
		);
		const shared = ['PASS', ' '];
		expect(setCellText(xml, 'H3', 'P', { sharedStrings: shared }).status).toBe('written');
		expect(setCellText(xml, 'I3', 'P').status).toBe('written');
		expect(setCellText(xml, 'J3', 'P', { sharedStrings: shared }).status).toBe('skipped-existing');
	});

	it('수식 칸은 쓰지 않는다', () => {
		const xml = sheet('<row r="3"><c r="H3"><f>A1</f><v>1</v></c></row>');
		expect(setCellText(xml, 'H3', 'P', { overwrite: true }).status).toBe('skipped-formula');
	});

	it('칸 요소가 없으면 열 순서에 맞춰 만들고 행 스타일을 물려받는다', () => {
		const xml = sheet('<row r="4" spans="1:9" s="9" customFormat="1"><c r="G4"/><c r="I4"/></row>');
		const out = setCellText(xml, 'H4', 'P').xml;
		expect(out).toContain(
			'<row r="4" s="9" customFormat="1"><c r="G4"/><c r="H4" s="9" t="inlineStr"><is><t xml:space="preserve">P</t></is></c><c r="I4"/></row>'
		);
	});

	it('행 스타일이 없으면 열 스타일을 물려받는다', () => {
		const xml = sheet('<row r="4"><c r="A4"/></row>', '<cols><col min="8" max="9" width="10" style="12"/></cols>');
		expect(setCellText(xml, 'H4', 'P').xml).toContain('<c r="H4" s="12" t="inlineStr">');
	});

	it('빈 행·없는 행은 행 순서에 맞춰 만든다', () => {
		const xml = sheet(
			'<row r="2"><c r="A2"/></row><row r="6" ht="20" customHeight="1"/><row r="9"><c r="A9"/></row>'
		);
		const six = setCellText(xml, 'H6', 'P').xml;
		expect(six).toContain('<row r="6" ht="20" customHeight="1"><c r="H6" t="inlineStr">');
		const seven = setCellText(xml, 'H7', 'P').xml;
		expect(seven.indexOf('<row r="7">')).toBeGreaterThan(seven.indexOf('<row r="6"'));
		expect(seven.indexOf('<row r="7">')).toBeLessThan(seven.indexOf('<row r="9">'));
		expect(setCellText(xml, 'H12', 'P').xml).toContain('<c r="A9"/></row><row r="12"><c r="H12"');
		const empty = `<worksheet ${NS}><sheetData/></worksheet>`;
		expect(setCellText(empty, 'B2', 'P').xml).toContain('<sheetData><row r="2"><c r="B2" t="inlineStr">');
	});

	it('접두사가 붙은 XML(x:)도 같은 접두사로 쓴다', () => {
		const xml = `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1"/></x:row></x:sheetData></x:worksheet>`;
		expect(setCellText(xml, 'A1', 'P').xml).toContain(
			'<x:c r="A1" t="inlineStr"><x:is><x:t xml:space="preserve">P</x:t></x:is></x:c>'
		);
	});

	it('주소 없는 칸이 있는 행은 위치를 추측하지 않고 오류를 낸다', () => {
		const xml = sheet('<row r="2"><c s="1"/></row>');
		expect(() => setCellText(xml, 'H2', 'P')).toThrow('주소');
	});

	it('cols의 col 요소와 c 요소를 헷갈리지 않는다', () => {
		const xml = sheet('<row r="2"><c r="H2"/></row>', '<cols><col min="1" max="1" width="5"/></cols>');
		expect(setCellText(xml, 'H2', 'P').xml).toContain('<cols><col min="1" max="1" width="5"/></cols>');
	});
});
