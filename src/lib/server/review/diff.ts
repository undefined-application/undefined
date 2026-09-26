// Unified diff (-U0) parsing, and the change-class check (plan §5 Tab 4: comment/whitespace/
// log-string-only diffs change no behaviour and may be SAFE regardless of completeness).

import type { ChangeClass, DiffFile, DiffLine } from '$lib/review';
import { blank } from '$lib/server/scan/cparse';
import { languageOf } from '$lib/server/scan/acquire';
import { SOURCE_LANGUAGES } from '$lib/server/scan/structure';

export interface Hunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	removed: string[];
	added: string[];
}

export interface FileDiff {
	/** `null` for added files. */
	oldPath: string | null;
	/** `null` for deleted files. */
	newPath: string | null;
	binary: boolean;
	hunks: Hunk[];
}

const unquote = (p: string) => (p.startsWith('"') ? JSON.parse(p) : p);

/** Parse `git diff -U0 --no-renames` output. */
export function parseUnifiedDiff(out: string): FileDiff[] {
	const files: FileDiff[] = [];
	let cur: FileDiff | null = null;
	let hunk: Hunk | null = null;
	for (const line of out.split('\n')) {
		if (line.startsWith('diff --git ')) {
			cur = { oldPath: null, newPath: null, binary: false, hunks: [] };
			files.push(cur);
			hunk = null;
		} else if (!cur) {
			continue;
		} else if (line.startsWith('--- ')) {
			const p = unquote(line.slice(4));
			cur.oldPath = p === '/dev/null' ? null : p.replace(/^a\//, '');
		} else if (line.startsWith('+++ ')) {
			const p = unquote(line.slice(4));
			cur.newPath = p === '/dev/null' ? null : p.replace(/^b\//, '');
		} else if (line.startsWith('Binary files ')) {
			cur.binary = true;
			const m = /^Binary files (.+?) and (.+?) differ$/.exec(line);
			if (m) {
				cur.oldPath = m[1] === '/dev/null' ? null : m[1].replace(/^a\//, '');
				cur.newPath = m[2] === '/dev/null' ? null : m[2].replace(/^b\//, '');
			}
		} else if (line.startsWith('@@')) {
			const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
			if (!m) continue;
			hunk = {
				oldStart: Number(m[1]),
				oldLines: m[2] === undefined ? 1 : Number(m[2]),
				newStart: Number(m[3]),
				newLines: m[4] === undefined ? 1 : Number(m[4]),
				removed: [],
				added: []
			};
			cur.hunks.push(hunk);
		} else if (hunk && line.startsWith('-')) {
			hunk.removed.push(line.slice(1));
		} else if (hunk && line.startsWith('+')) {
			hunk.added.push(line.slice(1));
		}
	}
	return files;
}

/**
 * Parse `git diff -U3` for display: rows with both line numbers, GitHub-style. Caps rows per file
 * and the number of files, so a review document stays small.
 */
export function parseDisplayDiff(
	out: string,
	limits: { files?: number; linesPerFile?: number } = {}
): DiffFile[] {
	const maxFiles = limits.files ?? 60;
	const maxLines = limits.linesPerFile ?? 600;
	const files: DiffFile[] = [];
	let cur: DiffFile | null = null;
	let rows = 0;
	let oldNo = 0;
	let newNo = 0;
	let oldPath: string | null = null;
	for (const line of out.split('\n')) {
		if (line.startsWith('diff --git ')) {
			if (files.length >= maxFiles) break;
			cur = {
				path: '',
				status: 'modified',
				binary: false,
				additions: 0,
				deletions: 0,
				hunks: [],
				truncated: false
			};
			files.push(cur);
			rows = 0;
			oldPath = null;
			const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
			if (m) cur.path = m[2];
		} else if (!cur) {
			continue;
		} else if (line.startsWith('--- ') && !cur.hunks.length) {
			const p = unquote(line.slice(4));
			oldPath = p === '/dev/null' ? null : p.replace(/^a\//, '');
		} else if (line.startsWith('+++ ') && !cur.hunks.length) {
			const p = unquote(line.slice(4));
			const newPath = p === '/dev/null' ? null : p.replace(/^b\//, '');
			cur.path = newPath ?? oldPath ?? cur.path;
			cur.status = !oldPath ? 'added' : !newPath ? 'deleted' : 'modified';
		} else if (line.startsWith('Binary files ')) {
			cur.binary = true;
			if (line.includes('/dev/null and')) cur.status = 'added';
			else if (line.endsWith('and /dev/null differ')) cur.status = 'deleted';
		} else if (line.startsWith('@@')) {
			const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
			if (!m) continue;
			oldNo = Number(m[1]);
			newNo = Number(m[2]);
			cur.hunks.push({ header: line, lines: [] });
		} else if (cur.hunks.length && /^[ +-]/.test(line)) {
			const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx';
			if (kind === 'add') cur.additions++;
			if (kind === 'del') cur.deletions++;
			const row: DiffLine = {
				kind,
				old: kind === 'add' ? null : oldNo,
				new: kind === 'del' ? null : newNo,
				text: line.slice(1)
			};
			if (kind !== 'add') oldNo++;
			if (kind !== 'del') newNo++;
			if (rows >= maxLines) {
				cur.truncated = true;
				continue;
			}
			cur.hunks.at(-1)!.lines.push(row);
			rows++;
		}
	}
	return files;
}

/** Calls whose string arguments are human-facing messages, not behaviour. */
const LOG_CALLS = new Set([
	'debug',
	'printf',
	'fprintf',
	'puts',
	'DEV_PRINTF',
	'GCS_SEND_TEXT',
	'send_text',
	'console_printf',
	'hal_printf',
	'snprintf',
	'panic',
	'AP_HAL::panic',
	'INTERNAL_ERROR',
	'LOG_INFO',
	'LOG_WARN',
	'LOG_ERROR',
	'LOG_DEBUG',
	'PX4_INFO',
	'PX4_WARN',
	'PX4_ERR',
	'PX4_DEBUG',
	'printk',
	'syslog'
]);

interface Literal {
	text: string;
	/** Name of the call whose arguments contain the literal, if any. */
	call: string | null;
}

/** String/char literals in order, each with the call it's an argument of. */
function literals(src: string, code: string): Literal[] {
	const out: Literal[] = [];
	for (let i = 0; i < code.length; i++) {
		const q = code[i];
		if (q !== '"' && q !== "'") continue;
		const close = code.indexOf(q, i + 1);
		if (close < 0) break;
		// Walk back to the unclosed `(` this literal sits in, then read the callee name.
		let depth = 0;
		let call: string | null = null;
		for (let k = i - 1; k >= 0; k--) {
			const c = code[k];
			if (c === ')') depth++;
			else if (c === '(') {
				if (depth === 0) {
					const m = /([A-Za-z_][\w:]*)\s*$/.exec(code.slice(Math.max(0, k - 80), k));
					call = m ? m[1].replace(/^.*(?:->|\.)/, '') : null;
					break;
				}
				depth--;
			} else if (c === ';' || c === '{' || c === '}') break;
		}
		out.push({ text: src.slice(i + 1, close), call });
		i = close;
	}
	return out;
}

const tokens = (code: string) => code.match(/[A-Za-z_]\w*|\d[\w.]*|\S/g) ?? [];

/**
 * Classify one file's change by comparing old and new text at the token level:
 * - `comment_whitespace`: identical once comments and whitespace are dropped;
 * - `log_string`: identical except string literals passed to log/print calls;
 * - `docs`: not source code (markdown, text);
 * - `code`: anything else, including added/removed source files and non-C sources.
 */
export function classifyChange(
	path: string,
	oldText: string | null,
	newText: string | null
): ChangeClass {
	const lang = languageOf(path);
	if (lang === 'markdown' || lang === 'text') return 'docs';
	if (!SOURCE_LANGUAGES.has(lang) || oldText === null || newText === null) return 'code';
	const a = blank(oldText);
	const b = blank(newText);
	const ta = tokens(a.code);
	const tb = tokens(b.code);
	if (ta.length !== tb.length || ta.some((t, i) => t !== tb[i])) return 'code';
	// Preprocessor lines are blanked from `code`; they can change behaviour too.
	const da = a.directives.map((d) => d.text.replace(/\s+/g, ' '));
	const db = b.directives.map((d) => d.text.replace(/\s+/g, ' '));
	if (da.length !== db.length || da.some((d, i) => d !== db[i])) return 'code';
	const la = literals(oldText, a.code);
	const lb = literals(newText, b.code);
	if (la.length !== lb.length) return 'code';
	let logOnly = false;
	for (let i = 0; i < la.length; i++) {
		if (la[i].text === lb[i].text) continue;
		if (!la[i].call || !LOG_CALLS.has(la[i].call!)) return 'code';
		logOnly = true;
	}
	return logOnly ? 'log_string' : 'comment_whitespace';
}
