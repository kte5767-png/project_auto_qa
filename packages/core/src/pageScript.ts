/**
 * 페이지(앱) 안에서 실행하는 스크립트 규칙.
 *
 * TV 안 스크립트는 지원하는 가장 오래된 엔진에서 돌아야 한다 (개발지침 3장).
 * webOS 5.x = Chromium 68 → ES2017까지만 쓴다. `?.`, `??`, `??=`, 객체 전개(`{...a}`),
 * catch 바인딩 생략, async 함수 안의 for await 등은 쓰지 않는다. 테스트에서 이 수준으로 파싱해 확인한다.
 */
export const PAGE_SCRIPT_ECMA_VERSION = 2017;

/**
 * 페이지 함수와 인자를 하나의 JS 식으로 만든다. 드라이버는 이 식을 그대로 평가한다
 * (시뮬레이터: Playwright `page.evaluate`, 실기기: CDP `Runtime.evaluate`).
 *
 * - 인자는 JSON으로 넣는다 (함수·undefined는 전달되지 않는다).
 * - tsx·esbuild의 keepNames가 함수 소스에 넣는 `__name(fn, "name")` 호출을
 *   감싼 함수 안의 지역 변수로 받아 준다. 페이지 전역은 건드리지 않는다.
 */
export function pageExpression<A>(fn: (arg: A) => unknown, arg: A): string {
	return `(function(){var __name=function(f){return f};return (${fn.toString()})(${JSON.stringify(arg)});})()`;
}
