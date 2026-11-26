/**
 * 검수용 AI는 로컬 LLM만 쓴다 (D-026). 회사 자료(TC·화면·Figma)가 밖으로 나가지 않도록
 * LLM 서버 주소는 이 PC 또는 내부망(사설 IP)만 받는다. 내부망 이름(예: gpu-pc.corp)은 allowHosts로 명시한다.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** localhost, 127.0.0.0/8, ::1, 10/8, 172.16/12, 192.168/16 */
export function isLocalHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'localhost' || host === '::1') return true;
	const m = IPV4.exec(host);
	if (m === null) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
	return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** LLM 서버 주소 확인. 외부 주소면 예외 */
export function assertLocalEndpoint(url: string, allowHosts: readonly string[] = []): URL {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`LLM 서버 주소가 올바르지 않음: ${url}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`LLM 서버 주소는 http(s)만 받음: ${url}`);
	}
	const host = parsed.hostname.toLowerCase();
	if (!isLocalHost(host) && !allowHosts.map((h) => h.toLowerCase()).includes(host)) {
		throw new Error(
			`외부 주소로는 보내지 않음 (D-026 로컬 LLM만 사용): ${parsed.host}. 내부망 서버라면 허용 목록(allowHosts)에 이름을 넣으세요`
		);
	}
	return parsed;
}
