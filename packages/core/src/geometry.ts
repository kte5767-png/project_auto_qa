/**
 * 사각형 기하 연산. Figma 노드와 DOM 요소의 위치 비교, 요소 매칭(IoU),
 * 뷰포트 경계 처리(D-011: 경계 밖 제외, 경계에 걸친 요소는 partial)에 쓴다.
 */

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

/** 뷰포트 기준 가시성. `hidden`(숨김 레이어)은 Figma 정규화 단계에서 따로 판정한다. */
export type Visibility = 'visible' | 'partial' | 'clipped';

export interface ClipResult {
	visibility: Visibility;
	/** 뷰포트 안에 보이는 부분. `clipped`이면 null. */
	visibleRect: Rect | null;
	/** 원래 면적 대비 보이는 면적 비율 (0~1). 면적이 0인 요소는 위치만으로 판정한다. */
	visibleRatio: number;
}

function assertValidRect(r: Rect, name: string): void {
	const values = [r.x, r.y, r.width, r.height];
	if (values.some((v) => !Number.isFinite(v))) {
		throw new RangeError(`${name}: 모든 값은 유한한 숫자여야 합니다.`);
	}
	if (r.width < 0 || r.height < 0) {
		throw new RangeError(`${name}: width와 height는 0 이상이어야 합니다.`);
	}
}

export function area(r: Rect): number {
	assertValidRect(r, 'area');
	return r.width * r.height;
}

/** 두 사각형의 겹치는 영역. 겹치지 않으면 null. 변만 맞닿은 경우도 null로 본다. */
export function intersection(a: Rect, b: Rect): Rect | null {
	assertValidRect(a, 'intersection(a)');
	assertValidRect(b, 'intersection(b)');
	const left = Math.max(a.x, b.x);
	const top = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	if (right <= left || bottom <= top) {
		return null;
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Intersection over Union (0~1). 두 사각형의 면적이 모두 0이면 0. */
export function iou(a: Rect, b: Rect): number {
	const inter = intersection(a, b);
	if (inter === null) {
		return 0;
	}
	const interArea = area(inter);
	const union = area(a) + area(b) - interArea;
	return union > 0 ? interArea / union : 0;
}

/** 좌표와 크기를 배율로 변환한다. Figma 프레임 좌표 → 뷰포트 좌표 정규화에 쓴다. */
export function scaleRect(r: Rect, sx: number, sy: number = sx): Rect {
	assertValidRect(r, 'scaleRect');
	if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
		throw new RangeError('scaleRect: 배율은 0보다 큰 유한한 숫자여야 합니다.');
	}
	return { x: r.x * sx, y: r.y * sy, width: r.width * sx, height: r.height * sy };
}

/**
 * 요소를 뷰포트(0,0 ~ width,height)로 잘라 가시성을 판정한다.
 * - visible: 전부 보임
 * - partial: 일부만 보임 → 보이는 속성만 비교
 * - clipped: 전혀 안 보임 → 비교 제외
 */
export function clipToViewport(r: Rect, viewport: Size): ClipResult {
	assertValidRect(r, 'clipToViewport');
	if (
		!Number.isFinite(viewport.width) ||
		!Number.isFinite(viewport.height) ||
		viewport.width <= 0 ||
		viewport.height <= 0
	) {
		throw new RangeError('clipToViewport: 뷰포트 크기는 0보다 커야 합니다.');
	}
	const vp: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };

	if (r.width === 0 || r.height === 0) {
		const inside = r.x >= 0 && r.y >= 0 && r.x <= vp.width && r.y <= vp.height;
		return inside
			? { visibility: 'visible', visibleRect: { ...r }, visibleRatio: 1 }
			: { visibility: 'clipped', visibleRect: null, visibleRatio: 0 };
	}

	const visibleRect = intersection(r, vp);
	if (visibleRect === null) {
		return { visibility: 'clipped', visibleRect: null, visibleRatio: 0 };
	}
	const visibleRatio = area(visibleRect) / area(r);
	return {
		visibility: visibleRatio >= 1 ? 'visible' : 'partial',
		visibleRect,
		visibleRatio
	};
}
