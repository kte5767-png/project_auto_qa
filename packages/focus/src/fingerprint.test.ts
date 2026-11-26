import { PAGE_SCRIPT_ECMA_VERSION } from '@auto-qa/core';
import type { RemoteKey } from '@auto-qa/core';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RESET_RULES,
	addedItems,
	fingerprintScript,
	itemSimilarity,
	matchHome,
	nextResetStep,
	sameFingerprint,
	takeFingerprint
} from './fingerprint';
import type { ResetRules, ScreenFingerprint } from './fingerprint';

const GNB = ['home_gnb', 'search_gnb', 'destinations_gnb', 'luggage_gnb', 'settings_gnb', 'exit_gnb'];
const fp = (items: string[], extra: Partial<ScreenFingerprint> = {}): ScreenFingerprint => ({
	items: [...items].sort(),
	focus: items[0] ?? null,
	focusRegion: null,
	layers: [],
	errors: [],
	...extra
});
const HOME = fp([...GNB, 'card', 'card', 'card', 'card', 'shelf-more', 'top10', 'top10', 'top10']);
const rules: ResetRules = { ...DEFAULT_RESET_RULES, regionExit: { GNB: 'RIGHT' } };

describe('fingerprintScript', () => {
	it('구형 TV 엔진(ES2017)에서 파싱되는 문법만 쓴다', () => {
		expect(() =>
			parse(fingerprintScript({ regions: { GNB: '#tabLayout' } }), { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })
		).not.toThrow();
	});

	it('주어진 실행기로 평가한다 (드라이버에 묶이지 않음)', async () => {
		const seen: string[] = [];
		const fake = {
			evaluate: <T>(expression: string): Promise<T> => {
				seen.push(expression);
				return Promise.resolve(HOME as T);
			}
		};
		expect(await takeFingerprint(fake, { regions: { GNB: '#tabLayout' } })).toBe(HOME);
		expect(seen[0]).toContain('#tabLayout');
	});
});

describe('matchHome', () => {
	it('콘텐츠 몇 개가 바뀌어도 같은 화면, 구조가 다르면 다른 화면', () => {
		expect(itemSimilarity(['a', 'b', 'b'], ['a', 'b', 'b'])).toBe(1);
		expect(
			matchHome(HOME, fp([...GNB, 'card', 'card', 'card', 'shelf-more', 'top10', 'top10', 'top10'])).same
		).toBe(true);
		expect(matchHome(HOME, fp([...GNB, 'searchInput', 'keyword', 'keyword', 'city'])).same).toBe(false);
	});

	it('겹친 층이 늘었거나 포커스가 처음에 없던 영역(GNB 펼침)에 있으면 다른 화면', () => {
		expect(matchHome(HOME, { ...HOME, layers: [{ key: 'popup', hasFocus: true }] }).reason).toContain('겹친 층');
		expect(matchHome(HOME, { ...HOME, focusRegion: 'GNB' }).reason).toContain('GNB');
	});
});

/** TravelPlus 화면설계서 "Back button 정의"를 흉내 낸 앱 (D-039 근거) */
class FakeApp {
	state: 'detail' | 'search' | 'gnb-search' | 'gnb-home' | 'popup' | 'toast' | 'home' | 'closed';
	pressed: RemoteKey[] = [];
	constructor(
		start: FakeApp['state'],
		readonly homeBack: 'popup' | 'toast'
	) {
		this.state = start;
	}
	view(): ScreenFingerprint {
		const search = [...GNB, 'searchInput', 'keyword', 'keyword', 'city'];
		switch (this.state) {
			case 'detail':
				return fp(['backBtn', 'play', 'more']);
			case 'search':
				return fp(search);
			case 'gnb-search':
			case 'gnb-home':
				return fp(search, { focusRegion: 'GNB', focus: this.state === 'gnb-home' ? 'home_gnb' : 'search_gnb' });
			case 'popup':
				return fp([...search, 'exitBtn', 'cancelBtn'], {
					focusRegion: null,
					layers: [{ key: 'popup', hasFocus: true }]
				});
			case 'toast':
				return fp(search, { focusRegion: 'GNB', layers: [{ key: 'toast', hasFocus: false }] });
			case 'home':
				return HOME;
			case 'closed':
				return fp([], { focus: null });
		}
	}
	press(key: RemoteKey): void {
		this.pressed.push(key);
		const s = this.state;
		if (key === 'OK' && (s === 'popup' || s === 'toast')) this.state = 'closed';
		else if (key === 'BACK') {
			if (s === 'detail') this.state = 'search';
			else if (s === 'search') this.state = 'gnb-search';
			else if (s === 'gnb-search') this.state = 'gnb-home';
			else if (s === 'gnb-home') this.state = this.homeBack;
			else if (s === 'popup') this.state = 'gnb-home';
			else if (s === 'toast') this.state = 'closed'; // 토스트가 떠 있을 때 한 번 더 BACK → 앱 종료
		} else if (key === 'RIGHT' && (s === 'gnb-home' || s === 'toast')) this.state = 'home';
	}
}

/** 실행기(spike:tc-run)와 같은 순서: 다음 걸음 → 누름 → 팝업을 닫았거나 BACK에 반응이 없으면 최상위 */
function reset(app: { view(): ScreenFingerprint; press(key: RemoteKey): void }, limit = 12): string {
	const state = { top: 0 };
	for (let i = 0; i < limit; i++) {
		const before = app.view();
		const step = nextResetStep(HOME, before, state, rules);
		if (step.kind === 'done' || step.kind === 'relaunch') return step.kind;
		if (step.kind === 'wait') return 'wait';
		app.press(step.key);
		if (step.closes === 'popup' || (step.key === 'BACK' && sameFingerprint(before, app.view()))) state.top++;
	}
	return 'limit';
}

describe('nextResetStep (처음 화면으로 되돌리기, D-039)', () => {
	it('하위 화면 → BACK으로 올라가 종료 팝업까지 간 뒤 BACK으로 닫고 GNB에서 나와 홈에 도착. OK는 누르지 않는다', () => {
		const app = new FakeApp('detail', 'popup');
		expect(reset(app)).toBe('done');
		expect(app.pressed).toEqual(['BACK', 'BACK', 'BACK', 'BACK', 'BACK', 'RIGHT']);
		expect(app.pressed).not.toContain('OK');
	});

	it('종료 토스트(포커스 없는 층)가 뜨면 BACK을 또 누르지 않고 GNB에서 나간다 (BACK이면 앱이 꺼짐)', () => {
		const app = new FakeApp('search', 'toast');
		expect(reset(app)).toBe('done');
		expect(app.pressed).toEqual(['BACK', 'BACK', 'BACK', 'RIGHT']);
		expect(app.state).toBe('home');
	});

	it('최상위에서 BACK이 반응하지 않는 앱(샘플 앱): 반응 없음을 최상위로 보고 GNB에서 나온다', () => {
		const pressed: RemoteKey[] = [];
		let state: 'search' | 'home-gnb' | 'home' = 'search';
		const app = {
			view: (): ScreenFingerprint =>
				state === 'search'
					? fp(['searchInput', 'keyword', 'keyword'])
					: state === 'home-gnb'
						? { ...HOME, focus: 'search_gnb', focusRegion: 'GNB' }
						: HOME,
			press: (key: RemoteKey): void => {
				pressed.push(key);
				if (key === 'BACK' && state === 'search') state = 'home-gnb';
				else if (key === 'RIGHT' && state === 'home-gnb') state = 'home';
			}
		};
		expect(reset(app)).toBe('done');
		expect(pressed).toEqual(['BACK', 'BACK', 'RIGHT']);
	});

	it('이미 처음 화면이면 아무 키도 누르지 않는다', () => {
		const app = new FakeApp('home', 'popup');
		expect(reset(app)).toBe('done');
		expect(app.pressed).toEqual([]);
	});

	it('나가는 키를 모르는 토스트는 기다리고, 앱이 꺼졌으면 다시 열기', () => {
		const toast = fp(['card'], { layers: [{ key: 'toast', hasFocus: false }] });
		expect(nextResetStep(HOME, toast, { top: 0 }).kind).toBe('wait');
		expect(nextResetStep(HOME, fp([], { focus: null }), { top: 0 }).kind).toBe('relaunch');
	});

	it('최상위를 두 번 지나도 처음 화면이 아니면 다시 열기, 금지된 키는 누르지 않는다', () => {
		const other = fp(['x', 'y', 'z']);
		expect(nextResetStep(HOME, other, { top: 2 }, rules).kind).toBe('relaunch');
		expect(nextResetStep(HOME, other, { top: 0 }, { ...rules, forbidden: ['BACK'] }).kind).toBe('relaunch');
		const popup = fp(['a'], { layers: [{ key: 'p', hasFocus: true }] });
		expect(nextResetStep(HOME, popup, { top: 0 }, { ...rules, closePopupKey: 'OK' })).toMatchObject({
			kind: 'relaunch'
		});
	});
});

describe('addedItems', () => {
	it('처음보다 새로 생긴 요소만 (같은 이름은 개수로)', () => {
		const base = ['searchInput', 'chip', 'chip', 'card'];
		const now = ['searchInput', 'recent-search-a', 'chip', 'chip', 'chip', 'card'];
		expect(addedItems(base, now)).toEqual(['recent-search-a', 'chip']);
	});

	it('없어진 요소는 새로 생긴 것이 아니다', () => {
		expect(addedItems(['a', 'b'], ['a'])).toEqual([]);
	});
});
