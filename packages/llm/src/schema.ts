/**
 * 모델 출력 확인용 JSON 스키마 (필요한 부분만). Ollama의 `format`에도 그대로 넘긴다.
 * Ollama 문법 제약이 모든 조건(길이·범위)을 강제하지는 않으므로 결과를 여기서 다시 검사한다.
 */
export interface JsonSchema {
	type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
	enum?: readonly (string | number | boolean | null)[];
	properties?: Record<string, JsonSchema>;
	required?: readonly string[];
	additionalProperties?: boolean;
	items?: JsonSchema;
	minItems?: number;
	maxItems?: number;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	description?: string;
}

const typeOf = (v: unknown): string =>
	v === null
		? 'null'
		: Array.isArray(v)
			? 'array'
			: typeof v === 'number' && Number.isInteger(v)
				? 'integer'
				: typeof v;

/** 맞지 않는 곳을 "경로: 이유"로 돌려준다 (빈 배열이면 통과) */
export function validateJson(schema: JsonSchema, value: unknown, path = '$'): string[] {
	const errors: string[] = [];
	const actual = typeOf(value);
	if (schema.type !== undefined) {
		const ok = schema.type === actual || (schema.type === 'number' && actual === 'integer');
		if (!ok) return [`${path}: ${schema.type}여야 함 (${actual})`];
	}
	if (schema.enum !== undefined && !schema.enum.some((e) => e === value)) {
		errors.push(`${path}: ${schema.enum.map(String).join(' | ')} 중 하나여야 함 (${JSON.stringify(value)})`);
	}
	if (typeof value === 'string') {
		const length = [...value].length;
		if (schema.minLength !== undefined && length < schema.minLength)
			errors.push(`${path}: ${schema.minLength}자 이상`);
		if (schema.maxLength !== undefined && length > schema.maxLength)
			errors.push(`${path}: ${schema.maxLength}자 이하`);
	}
	if (typeof value === 'number') {
		if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${schema.minimum} 이상`);
		if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${schema.maximum} 이하`);
	}
	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems)
			errors.push(`${path}: ${schema.minItems}개 이상`);
		if (schema.maxItems !== undefined && value.length > schema.maxItems)
			errors.push(`${path}: ${schema.maxItems}개 이하`);
		const items = schema.items;
		if (items !== undefined) value.forEach((v, i) => errors.push(...validateJson(items, v, `${path}[${i}]`)));
	}
	if (actual === 'object' && value !== null) {
		const obj = value as Record<string, unknown>;
		for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}.${key}: 없음`);
		for (const [key, v] of Object.entries(obj)) {
			const sub = schema.properties?.[key];
			if (sub !== undefined) errors.push(...validateJson(sub, v, `${path}.${key}`));
			else if (schema.additionalProperties === false) errors.push(`${path}.${key}: 정의되지 않은 항목`);
		}
	}
	return errors;
}
