import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Focusable, useApp } from '../AppContext';
import { SEARCH_CARDS, SEARCH_KEYWORDS, gradientOf, searchCards } from '../data';

interface SearchScreenProps {
	onBack: () => void;
}

/** 입력 가능한 최대 글자 수 (화면설계서 4.8: 공백 포함 255자) */
const MAX_QUERY = 255;
/** 결과가 없을 때 보여 주는 추천 키워드 수 (화면설계서 4.6: 최대 3개) */
const SUGGESTIONS = 3;
const ENTER_KEY_CODE = 13;
const ESCAPE_KEY_CODE = 27;

/**
 * 화면설계서 4.1(Search Field - 최초 진입 시) 와이어프레임 배치를 TV 좌표(÷0.625)로 옮긴 화면.
 * 검색한 적이 있으면 최근 검색어 줄이 맨 위에 생긴다(4.3) — 앞 단계가 남긴 상태가 화면을 바꾸는 예.
 * 가상 키보드(VKB)는 플랫폼 기능이라 그리지 않는다 — 검색창에서 OK를 누르면 입력란이 편집 상태가 되고
 * (TV에서는 VKB가 열림), 글자는 플랫폼 키보드나 입력 이벤트로 들어온다. Enter = 검색, Back = 편집 끝.
 * 검색하면 결과(4.5) 또는 결과 없음 + 추천 키워드(4.6)를 보여 준다. 앞뒤 공백은 지운다(4.8).
 */
/**
 * 카드 제목. 칸을 넘치면 말줄임하고, 카드에 포커스가 2초 머물면 흐르는 글자(Marquee)로 보여 준다 (화면설계서 4.2 ②·③ 형식).
 * 넘치는지는 그린 뒤 재서 정한다. marquee=false(D13)이면 말줄임만 한다
 */
function CardTitle({ text, marquee, testId }: { text: string; marquee: boolean; testId: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [overflowing, setOverflowing] = useState(false);
	useLayoutEffect(() => {
		const el = ref.current;
		if (el !== null) setOverflowing(el.scrollWidth > el.clientWidth + 1);
	}, [text]);
	return (
		<span ref={ref} className={`search-card-title${overflowing && marquee ? ' marquee' : ''}`} data-testid={testId}>
			{text}
		</span>
	);
}

export function SearchScreen({ onBack }: SearchScreenProps) {
	const { config, layout, focus, setBackHandler, recentSearches, addRecentSearch, saveRecent, setSaveRecent } =
		useApp();
	const { search } = layout;
	// 최근 검색어가 있으면 그 줄이 맨 위에 생기고 아래 섹션이 내려간다 (화면설계서 4.3).
	// 저장 Off면 기록은 두고 영역만 숨긴다 (4.4: Off → On이면 이전 기록을 다시 보여 줌). D17은 Off여도 보임
	const showRecent = recentSearches.length > 0 && (saveRecent || search.recentWhenOff);
	const shift = showRecent ? 162 : 0;
	const inputRef = useRef<HTMLInputElement>(null);
	const [editing, setEditing] = useState(false);
	const [query, setQuery] = useState('');
	const [submitted, setSubmitted] = useState<string | null>(null);
	const pendingFocus = useRef<string | null>(null);
	const results = submitted === null ? [] : searchCards(submitted);

	useEffect(() => {
		if (editing) inputRef.current?.focus();
	}, [editing]);

	useEffect(() => {
		const id = pendingFocus.current;
		if (id !== null) {
			pendingFocus.current = null;
			focus(id);
		}
	});

	const stopEditing = useCallback(() => {
		inputRef.current?.blur();
		setEditing(false);
		pendingFocus.current = 'search-field';
	}, []);

	const submit = useCallback(
		(raw: string) => {
			const q = raw.trim();
			inputRef.current?.blur();
			setEditing(false);
			setQuery(q);
			setSubmitted(q === '' ? null : q);
			if (q !== '') addRecentSearch(q);
			pendingFocus.current = q !== '' && searchCards(q).length > 0 ? 'search-result-1' : 'search-field';
		},
		[addRecentSearch]
	);

	// 결과를 보는 중의 Back은 검색 첫 화면으로 (이전 화면 = 4.2, Historical Back)
	useEffect(() => {
		setBackHandler(() => {
			if (submitted === null) return false;
			setSubmitted(null);
			setQuery('');
			pendingFocus.current = 'search-field';
			return true;
		});
		return () => setBackHandler(null);
	}, [submitted, setBackHandler]);

	const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
		if (!editing) return;
		// 편집 중 키는 입력란이 받는다 (방향키 포커스 이동·OK 선택으로 넘기지 않음 — TV에서는 VKB가 받음)
		event.stopPropagation();
		if (event.keyCode === ENTER_KEY_CODE) {
			event.preventDefault();
			submit(event.currentTarget.value);
		} else if (event.keyCode === config.backKeyCode || event.keyCode === ESCAPE_KEY_CODE) {
			event.preventDefault();
			stopEditing();
		}
	};

	return (
		<div className="screen search" data-testid="screen-search">
			<Focusable
				id="search-back"
				testId="search-back"
				className="search-back"
				style={{ left: 60, top: 46, width: 64, height: 64 }}
				onSelect={onBack}
			>
				<span aria-hidden="true">‹</span>
				<span className="visually-hidden">Back</span>
			</Focusable>
			<Focusable
				id="search-field"
				testId="search-field-box"
				className={editing ? 'search-field editing' : 'search-field'}
				style={{
					left: search.fieldLeft,
					top: search.fieldTop,
					width: search.fieldWidth,
					height: search.fieldHeight
				}}
				onSelect={() => setEditing(true)}
			>
				<span className="search-icon" aria-hidden="true">
					⌕
				</span>
				<input
					ref={inputRef}
					data-testid="search-field"
					style={{ textOverflow: search.inputOverflow }}
					placeholder={search.placeholder}
					readOnly={!editing}
					tabIndex={-1}
					maxLength={MAX_QUERY}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={onInputKeyDown}
				/>
			</Focusable>
			{/* 최근 검색어 저장 On/Off (화면설계서 4.4를 검색창 옆 버튼으로 줄임). D16은 OK를 눌러도 안 바뀜 */}
			<Focusable
				id="search-save"
				testId="search-save"
				className="search-save"
				style={{
					left: search.fieldLeft + search.fieldWidth + 24,
					top: search.fieldTop,
					width: 300,
					height: search.fieldHeight
				}}
				onSelect={() => {
					if (search.saveToggle) setSaveRecent(!saveRecent);
				}}
			>
				<span>Save history</span>
				<span
					role="switch"
					aria-checked={saveRecent}
					className={saveRecent ? 'search-switch on' : 'search-switch'}
				>
					{saveRecent ? 'On' : 'Off'}
				</span>
			</Focusable>

			{submitted === null && (
				<>
					{showRecent && (
						<>
							<h2 className="search-section-title" style={{ top: 178 }}>
								Recent Searches
							</h2>
							{recentSearches.map((query, i) => (
								<Focusable
									key={query}
									id={`search-recent-${i + 1}`}
									testId={`search-recent-${i + 1}`}
									className="search-recent"
									style={{ left: 210 + i * 333, top: 246, width: 320, height: 66 }}
									onSelect={() => submit(query)}
								>
									{query}
								</Focusable>
							))}
						</>
					)}
					<h2 className="search-section-title" style={{ top: 178 + shift }}>
						Recommended Keywords
					</h2>
					{SEARCH_KEYWORDS.map((keyword, i) => (
						<Focusable
							key={keyword}
							id={`search-chip-${i + 1}`}
							testId={`search-chip-${i + 1}`}
							className="search-chip"
							style={{ left: 210 + i * 333, top: 246 + shift, width: 320, height: 66 }}
							onSelect={() => submit(keyword)}
						>
							{keyword}
						</Focusable>
					))}

					<h2 className="search-section-title" style={{ top: 403 + shift }}>
						Travel Now
					</h2>
					{SEARCH_CARDS.map((card, i) => (
						<Focusable
							key={card.id}
							id={card.id}
							testId={card.id}
							className="search-card"
							style={{
								left: 210 + i * 400,
								top: 467 + shift,
								width: 388,
								height: 216,
								background: gradientOf(card.hue)
							}}
						>
							<CardTitle text={card.title} marquee={search.cardMarquee} testId={`${card.id}-title`} />
						</Focusable>
					))}
				</>
			)}

			{submitted !== null && results.length > 0 && (
				<>
					<h2 className="search-section-title" style={{ top: 178 }} data-testid="search-results-title">
						Results for “{submitted}” ({results.length})
					</h2>
					{results.map((card, i) => (
						<Focusable
							key={card.id}
							id={`search-result-${i + 1}`}
							testId={`search-result-${i + 1}`}
							className="search-card"
							style={{
								// 그리드(화면설계서 4.5). resultColumns 0(D15)은 한 줄 가로 목록
								left: 210 + (search.resultColumns > 0 ? i % search.resultColumns : i) * 400,
								top: 246 + (search.resultColumns > 0 ? Math.floor(i / search.resultColumns) : 0) * 236,
								width: 388,
								height: 216,
								background: gradientOf(card.hue)
							}}
						>
							<CardTitle
								text={card.title}
								marquee={search.cardMarquee}
								testId={`search-result-${i + 1}-title`}
							/>
						</Focusable>
					))}
				</>
			)}

			{submitted !== null && results.length === 0 && (
				<>
					<p className="search-message" style={{ top: 178 }} data-testid="search-no-result">
						No results for “{submitted}”
					</p>
					<h2 className="search-section-title" style={{ top: 260 }}>
						Recommended Keywords
					</h2>
					{SEARCH_KEYWORDS.slice(0, SUGGESTIONS).map((keyword, i) => (
						<Focusable
							key={keyword}
							id={`search-suggest-${i + 1}`}
							testId={`search-suggest-${i + 1}`}
							className="search-chip"
							style={{ left: 210 + i * 333, top: 328, width: 320, height: 66 }}
							onSelect={() => submit(keyword)}
						>
							{keyword}
						</Focusable>
					))}
				</>
			)}
		</div>
	);
}
