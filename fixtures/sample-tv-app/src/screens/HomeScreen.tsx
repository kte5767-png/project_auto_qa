import { Focusable, useApp } from '../AppContext';
import { Gnb } from '../components/Gnb';
import { PROMO, THUMBNAILS, THUMBNAIL_SHELF_TITLE, TOP10, TOP10_SHELF_TITLE, gradientOf } from '../data';
import type { HomeShelf, HomeView } from '../homeView';
import { thumbnailLefts, thumbnailWidths, top10GroupLeft } from '../layout';

interface HomeScreenProps {
	view: HomeView;
	onOpenDetail: (itemId: string, originId: string) => void;
	onGnbSelect: (id: string) => void;
}

export function HomeScreen({ view, onOpenDetail, onGnbSelect }: HomeScreenProps) {
	const { config, layout } = useApp();
	const { content, shelfTitle, shelfTops, thumbnail, top10, promo, colors } = layout;
	const shelfTopFor: Record<HomeShelf, number> = {
		thumbnail: content.firstShelfTop - shelfTops.thumbnail,
		top10: content.focusedShelfTop - shelfTops.top10,
		promo: content.focusedShelfTop - shelfTops.promo
	};
	const offsetY = shelfTopFor[view.shelf];
	const rowTop = shelfTitle.lineHeight + shelfTitle.gap;
	const titleStyle = {
		fontSize: shelfTitle.fontSize,
		lineHeight: `${shelfTitle.lineHeight}px`,
		fontWeight: shelfTitle.fontWeight,
		height: shelfTitle.lineHeight
	};
	const widths = thumbnailWidths(layout);
	const lefts = thumbnailLefts(layout);

	return (
		<div className="screen" data-testid="screen-home">
			<div className="home-content" style={{ transform: `translateY(${offsetY}px)` }}>
				<section className="shelf" style={{ top: shelfTops.thumbnail, left: content.left }}>
					<h2 className="shelf-title" data-testid="thumbnail-title" style={titleStyle}>
						{THUMBNAIL_SHELF_TITLE}
					</h2>
					<div className="row" style={{ top: rowTop, transform: `translateX(${view.thumbnailOffset}px)` }}>
						{THUMBNAILS.map((item, i) => (
							<Focusable
								key={item.id}
								id={item.id}
								testId={item.id}
								className={`thumb-card${item.kind === 'ad' ? ' ad' : ''}`}
								style={{
									left: lefts[i],
									width: widths[i],
									height: thumbnail.cardHeight,
									borderRadius: thumbnail.radius,
									background: gradientOf(item.hue)
								}}
								onSelect={() => onOpenDetail(item.id, item.id)}
							>
								{item.kind === 'ad' ? (
									<div className="ad-body">
										<span className="ad-badge">AD</span>
										<div className="ad-title">{item.title}</div>
										<div className="ad-subtitle">{item.subtitle}</div>
									</div>
								) : (
									<div
										className="thumb-title"
										style={{
											fontSize: thumbnail.titleFontSize,
											lineHeight: `${thumbnail.titleLineHeight}px`
										}}
									>
										{item.title}
									</div>
								)}
							</Focusable>
						))}
					</div>
				</section>

				<section className="shelf" style={{ top: shelfTops.top10, left: content.left }}>
					<h2 className="shelf-title" data-testid="top10-title" style={titleStyle}>
						{TOP10_SHELF_TITLE}
					</h2>
					<div
						className={`row${top10.showFocusBorder ? '' : ' no-focus-border'}`}
						data-testid="top10-row"
						style={{ top: rowTop, transform: `translateX(${view.top10Offset}px)` }}
					>
						{TOP10.map((item, i) => {
							const groupLeft = top10GroupLeft(layout, i);
							const n = i + 1;
							return (
								<div key={item.id} className="top10-group" style={{ left: groupLeft }}>
									<div
										className="top10-rank"
										style={{
											width: top10.rankWidth,
											fontSize: top10.rankFontSize,
											lineHeight: `${top10.imageHeight}px`
										}}
									>
										{n}
									</div>
									<Focusable
										id={item.id}
										testId={item.id}
										className="top10-card"
										disabled={n === 7 && config.defects.has('D07')}
										style={{
											left: top10.rankWidth + top10.rankGap,
											width: top10.cardWidth,
											height: top10.imageHeight + top10.titleGap + top10.titleLineHeight
										}}
										onSelect={() => onOpenDetail(item.id, item.id)}
									>
										<div
											className="top10-image"
											data-testid={`${item.id}-image`}
											style={{
												top: n === 3 ? top10.item3ImageOffsetY : 0,
												height: top10.imageHeight,
												borderRadius: top10.radius,
												background: gradientOf(item.hue)
											}}
										/>
										<div
											className="top10-card-title"
											style={{
												top: top10.imageHeight + top10.titleGap,
												fontSize: top10.titleFontSize,
												lineHeight: `${top10.titleLineHeight}px`
											}}
										>
											{item.title}
										</div>
									</Focusable>
								</div>
							);
						})}
					</div>
				</section>

				<section className="shelf" style={{ top: shelfTops.promo, left: content.left }}>
					<div
						className="promo"
						data-testid="promo-card"
						style={{ width: promo.width, height: promo.height, borderRadius: promo.radius }}
					>
						<div className="promo-text" style={{ left: promo.paddingLeft, top: promo.paddingTop }}>
							<div
								className="promo-title"
								data-testid="promo-title"
								style={{
									width: promo.textWidth,
									fontSize: promo.titleFontSize,
									lineHeight: `${promo.titleLineHeight}px`
								}}
							>
								{PROMO.title}
							</div>
							<div
								className="promo-description"
								data-testid="promo-description"
								style={{
									width: promo.descriptionWidth,
									fontSize: promo.descriptionFontSize,
									lineHeight: `${promo.descriptionLineHeight}px`,
									WebkitLineClamp: promo.descriptionMaxLines,
									maxHeight: promo.descriptionLineHeight * promo.descriptionMaxLines
								}}
							>
								{PROMO.description}
							</div>
						</div>
						<Focusable
							id="promo-button"
							testId="promo-button"
							className="promo-button"
							style={{
								left: promo.paddingLeft,
								top: promo.paddingTop + promo.buttonTop,
								width: promo.buttonWidth,
								height: promo.buttonHeight,
								background: colors.promoButtonBackground,
								color: colors.promoButtonText
							}}
							onSelect={() => onOpenDetail('promo', 'promo-button')}
						>
							{PROMO.button}
						</Focusable>
					</div>
				</section>
			</div>
			<Gnb selectedId="gnb-home" onSelect={onGnbSelect} />
		</div>
	);
}
