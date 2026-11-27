import { STATUS_LABEL } from './api';
import type { StepStatus } from './api';

export function Chip({ status }: { status: StepStatus | 'waiting' | 'running' }) {
	return <span className={`chip ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function DistBar({ c, total }: { c: Record<StepStatus, number>; total: number }) {
	const order: StepStatus[] = ['pass', 'fail', 'needs-review', 'not-run'];
	return (
		<div className="bar">
			{order.map((k) => (
				<span key={k} className={`seg-${k}`} style={{ width: `${total === 0 ? 0 : (c[k] / total) * 100}%` }} />
			))}
		</div>
	);
}

/** 판넬의 오른쪽 위 장식 (호·사선 띠) */
export function Deco() {
	return (
		<svg className="deco" viewBox="0 0 420 160" aria-hidden="true">
			<circle cx="330" cy="-40" r="150" fill="none" stroke="#0B2559" strokeWidth="1.2" opacity="0.5" />
			<circle cx="235" cy="70" r="5" fill="#0B2559" />
			<path d="M190 112 L420 74 L420 92 L170 132 Z" fill="#1E4C8F" opacity="0.9" />
			<path d="M120 124 L250 102 L240 116 L110 138 Z" fill="#DCE6F3" />
			<path d="M330 40 L420 26 L420 38 L320 54 Z" fill="#DCE6F3" />
		</svg>
	);
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
	return (
		<h2 className="section-title">
			{children}
			<span className="rule" />
			{aside !== undefined && <span className="aside">{aside}</span>}
		</h2>
	);
}
