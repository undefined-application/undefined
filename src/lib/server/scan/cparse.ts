// Stage 1 (light): a dependency-free C/C++ structure scanner. Syntax-level only, like
// tree-sitter would be: it finds function/class ranges, includes, macros and call sites,
// but can't resolve overloads, virtual dispatch or macro-generated code (plan §4.5.1).

export interface Comment {
	line: number;
	text: string;
}

export interface Directive {
	line: number;
	/** Full directive text, continuation lines joined. */
	text: string;
}

export interface Blanked {
	/** Source with comments, string/char literals and preprocessor lines replaced by spaces. */
	code: string;
	comments: Comment[];
	directives: Directive[];
	/** Offsets where each line starts (index 0 = line 1). */
	lineStarts: number[];
	lines: number;
}

export function lineOf(lineStarts: number[], offset: number): number {
	let lo = 0;
	let hi = lineStarts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (lineStarts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo + 1;
}

/**
 * Blank out comments, literals and preprocessor lines, keeping offsets and newlines intact.
 * `#else` / `#elif` branches are blanked too, so the braces of alternative code paths
 * (a common embedded idiom) don't unbalance the structure scan: the first branch wins.
 */
export function blank(src: string): Blanked {
	const out = src.split('');
	const comments: Comment[] = [];
	const directives: Directive[] = [];
	const lineStarts = [0];
	for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
	const line = (i: number) => lineOf(lineStarts, i);
	const wipe = (from: number, to: number) => {
		for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
	};

	// #if nesting: for each level, whether we're inside an #else/#elif branch being skipped.
	const skipping: boolean[] = [];
	const skipped = () => skipping.some(Boolean);

	let i = 0;
	let atLineStart = true;
	while (i < src.length) {
		const c = src[i];
		if (c === '\n') {
			atLineStart = true;
			i++;
			continue;
		}
		if (atLineStart && (c === ' ' || c === '\t')) {
			i++;
			continue;
		}
		if (atLineStart && c === '#') {
			// Preprocessor directive, with `\` continuations.
			let end = i;
			while (end < src.length) {
				const nl = src.indexOf('\n', end);
				const stop = nl < 0 ? src.length : nl;
				if (src[stop - 1] === '\\' || (src[stop - 1] === '\r' && src[stop - 2] === '\\')) {
					end = stop + 1;
					continue;
				}
				end = stop;
				break;
			}
			const text = src.slice(i, end).replace(/\\\r?\n/g, ' ');
			const keyword = /^#\s*(\w+)/.exec(text)?.[1] ?? '';
			if (keyword === 'if' || keyword === 'ifdef' || keyword === 'ifndef') skipping.push(false);
			else if (keyword === 'else' || keyword === 'elif') {
				if (skipping.length) skipping[skipping.length - 1] = true;
			} else if (keyword === 'endif') skipping.pop();
			if (!skipped() || keyword === 'endif' || keyword === 'else' || keyword === 'elif') {
				directives.push({ line: line(i), text: text.replace(/\/\/.*$|\/\*.*?\*\//g, '').trim() });
			}
			// Keep the directive's comments visible to comment signals.
			const lc = text.indexOf('//');
			if (lc >= 0) comments.push({ line: line(i), text: text.slice(lc + 2).trim() });
			wipe(i, end);
			i = end;
			continue;
		}
		atLineStart = false;
		if (skipped()) {
			// Inside a skipped #else branch: blank everything but newlines.
			const nl = src.indexOf('\n', i);
			const stop = nl < 0 ? src.length : nl;
			wipe(i, stop);
			i = stop;
			continue;
		}
		if (c === '/' && src[i + 1] === '/') {
			const nl = src.indexOf('\n', i);
			const stop = nl < 0 ? src.length : nl;
			comments.push({ line: line(i), text: src.slice(i + 2, stop).trim() });
			wipe(i, stop);
			i = stop;
			continue;
		}
		if (c === '/' && src[i + 1] === '*') {
			const close = src.indexOf('*/', i + 2);
			const stop = close < 0 ? src.length : close + 2;
			const startLine = line(i);
			src
				.slice(i + 2, stop - 2)
				.split('\n')
				.forEach((t, k) => {
					const text = t.replace(/^\s*\*\s?/, '').trim();
					if (text) comments.push({ line: startLine + k, text });
				});
			wipe(i, stop);
			i = stop;
			continue;
		}
		if (c === 'R' && src[i + 1] === '"') {
			// Raw string R"delim( ... )delim"
			const open = src.indexOf('(', i + 2);
			const delim = src.slice(i + 2, open);
			const close = src.indexOf(`)${delim}"`, open);
			const stop = close < 0 ? src.length : close + delim.length + 2;
			wipe(i + 1, stop);
			i = stop;
			continue;
		}
		if (c === '"' || c === "'") {
			let k = i + 1;
			while (k < src.length && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
			// Keep the quotes so `"..."` stays a token; blank the contents.
			wipe(i + 1, k);
			i = k + 1;
			continue;
		}
		i++;
	}
	return { code: out.join(''), comments, directives, lineStarts, lines: lineStarts.length };
}

export type SymbolKind = 'function' | 'class' | 'macro';

export interface CSymbol {
	/** Qualified name, e.g. `AP_InertialSensor_Invensense::_accumulate`. */
	name: string;
	/** Last `::` segment. */
	shortName: string;
	kind: SymbolKind;
	/** 1-based, inclusive. */
	start: number;
	end: number;
	/** Declaration header, whitespace collapsed. */
	signature: string;
	/** Enclosing class for methods (qualified or from the class block). */
	className: string | null;
}

export interface CallSite {
	/** Caller: index into `symbols`. */
	from: number;
	name: string;
	line: number;
	/** Called as `obj.name(` / `obj->name(`: the receiver's type is unknown to us. */
	member: boolean;
	/** Qualifier written at the call site (`Foo::bar(` → `Foo`). */
	qualifier: string | null;
}

export interface Include {
	line: number;
	path: string;
	system: boolean;
}

export interface Parsed {
	blanked: Blanked;
	symbols: CSymbol[];
	calls: CallSite[];
	/** Calls through function pointers / callbacks we can't follow: `(*fp)(`, `table[i](`. */
	indirectCalls: { from: number; line: number }[];
	includes: Include[];
	/** Unbalanced braces: the scan's structure is unreliable for this file. */
	unbalanced: boolean;
}

const NOT_CALLS = new Set([
	'if',
	'for',
	'while',
	'switch',
	'return',
	'sizeof',
	'catch',
	'do',
	'else',
	'decltype',
	'alignof',
	'alignas',
	'static_assert',
	'__attribute__',
	'defined',
	'new',
	'delete',
	'throw',
	'typeid',
	'static_cast',
	'dynamic_cast',
	'reinterpret_cast',
	'const_cast',
	'offsetof',
	'__builtin_expect',
	'case',
	'goto'
]);

const TYPE_HEAD =
	/(?:^|[\s;{}])(class|struct|union|enum|namespace)\b(?:\s+(?:class|struct))?\s*([A-Za-z_]\w*)?[^()]*$/;
const EXTERN_C = /\bextern\s*"\s*"\s*$/;
const FUNC_NAME = /((?:[A-Za-z_]\w*\s*::\s*)*~?[A-Za-z_]\w*|operator\s*[^\s(]+)\s*\(/g;

type Block =
	| { kind: 'function'; symbol: number }
	| { kind: 'type'; name: string | null; symbol: number | null }
	| { kind: 'scope' }
	| { kind: 'other' };

/** Find the function name in a declaration header, or null if it isn't a function header. */
function functionHeader(header: string): { name: string; at: number } | null {
	const h = header.replace(/^\s*(public|private|protected)\s*:/, '');
	// Initializers and lambdas assigned to something aren't function definitions.
	const firstParen = h.indexOf('(');
	if (firstParen < 0) return null;
	if (h.slice(0, firstParen).includes('=')) return null;
	FUNC_NAME.lastIndex = 0;
	for (let m = FUNC_NAME.exec(h); m; m = FUNC_NAME.exec(h)) {
		const name = m[1].replace(/\s+/g, '');
		const short = name.slice(name.lastIndexOf(':') + 1).replace(/^~/, '');
		if (NOT_CALLS.has(short) || short === '__attribute__') continue;
		// Macro-like wrappers around the whole header (e.g. `__RAMFUNC__ void f(`) are fine:
		// the first real identifier followed by `(` is the name.
		return { name, at: m.index + (header.length - h.length) };
	}
	return null;
}

export function parseC(src: string): Parsed {
	const blanked = blank(src);
	const { code, lineStarts } = blanked;
	const lineAt = (i: number) => lineOf(lineStarts, i);
	const symbols: CSymbol[] = [];
	const calls: CallSite[] = [];
	const indirectCalls: { from: number; line: number }[] = [];
	const stack: Block[] = [];
	let boundary = 0;
	let unbalanced = false;

	const currentFunction = () => {
		for (let k = stack.length - 1; k >= 0; k--) {
			const b = stack[k];
			if (b.kind === 'function') return b.symbol;
		}
		return -1;
	};
	const currentClass = () => {
		for (let k = stack.length - 1; k >= 0; k--) {
			const b = stack[k];
			if (b.kind === 'type' && b.name) return b.name;
		}
		return null;
	};

	for (let i = 0; i < code.length; i++) {
		const c = code[i];
		if (c === '{') {
			const header = code.slice(boundary, i);
			const inFunction = currentFunction() >= 0;
			let block: Block = { kind: 'other' };
			if (!inFunction) {
				const type = TYPE_HEAD.exec(header);
				// `extern "C" {` (literal contents are blanked, so it reads `extern " "`).
				if (EXTERN_C.test(header.trim())) {
					block = { kind: 'scope' };
				} else if (type && !header.includes('(')) {
					const kw = type[1];
					const name = type[2] ?? null;
					if (kw === 'namespace') block = { kind: 'scope' };
					else {
						const outer = currentClass();
						const full = name && outer ? `${outer}::${name}` : name;
						let symbol: number | null = null;
						if (full && kw !== 'enum') {
							const at = boundary + header.lastIndexOf(name!);
							symbol =
								symbols.push({
									name: full,
									shortName: name!,
									kind: 'class',
									start: lineAt(at),
									end: lineAt(at),
									signature: header.replace(/\s+/g, ' ').trim(),
									className: outer
								}) - 1;
						}
						block = { kind: 'type', name: full, symbol };
					}
				} else {
					const fn = functionHeader(header);
					if (fn) {
						const outer = currentClass();
						const qualified = fn.name.includes('::') || !outer ? fn.name : `${outer}::${fn.name}`;
						const cut = qualified.lastIndexOf('::');
						const symbol =
							symbols.push({
								name: qualified,
								shortName: qualified.slice(cut < 0 ? 0 : cut + 2),
								kind: 'function',
								start: lineAt(boundary + fn.at),
								end: lineAt(i),
								signature: header.replace(/\s+/g, ' ').trim(),
								className: cut < 0 ? null : qualified.slice(0, cut)
							}) - 1;
						block = { kind: 'function', symbol };
					}
				}
			}
			stack.push(block);
			boundary = i + 1;
		} else if (c === '}') {
			const block = stack.pop();
			if (!block) unbalanced = true;
			else if (block.kind === 'function') symbols[block.symbol].end = lineAt(i);
			else if (block.kind === 'type' && block.symbol !== null)
				symbols[block.symbol].end = lineAt(i);
			boundary = i + 1;
		} else if (c === ';') {
			boundary = i + 1;
		}
	}
	if (stack.length > 0) unbalanced = true;

	// Call sites inside function bodies.
	const bodies = symbols
		.map((s, idx) => ({ s, idx }))
		.filter(({ s }) => s.kind === 'function')
		.sort((a, b) => a.s.start - b.s.start || b.s.end - a.s.end);
	const CALL = /(->|\.|::)?\s*\b([A-Za-z_]\w*)\s*\(/g;
	for (const { s, idx } of bodies) {
		const from = lineStarts[s.start - 1];
		const to = s.end < lineStarts.length ? lineStarts[s.end] : code.length;
		const text = code.slice(from, to);
		// Skip the header itself: calls start after the body's `{`.
		const bodyStart = text.indexOf('{');
		CALL.lastIndex = bodyStart < 0 ? 0 : bodyStart;
		for (let m = CALL.exec(text); m; m = CALL.exec(text)) {
			const name = m[2];
			if (NOT_CALLS.has(name)) continue;
			// Innermost function owns the call (lambdas/local classes are rare in C/C++ drivers).
			const at = from + m.index;
			const q =
				m[1] === '::'
					? (/([A-Za-z_]\w*)\s*::\s*$/.exec(text.slice(0, m.index + 2))?.[1] ?? null)
					: null;
			calls.push({
				from: idx,
				name,
				line: lineAt(at),
				member: m[1] === '->' || m[1] === '.',
				qualifier: q
			});
		}
		const INDIRECT = /[)\]]\s*\(/g;
		INDIRECT.lastIndex = bodyStart < 0 ? 0 : bodyStart;
		for (let m = INDIRECT.exec(text); m; m = INDIRECT.exec(text)) {
			// `(*fp)(`, `tbl[i](` — but not casts like `(uint8_t)(x)` or `sizeof(x)(`.
			const before = text.slice(Math.max(0, m.index - 40), m.index + 1);
			if (/\(\s*\*\s*\w+\s*\)$|\w\s*\[[^\]]*\]$/.test(before)) {
				indirectCalls.push({ from: idx, line: lineAt(from + m.index) });
			}
		}
	}

	// Includes and macros from directives.
	const includes: Include[] = [];
	for (const d of blanked.directives) {
		const inc = /^#\s*include\s*([<"])([^>"]+)[>"]/.exec(d.text);
		if (inc) {
			includes.push({ line: d.line, path: inc[2].trim(), system: inc[1] === '<' });
			continue;
		}
		const def = /^#\s*define\s+([A-Za-z_]\w*)(\()?/.exec(d.text);
		if (def) {
			symbols.push({
				name: def[1],
				shortName: def[1],
				kind: 'macro',
				start: d.line,
				end: d.line,
				signature: d.text.slice(0, 200),
				className: null
			});
		}
	}

	return { blanked, symbols, calls, indirectCalls, includes, unbalanced };
}
