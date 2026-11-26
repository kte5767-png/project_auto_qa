import { parse } from 'acorn';
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_SCRIPT_ECMA_VERSION } from './pageScript';
import { textChangeScript, textFieldScript, textNotApplied } from './text';
import type { TextFieldState } from './text';

/** 페이지 스크립트가 쓰는 만큼만 흉내 낸 입력란 */
class FakeInput {
	readonly calls: string[] = [];
	readOnly = false;
	disabled = false;
	isContentEditable = false;
	constructor(
		readonly tagName: string,
		public value: string,
		private readonly type: string | null = null
	) {}
	getAttribute(name: string): string | null {
		return name === 'type' ? this.type : null;
	}
	select(): void {
		this.calls.push('select');
	}
	setSelectionRange(start: number, end: number): void {
		this.calls.push(`range ${start}-${end}`);
	}
}

const g = globalThis as unknown as { document?: unknown };
const body = {};
const commands: string[] = [];

function focus(el: unknown): void {
	g.document = {
		activeElement: el,
		body,
		documentElement: {},
		execCommand: (name: string) => {
			commands.push(name);
			if (el instanceof FakeInput) el.value = '';
			return true;
		}
	};
}

const run = <T>(script: string): T => new Function(`return ${script}`)() as T;

afterEach(() => {
	delete g.document;
	commands.length = 0;
});

describe('textFieldScript', () => {
	it('구형 TV 엔진(ES2017)에서 파싱된다', () => {
		for (const script of [textFieldScript('clear'), textChangeScript('a', 100)]) {
			expect(() => parse(script, { ecmaVersion: PAGE_SCRIPT_ECMA_VERSION })).not.toThrow();
		}
	});

	it('포커스된 입력란의 값을 읽는다', () => {
		focus(new FakeInput('INPUT', 'bali', 'search'));
		expect(run<TextFieldState>(textFieldScript())).toEqual({ editable: true, tag: 'input', value: 'bali' });
	});

	it('읽기 전용·비활성·글자를 받지 않는 종류는 입력란이 아니다', () => {
		const readOnly = new FakeInput('INPUT', '', 'text');
		readOnly.readOnly = true;
		focus(readOnly);
		expect(run<TextFieldState>(textFieldScript()).editable).toBe(false);
		focus(new FakeInput('INPUT', '', 'checkbox'));
		expect(run<TextFieldState>(textFieldScript()).editable).toBe(false);
		focus(new FakeInput('DIV', ''));
		expect(run<TextFieldState>(textFieldScript())).toEqual({ editable: false, tag: 'div', value: '' });
	});

	it('포커스가 없으면(body) 태그가 비어 있다', () => {
		focus(body);
		expect(run<TextFieldState>(textFieldScript())).toEqual({ editable: false, tag: '', value: '' });
	});

	it('select는 전체 선택, end는 커서를 끝으로, clear는 편집 명령으로 지운다', () => {
		const input = new FakeInput('INPUT', 'abc', null);
		focus(input);
		run(textFieldScript('select'));
		run(textFieldScript('end'));
		expect(input.calls).toEqual(['select', 'range 3-3']);
		expect(run<TextFieldState>(textFieldScript('clear')).value).toBe('');
		expect(commands).toEqual(['delete']);
	});

	it('빈 입력란은 지우지 않는다 (입력 이벤트를 만들지 않음)', () => {
		focus(new FakeInput('TEXTAREA', ''));
		run(textFieldScript('clear'));
		expect(commands).toEqual([]);
	});
});

describe('textChangeScript', () => {
	it('값이 바뀌면 바로 끝난다', async () => {
		const input = new FakeInput('INPUT', 'a', 'text');
		focus(input);
		setTimeout(() => {
			input.value = 'ab';
		}, 20);
		const started = Date.now();
		const state = await run<Promise<TextFieldState & { changed: boolean }>>(textChangeScript('a', 2000, 5));
		expect(state).toMatchObject({ value: 'ab', changed: true });
		expect(Date.now() - started).toBeLessThan(1000);
	});

	it('바뀌지 않으면 최대 시간 뒤 changed=false', async () => {
		focus(new FakeInput('INPUT', 'a', 'text'));
		const state = await run<Promise<{ changed: boolean }>>(textChangeScript('a', 40, 5));
		expect(state.changed).toBe(false);
	});
});

describe('textNotApplied', () => {
	it('값이 바뀌었으면 반영된 것이다', () => {
		expect(textNotApplied('a', { changed: true }, 'b', false)).toBe(false);
	});

	it('덧붙일 글자가 있는데 그대로면 반영되지 않은 것이다', () => {
		expect(textNotApplied('a', { changed: false }, 'b', false)).toBe(true);
		expect(textNotApplied('a', { changed: false }, '', false)).toBe(false);
	});

	it('같은 글자로 바꿔 쓰면 값이 그대로여도 반영된 것이다', () => {
		expect(textNotApplied('bali', { changed: false }, 'bali', true)).toBe(false);
		expect(textNotApplied('bali', { changed: false }, 'tokyo', true)).toBe(true);
	});
});
