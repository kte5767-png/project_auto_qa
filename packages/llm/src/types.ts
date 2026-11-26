import type { JsonSchema } from './schema';

export interface LlmMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
	/** base64 PNG/JPEG (data: 접두어 없이) */
	images?: string[];
}

export interface ChatRequest {
	model: string;
	messages: LlmMessage[];
	/** 출력 JSON 스키마. 주면 결과를 파싱·검사한다 */
	schema?: JsonSchema;
	options?: {
		temperature?: number;
		seed?: number;
		/** 컨텍스트 길이 (토큰) */
		numCtx?: number;
		/** 최대 출력 토큰 */
		numPredict?: number;
	};
	/** 생각(추론) 모드: 생략하면 모델 기본값 */
	think?: boolean | string;
	/** 모델을 메모리에 남겨 둘 시간 ("5m", 0 = 바로 내림) */
	keepAlive?: string | number;
}

export interface ChatMetrics {
	/** 이 PC에서 잰 요청~응답 시간 */
	wallMs: number;
	totalMs: number;
	loadMs: number;
	promptTokens: number;
	promptMs: number;
	outputTokens: number;
	outputMs: number;
	/** 출력 토큰 / 초 */
	tokensPerSecond: number | null;
}

export interface ChatResult {
	model: string;
	content: string;
	thinking: string | null;
	doneReason: string | null;
	/** schema를 줬을 때: JSON 파싱 결과 (실패하면 undefined) */
	json: unknown;
	/** JSON 파싱·스키마 검사 오류 (없으면 빈 배열) */
	errors: string[];
	metrics: ChatMetrics;
}

export interface ModelInfo {
	name: string;
	sizeBytes: number;
	family: string | null;
	parameterSize: string | null;
	quantization: string | null;
}

export interface ModelDetails {
	/** 예: completion, vision, thinking, tools */
	capabilities: string[];
	license: string | null;
}

export interface RunningModel {
	name: string;
	sizeBytes: number;
	/** GPU 메모리 사용 (내장 GPU·CPU 실행이면 0일 수 있음) */
	vramBytes: number;
	contextLength: number | null;
}

/** 로컬 LLM 서버 (구현: Ollama). 테스트는 가짜 서버를 쓴다 */
export interface LlmClient {
	version(): Promise<string>;
	models(): Promise<ModelInfo[]>;
	show(model: string): Promise<ModelDetails>;
	running(): Promise<RunningModel[]>;
	chat(request: ChatRequest): Promise<ChatResult>;
	/** 모델을 메모리에서 내린다 (메모리가 작은 PC에서 모델을 하나씩 비교하기 위해) */
	unload(model: string): Promise<void>;
}
