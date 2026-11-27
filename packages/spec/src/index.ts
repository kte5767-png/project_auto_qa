export type {
	Callout,
	CalloutDescription,
	CalloutTarget,
	SpecKey,
	SpecScreen,
	TargetMethod,
	VersionEntry
} from './types';
export { compareVersions, lines, normalizeLabel, parseDescription, parseScreenTitle, parseVersions } from './describe';
export type { SpecOptions } from './extract';
export { DEFAULT_SPEC_OPTIONS, extractSpecScreen, findMarkers, findMockup } from './extract';
export type { MergedCallout, MergedSpecScreen, PagePart } from './merge';
export { mergeSpecScreens, pagePart } from './merge';
export type { CalloutLink, FramePair, LinkOptions, SpecGuiLink, TextDiff } from './link';
export {
	DEFAULT_LINK_OPTIONS,
	frameTitle,
	linkCallout,
	linkSpecToGui,
	meaningful,
	mockupTexts,
	rankGuiFrames,
	textSimilarity
} from './link';
