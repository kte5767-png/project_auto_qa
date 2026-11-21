import { Focusable } from '../AppContext';
import { PROMO, findItem, gradientOf } from '../data';

interface DetailScreenProps {
	itemId: string;
}

export function DetailScreen({ itemId }: DetailScreenProps) {
	const item = findItem(itemId);
	const title = item?.title ?? PROMO.title;
	const hue = item?.hue ?? 30;

	return (
		<div className="screen detail" data-testid="screen-detail" style={{ background: gradientOf(hue) }}>
			<div className="detail-shade" />
			<h1 className="detail-title" data-testid="detail-title">
				{title}
			</h1>
			<p className="detail-description">
				Plan your visit, check the best season and save it to My Luggage to see it again later.
			</p>
			<Focusable
				id="detail-play"
				testId="detail-play"
				className="detail-button"
				style={{ left: 180, width: 240 }}
			>
				Play
			</Focusable>
			<Focusable id="detail-add" testId="detail-add" className="detail-button" style={{ left: 444, width: 360 }}>
				Add to My Luggage
			</Focusable>
		</div>
	);
}
