import { describe, expect, it } from 'vitest';
import { parseOperation } from './operation';

describe('parseOperation', () => {
	it('키 낱말을 나온 순서대로 모으고, 닫힘 결과를 읽는다', () => {
		expect(parseOperation('상단방향키 포커스 후 확인 버튼 선택 시 팝업 닫힘')).toMatchObject({
			keys: ['up', 'ok'],
			result: 'closed'
		});
		expect(parseOperation('Back 버튼을 누르면 팝업 닫힘')?.keys).toEqual(['back']);
	});

	it('"이동 중 입력이 발생하더라도 … 중단되지 않음"은 끼어드는 입력에도 끝까지 가는지', () => {
		expect(parseOperation('이동 중 사용자 입력이 발생하더라도 스크롤 이동은 중단되지 않음')).toMatchObject({
			keys: [],
			result: 'uninterrupted'
		});
	});

	it('"항목 루프되지 않음"은 목록 끝에서 돌아가지 않는지', () => {
		expect(parseOperation('항목 루프되지 않음')?.result).toBe('no-loop');
	});

	it('키 낱말이 없거나 결과를 모르면 정하지 않는다', () => {
		expect(parseOperation('팝업 외 영역 선택 시 팝업 닫힘')).toBeNull();
		expect(parseOperation('확인 버튼 선택 시 저장')).toBeNull();
		expect(parseOperation('최근 검색어 저장 On/Off 가능')).toBeNull();
	});
});
