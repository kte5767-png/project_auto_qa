import { Focusable, useApp } from '../AppContext';

export interface GnbItem {
	id: string;
	label: string;
	icon: string;
}

export const GNB_ITEMS: GnbItem[] = [
	{ id: 'gnb-home', label: 'Home', icon: '⌂' },
	{ id: 'gnb-search', label: 'Search', icon: '⌕' },
	{ id: 'gnb-luggage', label: 'My Luggage', icon: '▣' },
	{ id: 'gnb-settings', label: 'Settings', icon: '⚙' }
];

interface GnbProps {
	selectedId: string;
	onSelect: (id: string) => void;
}

export function Gnb({ selectedId, onSelect }: GnbProps) {
	const { layout } = useApp();
	const { width, itemSize, logoCenterY, itemCentersY } = layout.gnb;
	const left = (width - itemSize) / 2;

	return (
		<nav className="gnb" data-testid="gnb" style={{ width, height: layout.viewport.height }}>
			<div
				className="gnb-logo"
				style={{ left, top: logoCenterY - itemSize / 2, width: itemSize, height: itemSize }}
			>
				T+
			</div>
			{GNB_ITEMS.map((item, i) => (
				<Focusable
					key={item.id}
					id={item.id}
					testId={item.id}
					className={`gnb-item${item.id === selectedId ? ' selected' : ''}`}
					style={{ left, top: (itemCentersY[i] ?? 0) - itemSize / 2, width: itemSize, height: itemSize }}
					onSelect={() => onSelect(item.id)}
				>
					<span aria-hidden="true">{item.icon}</span>
					<span className="visually-hidden">{item.label}</span>
				</Focusable>
			))}
		</nav>
	);
}
