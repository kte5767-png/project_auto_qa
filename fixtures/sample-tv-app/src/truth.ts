/**
 * 샘플 앱 채점용 정답 읽기 (D-018). QA 서비스의 검출 로직에는 쓰지 않고, 스파이크·채점기에서만 쓴다.
 * 시뮬레이터(브라우저)와 실기기(TV에 설치한 샘플 앱) 모두에서 같은 스크립트를 평가한다.
 */

export interface SampleTruth {
	/** 정답 포커스 요소의 body부터 경로. 없으면 null */
	path: string | null;
	/** 포커스 가능한 모든 요소(data-sample-nav)의 경로 */
	navPaths: string[];
}

/**
 * 페이지 안에서 실행된다. 구형 TV 엔진(Chromium 68)에서도 돌도록 ES2017 문법만 쓴다.
 * 경로 형식은 `@auto-qa/focus`의 수집 스크립트와 같다 (`body>div:nth-of-type(1)>…`).
 */
function readTruthInPage(): SampleTruth {
	const pathOf = (el: Element): string => {
		const parts: string[] = [];
		let node: Element | null = el;
		while (node !== null && node !== document.body && node.parentElement !== null) {
			let index = 1;
			let sibling = node.previousElementSibling;
			while (sibling !== null) {
				if (sibling.tagName === node.tagName) index++;
				sibling = sibling.previousElementSibling;
			}
			parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
			node = node.parentElement;
		}
		return parts.length === 0 ? 'body' : `body>${parts.join('>')}`;
	};
	const modeEl = document.querySelector('[data-focus-mode]');
	const mode = modeEl === null ? null : modeEl.getAttribute('data-focus-mode');
	let el: Element | null = null;
	if (mode === 'class') {
		el = document.querySelector('.nav-item.focused');
	} else if (document.activeElement !== null) {
		el = document.activeElement.closest('[data-sample-nav]');
	}
	return {
		path: el === null ? null : pathOf(el),
		navPaths: Array.from(document.querySelectorAll('[data-sample-nav]')).map(pathOf)
	};
}

/** 정답 읽기 스크립트(JS 식). 드라이버의 evaluate로 평가한다. */
export function sampleTruthScript(): string {
	return `(function(){var __name=function(f){return f};return (${readTruthInPage.toString()})();})()`;
}

function isAncestor(ancestor: string, path: string): boolean {
	return path.startsWith(`${ancestor}>`);
}

/**
 * 어댑터가 고른 요소가 정답과 맞는지 (D-019 판정 기준):
 * 같은 요소, 정답 안쪽 요소, 또는 포커스 가능 요소를 정답 하나만 감싼 바깥 요소면 맞다.
 */
export function matchesTruth(path: string | null, truth: SampleTruth): boolean {
	if (truth.path === null) return path === null;
	if (path === null) return false;
	if (path === truth.path || isAncestor(truth.path, path)) return true;
	if (isAncestor(path, truth.path)) {
		return truth.navPaths.filter((p) => p === path || isAncestor(path, p)).length === 1;
	}
	return false;
}
