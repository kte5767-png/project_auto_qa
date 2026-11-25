import type { AresCli } from './ares';

/**
 * 개발자 모드 남은 시간 조회 (실험적, 비공식 경로).
 * - 개발자 모드 세션은 최대 1000시간이며, 끝나면 설치한 앱이 삭제된다 (D-023).
 * - 세션 토큰을 TV에서 읽어 LG 개발자 사이트의 세션 확인 주소에 보낸다. 커뮤니티 도구들이 쓰는 방식이며
 *   LG가 문서로 보장하지 않으므로, 실패하면 TV의 Developer Mode 앱 화면에서 확인한다.
 * - 토큰 외의 정보는 보내지 않는다. 연장(Reset)은 하지 않는다 (조회만).
 */

export const DEVMODE_TOKEN_PATH = '/var/luna/preferences/devmode_enabled';
export const DEVMODE_CHECK_URL = 'https://developer.lge.com/secure/CheckDevModeSession.dev';

export interface DevModeSession {
	/** 남은 시간 (ms) */
	remainingMs: number;
	/** TV가 보여 주는 형식 그대로 (예: 999:58:40) */
	remainingText: string;
}

export class DevModeError extends Error {
	override name = 'DevModeError';
}

/** "999:58:40" → ms */
export function parseRemaining(text: string): number | null {
	const match = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(text.trim());
	if (match === null) return null;
	const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (m > 59 || s > 59) return null;
	return ((h * 60 + m) * 60 + s) * 1000;
}

/** 응답 예: {"result":"success","errorCode":"200","errorMsg":"999:58:40"} */
export function parseDevModeResponse(body: unknown): DevModeSession {
	if (body === null || typeof body !== 'object') throw new DevModeError('세션 확인 응답 형식이 올바르지 않습니다.');
	const data = body as Record<string, unknown>;
	const message = typeof data['errorMsg'] === 'string' ? data['errorMsg'] : '';
	if (data['result'] !== 'success') {
		throw new DevModeError(`세션 확인 실패: ${String(data['errorCode'] ?? '')} ${message}`.trim());
	}
	const remainingMs = parseRemaining(message);
	if (remainingMs === null) throw new DevModeError(`남은 시간을 읽지 못했습니다: ${message}`);
	return { remainingMs, remainingText: message.trim() };
}

export function isValidToken(token: string): boolean {
	return /^[A-Za-z0-9_-]{8,256}$/.test(token);
}

/** TV에서 세션 토큰 읽기 (ares-novacom --run) */
export async function readDevModeToken(ares: AresCli): Promise<string> {
	const output = (await ares.runOnDevice(`cat ${DEVMODE_TOKEN_PATH}`)).trim();
	if (!isValidToken(output)) {
		throw new DevModeError(
			'TV에서 개발자 모드 세션 토큰을 읽지 못했습니다. Developer Mode 앱 화면에서 남은 시간을 확인해 주세요.'
		);
	}
	return output;
}

type FetchLike = (
	url: string,
	init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export async function checkDevModeSession(
	token: string,
	options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<DevModeSession> {
	if (!isValidToken(token)) throw new DevModeError('세션 토큰 형식이 올바르지 않습니다.');
	const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
	const response = await fetchImpl(`${DEVMODE_CHECK_URL}?sessionToken=${encodeURIComponent(token)}`, {
		signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)
	});
	if (!response.ok) throw new DevModeError(`세션 확인 HTTP ${response.status}`);
	let body: unknown;
	try {
		body = JSON.parse(await response.text());
	} catch {
		throw new DevModeError('세션 확인 응답이 JSON이 아닙니다.');
	}
	return parseDevModeResponse(body);
}
