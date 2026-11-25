import type { ExportedFrame, FigmaExport } from './exportFormat';
import { DEFAULT_FOCUS_OPTIONS, estimateFocus } from './focus';
import type { FocusEstimate, FocusOptions } from './focus';
import { elementById, isShown, normalizeFrame } from './normalize';
import type { FigmaElement, NormalizedFrame } from './normalize';
import { DEFAULT_REPEAT_OPTIONS, findRepeatGroups } from './repeat';
import type { RepeatGroup, RepeatOptions } from './repeat';

/**
 * 프레임 분석: 정규화 → 프레임 분류 → 반복 묶음 → 포커스 추정 → 글자 분류·앵커 (설계 7.2, 7.3).
 */

export type FrameKind = 'gui' | 'spec' | 'unknown';

/**
 * fixed: 셸프 제목·버튼 라벨처럼 내용까지 비교할 글자
 * data: 반복 카드 안의 예시 데이터 (내용 비교 제외, 스타일만 비교)
 * ordinal: 반복 카드 안의 순번 숫자 (앵커)
 */
export type TextClass = 'fixed' | 'data' | 'ordinal';

export interface Anchor {
	id: string;
	label: string;
	reason: 'name' | 'component' | 'fixed-text' | 'ordinal';
}

export interface AnalyzeOptions {
	/** GUI 프레임으로 볼 화면 크기 */
	screenSizes: { width: number; height: number }[];
	/** 화면설계서 화면 ID (예: "4.1. Search Field") */
	screenIdPattern: RegExp;
	repeat: RepeatOptions;
	focus: FocusOptions;
}

export const DEFAULT_ANALYZE_OPTIONS: AnalyzeOptions = {
	screenSizes: [
		{ width: 1920, height: 1080 },
		{ width: 1280, height: 720 },
		{ width: 3840, height: 2160 }
	],
	screenIdPattern: /^\d+(\.\d+)*\.\s+\S/,
	repeat: DEFAULT_REPEAT_OPTIONS,
	focus: DEFAULT_FOCUS_OPTIONS
};

export interface FrameAnalysis {
	frame: NormalizedFrame;
	kind: FrameKind;
	kindReason: string;
	counts: { total: number; shown: number; partial: number; clipped: number; hidden: number };
	groups: RepeatGroup[];
	focus: FocusEstimate;
	textClasses: Map<string, { class: TextClass; reason: string }>;
	anchors: Anchor[];
}

export function classifyFrame(
	frame: NormalizedFrame,
	options: AnalyzeOptions = DEFAULT_ANALYZE_OPTIONS
): {
	kind: FrameKind;
	reason: string;
} {
	if (options.screenSizes.some((s) => s.width === frame.width && s.height === frame.height)) {
		return { kind: 'gui', reason: `화면 크기 ${frame.width}×${frame.height}` };
	}
	const screenId = frame.elements.find(
		(e) => e.kind === 'text' && isShown(e) && options.screenIdPattern.test(e.text?.characters.trim() ?? '')
	);
	if (screenId !== undefined) {
		return { kind: 'spec', reason: `화면 ID 형식 글자 "${screenId.text?.characters.split('\n')[0] ?? ''}"` };
	}
	return { kind: 'unknown', reason: `화면 크기(${frame.width}×${frame.height})도 화면 ID 글자도 아님` };
}

function memberOf(frame: NormalizedFrame, element: FigmaElement, memberIds: Set<string>): boolean {
	let cur: FigmaElement | undefined = element;
	while (cur !== undefined) {
		if (memberIds.has(cur.id)) return true;
		cur = cur.parentId === null ? undefined : elementById(frame, cur.parentId);
	}
	return false;
}

export function classifyTexts(
	frame: NormalizedFrame,
	groups: readonly RepeatGroup[]
): Map<string, { class: TextClass; reason: string }> {
	// 순번 숫자처럼 짧은 반복 글자도 묶음 멤버이므로, 글자 묶음은 제외하고 컨테이너 묶음만 본다
	const memberIds = new Set(
		groups
			.filter((g) => g.memberIds.some((id) => elementById(frame, id)?.kind !== 'text'))
			.flatMap((g) => g.memberIds)
	);
	const out = new Map<string, { class: TextClass; reason: string }>();
	for (const e of frame.elements) {
		if (e.kind !== 'text' || e.text === null) continue;
		if (e.inInstance) {
			out.set(e.id, { class: 'fixed', reason: '컴포넌트 인스턴스 안 글자' });
		} else if (memberOf(frame, e, memberIds)) {
			out.set(
				e.id,
				/^\d{1,3}$/.test(e.text.characters.trim())
					? { class: 'ordinal', reason: '반복 요소 안 순번 숫자' }
					: { class: 'data', reason: '반복 요소 안 글자 (예시 데이터)' }
			);
		} else {
			out.set(e.id, { class: 'fixed', reason: '반복 요소 밖 글자' });
		}
	}
	return out;
}

export function findAnchors(frame: NormalizedFrame, texts: Map<string, { class: TextClass }>): Anchor[] {
	const anchors: Anchor[] = [];
	for (const e of frame.elements.slice(1)) {
		if (!isShown(e)) continue;
		const cls = texts.get(e.id)?.class;
		if (e.type === 'INSTANCE' && e.component !== null) {
			anchors.push({
				id: e.id,
				label: e.anchorName ?? e.component.setName ?? e.component.name,
				reason: 'component'
			});
		} else if (e.anchorName !== null && !e.inInstance) {
			anchors.push({ id: e.id, label: e.anchorName, reason: 'name' });
		} else if (cls === 'fixed' && !e.inInstance && e.text !== null) {
			anchors.push({ id: e.id, label: e.text.characters, reason: 'fixed-text' });
		} else if (cls === 'ordinal' && e.text !== null) {
			anchors.push({ id: e.id, label: e.text.characters, reason: 'ordinal' });
		}
	}
	return anchors;
}

export function analyzeFrame(
	exported: ExportedFrame,
	options: AnalyzeOptions = DEFAULT_ANALYZE_OPTIONS
): FrameAnalysis {
	const frame = normalizeFrame(exported);
	const { kind, reason } = classifyFrame(frame, options);
	const groups = findRepeatGroups(frame, options.repeat);
	const focus: FocusEstimate =
		kind === 'gui'
			? estimateFocus(frame, groups, options.focus)
			: { primary: null, ambiguous: false, candidates: [], skipped: [] };
	const textClasses = classifyTexts(frame, groups);
	const all = frame.elements;
	return {
		frame,
		kind,
		kindReason: reason,
		counts: {
			total: all.length,
			shown: all.filter(isShown).length,
			partial: all.filter((e) => !e.hidden && e.visibility === 'partial').length,
			clipped: all.filter((e) => !e.hidden && e.visibility === 'clipped').length,
			hidden: all.filter((e) => e.hidden).length
		},
		groups,
		focus,
		textClasses,
		anchors: findAnchors(frame, textClasses)
	};
}

export function analyzeExport(data: FigmaExport, options: AnalyzeOptions = DEFAULT_ANALYZE_OPTIONS): FrameAnalysis[] {
	return data.frames.map((f) => analyzeFrame(f, options));
}
