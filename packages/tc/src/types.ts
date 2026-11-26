/** TC 프로필과 공통 TC 모델 (설계 5장, D-021) */

export type ColumnRole =
	| 'id'
	| 'title'
	| 'category'
	| 'caseNo'
	| 'step'
	| 'precondition'
	| 'action'
	| 'expected'
	| 'result'
	/** 결과 이유를 쓰는 열 (예: Issue Detail). Fail 이유·확인 필요 이유를 여기에 쓴다 (D-040) */
	| 'issue'
	| 'note'
	| 'severity';

export type SheetKind = 'test-cases' | 'checklist' | 'given-when-then' | 'log-spec' | 'unknown';

export interface SheetProfile {
	sheet: string;
	kind: SheetKind;
	/** 정규화 대상인지 (숨김 시트·체크리스트 등은 false) */
	include: boolean;
	/** 헤더 행 번호 (1부터) */
	headerRow: number;
	/** 역할 → 열 문자 */
	columns: Partial<Record<ColumnRole, string>>;
	/** 이 역할 칸에 값이 있으면 새 TC가 시작된다 (예: ID 또는 제목). 아래 행은 위 TC를 이어받는다 */
	groupStart: ColumnRole[];
	/** 조작 칸 형식: 행마다 한 단계 / 한 칸 안에 "1. … 2. …" 번호 목록 */
	stepFormat: 'row-per-step' | 'numbered-list';
	/** 앞 단계 참조 정규식 (예: "seq 3 수행"). 첫 캡처 그룹이 단계 번호 */
	referencePattern: string | null;
	/** TC ID에서 화면설계서 번호를 뽑는 정규식. 캡처 1 = 버전, 2 = 나머지(번호 포함) */
	specIdPattern: string | null;
	/** 조작 칸의 콜아웃 참조 정규식 (예: "(1) Search field 영역"). 캡처 1 = 번호, 2 = 이름 */
	targetRefPattern: string | null;
	/** 제안 근거 (사람이 확인할 때 보여 준다) */
	evidence: string[];
	/** 0~1 */
	confidence: number;
}

export interface TcProfile {
	version: 1;
	sheets: SheetProfile[];
}

export interface CellRef {
	sheet: string;
	row: number;
	column: string;
	/** 예: H12 */
	address: string;
}

export type AutomationLabel = 'auto' | 'proxy' | 'manual' | 'deferred' | 'out-of-scope';

export interface StepReference {
	/** 참조한 단계 번호 (예: "3") */
	stepNo: string;
	/** 같은 TC 안에서 찾은 행. 못 찾으면 null */
	row: number | null;
	/** 같은 번호가 위에 여러 개 있어 가장 가까운 것을 골랐는지 */
	ambiguous: boolean;
}

export interface TcStep {
	/** 원본 행 (병합된 행이면 첫 행) */
	row: number;
	/** 병합으로 이어진 행 수 */
	rowSpan: number;
	stepNo: string | null;
	caseNo: string | null;
	precondition: string | null;
	action: string | null;
	/** 번호 목록이면 항목별로 나눈 조작, 아니면 [action] */
	actions: string[];
	expected: string | null;
	expectedItems: string[];
	note: string | null;
	/** 결과(P/F)를 적을 칸. 결과 열이 없으면 null */
	resultCell: CellRef | null;
	/** 원본에 이미 적힌 결과 (예: PASS) */
	existingResult: string | null;
	references: StepReference[];
	/** 화면설계서 콜아웃 참조 (D-024) */
	targetRef: { callout: string; label: string } | null;
	automation: AutomationLabel;
	automationRule: string;
	automationReason: string;
}

export interface SpecRef {
	raw: string;
	version: string | null;
	/** 화면설계서 번호 (예: 4.1). 번호 형식이 아니면 null */
	screenId: string | null;
}

export interface TcCase {
	/** 파일 안에서 유일한 키: 시트!첫 행 */
	key: string;
	sheet: string;
	/** 원본 TC ID (없거나 중복될 수 있다) */
	id: string | null;
	title: string | null;
	category: string | null;
	firstRow: number;
	lastRow: number;
	specRef: SpecRef | null;
	steps: TcStep[];
}

export interface Diagnostic {
	sheet: string;
	row: number;
	kind: 'unmapped-content' | 'unresolved-reference' | 'ambiguous-reference' | 'no-group-start';
	message: string;
}
