import { Focusable, useApp } from '../AppContext';
import { SEARCH_CARDS, SEARCH_KEYWORDS, gradientOf } from '../data';

interface SearchScreenProps {
	onBack: () => void;
}

/**
 * 화면설계서 4.1(Search Field - 최초 진입 시) 와이어프레임 배치를 TV 좌표(÷0.625)로 옮긴 화면.
 * 가상 키보드(VKB)는 플랫폼 기능이라 그리지 않는다.
 */
export function SearchScreen({ onBack }: SearchScreenProps) {
	const { layout } = useApp();
	const { search } = layout;

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
				className="search-field"
				style={{
					left: search.fieldLeft,
					top: search.fieldTop,
					width: search.fieldWidth,
					height: search.fieldHeight
				}}
			>
				<span className="search-icon" aria-hidden="true">
					⌕
				</span>
				<input data-testid="search-field" placeholder={search.placeholder} readOnly tabIndex={-1} />
			</Focusable>

			<h2 className="search-section-title" style={{ top: 178 }}>
				Recommended Keywords
			</h2>
			{SEARCH_KEYWORDS.map((keyword, i) => (
				<Focusable
					key={keyword}
					id={`search-chip-${i + 1}`}
					testId={`search-chip-${i + 1}`}
					className="search-chip"
					style={{ left: 210 + i * 333, top: 246, width: 320, height: 66 }}
				>
					{keyword}
				</Focusable>
			))}

			<h2 className="search-section-title" style={{ top: 403 }}>
				Travel Now
			</h2>
			{SEARCH_CARDS.map((card, i) => (
				<Focusable
					key={card.id}
					id={card.id}
					testId={card.id}
					className="search-card"
					style={{ left: 210 + i * 400, top: 467, width: 388, height: 216, background: gradientOf(card.hue) }}
				>
					<span className="search-card-title">{card.title}</span>
				</Focusable>
			))}
		</div>
	);
}
