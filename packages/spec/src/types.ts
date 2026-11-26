import type { Rect } from '@auto-qa/core';

/** 설명에 적힌 리모컨 키 동작 ([▲]: …) */
export type SpecKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';

export interface CalloutDescription {
	/** 첫 줄 (예: "Search field 영역") */
	label: string;
	/** "_"로 시작하는 요약 줄 */
	summary: string[];
	/** "1)표시 내용", "2)선택 시" 같은 묶음 */
	sections: { title: string; items: string[] }[];
	/** 방향키·OK·Back 동작. 키 줄 아래 조건 줄은 같은 키에 이어 붙인다 */
	keys: Partial<Record<SpecKey, string>>;
	lines: string[];
}

/**
 * 마커가 가리키는 대상을 정한 방법 (신뢰도 높은 순)
 * annotation-box: 마커를 감싼 강조 상자(칠 없이 테두리만), label: 설명 이름과 같은 목업 글자,
 * container: 마커를 감싼 목업 상자, nearest: 가장 가까운 목업 요소
 */
export type TargetMethod = 'annotation-box' | 'label' | 'container' | 'nearest';

export interface CalloutTarget {
	method: TargetMethod;
	elementId: string;
	name: string;
	text: string | null;
	/** 화면설계서 페이지 좌표 */
	specRect: Rect;
	/** 실제 화면 좌표 (목업 → 화면 배율 적용) */
	screenRect: Rect;
	confidence: number;
	reason: string;
}

export interface Callout {
	/** 번호 (예: "1") */
	no: string;
	label: string | null;
	description: CalloutDescription | null;
	/** 목업 위 마커 */
	markerRect: Rect | null;
	/** 설명 옆 마커 */
	descriptionMarkerRect: Rect | null;
	target: CalloutTarget | null;
}

export interface VersionEntry {
	version: string;
	changes: string[];
}

export interface SpecScreen {
	frameId: string;
	frameName: string;
	pageName: string;
	/** 예: "4.1.1" */
	screenId: string | null;
	title: string | null;
	/** 헤더에 함께 적힌 상위 화면 (예: 4.1.1 페이지의 "4.1. Search Field …") */
	parents: { screenId: string; title: string }[];
	pageNumber: string | null;
	/** 헤더의 수정 표시(M) */
	modified: boolean;
	/** 헤더와 목업 사이의 화면 설명 (진입 조건) */
	entryConditions: string[];
	defaultFocus: string | null;
	mockup: { rect: Rect; scale: number; screen: { width: number; height: number } } | null;
	callouts: Callout[];
	/** [추가 설명] */
	notes: string[];
	/** Audio Guidance 상자 (검수는 보류, D-015) */
	audioGuidance: string[];
	versions: VersionEntry[];
	/** 프레임 경계 밖 메모 (검수 대상 아님) */
	offFrameNotes: string[];
	diagnostics: string[];
}
