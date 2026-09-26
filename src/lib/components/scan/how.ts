// What each part of the wiki is worked out from: the tooltip on its source mark (SourceMark).
// Keep these in step with the server code named in each comment.

import type { SectionId } from './toc.svelte';

export interface How {
	title: string;
	text: string;
}

export const HOW: Record<SectionId | 'lede' | 'takeaways', How> = {
	// scan/index.ts stats: deep scope parsed by cparse, the rest indexed; gitmine counts.
	lede: {
		title: 'What was read',
		text: 'C/C++ files in the deep scope are parsed for functions, calls and #includes. The rest of the repository is indexed by name and #include only. Commit and author counts come from git log.'
	},
	// SystemTakeaways: views.ts architecture (usedBy, reachIn, dependsOn), criticality, fences.
	takeaways: {
		title: 'How these lines are picked',
		text: 'Counted from #include lines that resolve across the scope boundary: which modules include this scope, which reach past its public header into internal ones, and which platform layers it depends on. The risk line counts high-criticality functions and the guards below.'
	},
	// views.ts readingOrder: hub header, then each component's most critical file.
	reading: {
		title: 'How the order is picked',
		text: 'First the header the scope #includes most. Then, for each component, the file with the highest criticality score, most critical component first. The functions named are that file’s top-scoring ones.'
	},
	// fences.ts: warning comments, reverts, fix/workaround commits, traced with git log -L.
	fences: {
		title: 'How guards are found',
		text: 'Lines with a hardware warning comment (errata, silicon, workaround, spurious…), a reverted change, or bug-fix and workaround commits are traced through their full history with git log -L. The verdict is what the pull request rules would give a change to them.'
	},
	// signals.ts scoreSymbols: signal weights, git signals, fan-in, outside references; rank levels.
	critical: {
		title: 'How functions are scored',
		text: 'Points for what a function contains (interrupt handlers, locking, register and volatile access, delays, watchdog and reset calls, warning comments), for fix, revert and workaround commits on its lines, for its callers, and for code outside the scope naming it. Top 10% are high, the next 25% medium.'
	},
	// views.ts assumptions: static signals isr, timing, timing_constant, watchdog, hw_register, hw_access.
	timing: {
		title: 'How these are found',
		text: 'Pattern matches on the code with comments and strings blanked out: interrupt handlers, delay and timer calls, timing constants (…_TIMEOUT, …_HZ, …_MS), watchdog calls, register helpers and volatile access. Each row links to its line.'
	},
	// views.ts interfaces: reference_index edges into the scope + external_interface signals.
	interfaces: {
		title: 'How these are found',
		text: 'The whole repository is indexed for #includes and names that point into this scope. A resolved #include counts as verified, a bare name match as inferred. Parameter tables, MAVLink messages and log writes are matched in the code.'
	},
	// views.ts unknowns: workaround comments without a rationale/revert commit + unresolved edges.
	questions: {
		title: 'Where these come from',
		text: 'Warning comments whose commit gives no hardware or timing reason, so the why is missing. Plus calls and #includes the scanner could not follow, like function pointers, callbacks and generated headers.'
	}
};

/** "Where to start" once the model has described its files. */
export const HOW_READING_AI: How = {
	title: 'How the order is picked',
	text: 'The order is counted, not written: the most #included header first, then the most critical file of each component. AI writes the one-line descriptions from each file’s first lines.'
};
