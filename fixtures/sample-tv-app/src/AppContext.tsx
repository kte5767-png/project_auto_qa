import { createContext, useContext, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { SampleConfig } from './config';
import { NAV_ATTR } from './focus/engine';
import type { Layout } from './layout';

export interface AppContextValue {
	config: SampleConfig;
	layout: Layout;
	focusedId: string | null;
	registerSelect: (id: string, handler: () => void) => () => void;
	/** 포커스를 옮긴다 (화면 안 상태가 바뀔 때, 예: 검색 결과) */
	focus: (id: string) => boolean;
	/** Back 키를 화면이 먼저 받는다. 처리했으면 true (예: 검색 결과 → 검색 첫 화면) */
	setBackHandler: (handler: (() => boolean) | null) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
	const value = useContext(AppContext);
	if (value === null) throw new Error('AppContext가 없습니다.');
	return value;
}

interface FocusableProps {
	id: string;
	testId: string;
	className?: string;
	style?: CSSProperties;
	/** true면 포커스를 받을 수 없다 (D07 도달 불가 결함에 사용) */
	disabled?: boolean;
	onSelect?: () => void;
	children?: ReactNode;
}

/**
 * 리모컨으로 포커스를 받을 수 있는 요소.
 * - spotlight 방식: `.spottable` + `data-spotlight-id` + 실제 DOM 포커스 (Enact와 같은 마크업)
 * - class 방식: 포커스 시 `focused` 클래스만 붙음 (DOM 포커스 없음)
 */
export function Focusable({ id, testId, className, style, disabled = false, onSelect, children }: FocusableProps) {
	const { config, focusedId, registerSelect } = useApp();

	useEffect(() => {
		if (disabled || onSelect === undefined) return undefined;
		return registerSelect(id, onSelect);
	}, [id, disabled, onSelect, registerSelect]);

	const spotlight = config.focusMode === 'spotlight';
	const classes = ['nav-item', className];
	if (!disabled && spotlight) classes.push('spottable');
	if (!disabled && !spotlight && focusedId === id) classes.push('focused');

	const navProps: Record<string, string | number> = {};
	if (!disabled) {
		navProps[NAV_ATTR] = id;
		if (spotlight) {
			navProps['tabIndex'] = -1;
			navProps['data-spotlight-id'] = id;
		}
	}

	return (
		<div className={classes.filter(Boolean).join(' ')} style={style} data-testid={testId} {...navProps}>
			{children}
		</div>
	);
}
