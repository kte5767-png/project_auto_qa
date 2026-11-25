/** 요소 하나의 요약. path는 body부터의 CSS 경로(`body>div:nth-of-type(1)>…`)로, 같은 DOM 구조에서는 안정적이다. */
export interface ElementInfo {
	path: string;
	tag: string;
	id: string | null;
	classes: string[];
	/** Enact Spotlight가 붙이는 data-spotlight-id (실제 앱에도 있는 속성) */
	spotlightId: string | null;
	/** [x, y, width, height] */
	rect: [number, number, number, number];
	text: string;
}

/** 포커스 강조에 쓰이는 스타일 속성 묶음 (위치·크기는 스크롤에 흔들리므로 넣지 않는다) */
export interface StyleSig {
	transform: string;
	outline: string;
	border: string;
	boxShadow: string;
	background: string;
	color: string;
	opacity: string;
	/** ::after 의사 요소: `display|opacity|borderWidth|borderStyle` */
	after: string;
	/** ::before 의사 요소: 같은 형식 */
	before: string;
}

/** 키 입력 한 번 뒤 브라우저에서 수집한 포커스 관련 상태 (직렬화 가능) */
export interface FocusState {
	/** document.activeElement. body·html이면 null */
	active: ElementInfo | null;
	/** `.spottable` 요소 수 (Enact Spotlight 탐지 신호) */
	spottableCount: number;
	/** 설정된 포커스 선택자에 맞는 요소 */
	selectorMatches: ElementInfo[];
	/** 클래스 토큰 → 그 클래스를 가진 요소 경로 (가진 요소가 적은 토큰만) */
	classHolders: Record<string, string[]>;
	/** 요소 경로 → 스타일 (화면에 보이는 중간 크기 요소만) */
	styles: Record<string, StyleSig>;
	/** 요소 경로 → 요약 (styles·classHolders에 나온 요소) */
	elements: Record<string, ElementInfo>;
}

export type FocusAdapterId = 'enact-spotlight' | 'active-element' | 'selector' | 'style-diff';

export interface FocusReading {
	adapter: FocusAdapterId;
	/** 포커스로 판단한 요소 경로. 판단할 수 없으면 null */
	path: string | null;
	element: ElementInfo | null;
}

export interface FocusCandidate {
	adapter: FocusAdapterId;
	/** selector 어댑터일 때 탐지된 선택자 */
	selector?: string;
	/** 0~1 */
	confidence: number;
	evidence: string;
}
