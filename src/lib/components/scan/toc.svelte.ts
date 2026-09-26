// Wiki sections: the sidebar lists them, the overview page renders them and reports which one is
// in view (scroll spy).

export const SECTIONS = [
	{ id: 'reading', label: 'Where to start' },
	{ id: 'fences', label: 'What not to break' },
	{ id: 'critical', label: 'Critical functions' },
	{ id: 'timing', label: 'Timing and hardware' },
	{ id: 'interfaces', label: 'External interfaces' },
	{ id: 'questions', label: 'Open questions' }
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** `empty`: sections the overview hides because it has nothing to show; the sidebar skips them too. */
export const toc = $state<{ active: SectionId | null; empty: SectionId[] }>({
	active: null,
	empty: []
});
