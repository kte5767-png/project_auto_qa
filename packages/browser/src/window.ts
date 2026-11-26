/**
 * 브라우저 창을 띄워 볼 때(headed) 1920×1080 화면 전체가 모니터 안에 들어오게 하는 배율.
 *
 * 페이지는 늘 1920×1080 CSS px·devicePixelRatio 1로 에뮬레이션하므로(레이아웃·캡처는 TV와 같음),
 * 창은 모니터의 실제 화소에 그려진다. Windows 배율 150%인 1920×1080 모니터에서는 1920 CSS px가
 * 2880 화소로 그려져 화면 왼쪽 위만 보인다. Chrome의 `--force-device-scale-factor`로 창 배율만 줄여 맞춘다.
 * 이 값은 창에 그리는 크기만 바꾸며 페이지 레이아웃·캡처 크기는 바꾸지 않는다.
 */
export interface ScreenInfo {
	/** 작업 표시줄을 뺀 모니터 크기 (CSS px, 시스템 배율 기준) */
	availWidth: number;
	availHeight: number;
	/** 시스템 배율 (Windows 150% → 1.5) */
	dpr: number;
}

export interface FitOptions {
	viewport: { width: number; height: number };
	/** 창 테두리·탭·주소 표시줄이 차지하는 크기 (배율 1 기준 px) */
	chrome: { width: number; height: number };
	/** 배율을 이 단위로 내림한다 */
	step: number;
	min: number;
}

export const DEFAULT_FIT_OPTIONS: FitOptions = {
	viewport: { width: 1920, height: 1080 },
	chrome: { width: 16, height: 100 },
	step: 0.05,
	min: 0.25
};

/** 시스템 배율 그대로도 다 보이면 null (배율을 바꾸지 않음) */
export function fitWindowScale(screen: ScreenInfo, options: Partial<FitOptions> = {}): number | null {
	const o = { ...DEFAULT_FIT_OPTIONS, ...options };
	const width = screen.availWidth * screen.dpr;
	const height = screen.availHeight * screen.dpr;
	const raw = Math.min(width / (o.viewport.width + o.chrome.width), height / (o.viewport.height + o.chrome.height));
	if (raw >= screen.dpr) return null;
	const stepped = Math.floor(raw / o.step + 1e-9) * o.step;
	return Math.max(o.min, Math.round(stepped * 100) / 100);
}
