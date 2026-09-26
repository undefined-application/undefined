// Stage 3: embedded signals + criticality score (plan §4.3). Heuristic evidence only: a signal
// raises attention and is citable; it never proves something is safety-critical.

import type { Parsed } from './cparse';
import type { BlameRange, MinedCommit } from './gitmine';
import type { EdgeRow, SymbolRow } from './structure';

export type SignalKind =
	| 'isr'
	| 'concurrency'
	| 'hw_access'
	| 'hw_register'
	| 'bus_io'
	| 'timing'
	| 'timing_constant'
	| 'watchdog'
	| 'hw_recovery'
	| 'defensive'
	| 'external_interface'
	| 'platform_variant'
	| 'workaround_comment'
	| 'rationale_comment'
	| 'git_revert'
	| 'git_workaround'
	| 'git_bugfix';

export type SignalSource = 'static' | 'comment' | 'git';

export interface Signal {
	path: string;
	start: number;
	end: number;
	kind: SignalKind;
	source: SignalSource;
	/** The source line (trimmed), or the commit subject for git signals. */
	snippet: string;
	/** What matched: the pattern hit, or the commit SHA. */
	detail: string;
	weight: number;
}

interface Rule {
	kind: SignalKind;
	re: RegExp;
	weight: number;
}

/** Matched against code with comments and literals blanked. */
const CODE_RULES: Rule[] = [
	{
		kind: 'isr',
		weight: 3,
		re: /\b\w+_IRQHandler\b|\bISR\s*\(|__attribute__\s*\(\(\s*(interrupt|isr)\b|\bCH_IRQ_(PROLOGUE|EPILOGUE|HANDLER)\b|\birq_handler\b|FromISR\b/
	},
	{
		kind: 'concurrency',
		weight: 2,
		re: /\b(__disable_irq|__enable_irq|chSysLock\w*|chSysUnlock\w*|irqsave|irqrestore|taskENTER_CRITICAL|portENTER_CRITICAL|WITH_SEMAPHORE|HAL_Semaphore|take_blocking|__sync_\w+|__atomic_\w+|__DMB|__DSB|__ISB)\b|std::atomic|\b\w*sem\w*(\.|->)(take|give)\s*\(/
	},
	{
		kind: 'hw_access',
		weight: 2,
		re: /\bvolatile\b|\(\s*(volatile\s+)?\w+\s*\*\s*\)\s*0x[0-9A-Fa-f]{4,}/
	},
	{
		kind: 'hw_register',
		weight: 2,
		re: /\b(register_read|register_write|read_registers|write_register|modify_register|_register_read|_register_write|_register_modify|setup_checked_registers|set_checked_register)\s*\(|\b(MPUREG|REG|BIT|BITS|ICMREG|BMI\d*_REG)_\w+/
	},
	{
		kind: 'bus_io',
		weight: 1,
		re: /\b(transfer|transfer_fullduplex|set_chip_select|set_speed|set_read_flag|read_fifo|spi_\w+|i2c_\w+|can_\w+|uart_\w+)\s*\(/
	},
	{
		kind: 'timing',
		weight: 2,
		re: /\b(delay|delay_microseconds|delay_microseconds_boost|usleep|udelay|mdelay|px4_usleep|nanosleep|HAL_Delay|chThdSleep\w*|in_expected_delay|register_periodic_callback|adjust_periodic_callback|register_timer_process|ScheduleDelayed|ScheduleOnInterval|hrt_absolute_time)\s*\(/
	},
	{
		kind: 'timing',
		weight: 1,
		re: /\bAP_HAL::(micros|millis|micros64|millis64)\s*\(|\b(micros|millis|micros64|millis64)\s*\(\s*\)/
	},
	{ kind: 'watchdog', weight: 2, re: /\b\w*(watchdog|wdt|iwdg)\w*\s*\(/i },
	{ kind: 'hw_recovery', weight: 2, re: /\b\w*(reset|recover|reinit|restart)\w*\s*\(/i },
	{
		kind: 'defensive',
		weight: 1,
		re: /\b(retr(y|ies)|attempts?|tries|max_tries)\b|\b\w*(crc|checksum|sanity|_check_\w+|check_\w+|validate\w*|is_valid)\w*\s*\(/i
	},
	{
		kind: 'external_interface',
		weight: 2,
		re: /\bAP_GROUPINFO\w*\s*\(|\bAP_NESTEDGROUPINFO\s*\(|\bMAVLINK_MSG_ID_\w+|\bmavlink_msg_\w+|\bGCS_SEND_TEXT\b|\bgcs\(\)\.send_\w+|\bsend_text\s*\(|AP::logger\(\)\.Write\w*\s*\(|\bLOG_\w+_MSG\b/
	}
];

/** Matched against preprocessor directives. */
const DIRECTIVE_RULES: Rule[] = [
	{
		kind: 'platform_variant',
		weight: 1,
		re: /^#\s*(if|ifdef|ifndef|elif)\b.*\b(CONFIG_HAL_BOARD\w*|HAL_\w+|BOARD\w*|CHIP\w*|STM32\w*|__arm__|__linux__|_WIN32|SITL\w*|HAL_BUILD_AP_PERIPH|CONFIG_\w+)/
	},
	{
		kind: 'timing_constant',
		weight: 1,
		re: /^#\s*define\s+\w*(TIMEOUT|RATE|HZ|_US|_MS|PERIOD|INTERVAL|DELAY|DEADLINE)\w*\s+\(?\s*-?\d/i
	}
];

/** Matched against comment text. */
const COMMENT_RULES: Rule[] = [
	{
		kind: 'workaround_comment',
		weight: 3,
		re: /\b(errat(a|um)|silicon|work[- ]?arounds?|quirks?|hack|chip rev\w*|anomal\w*|glitch\w*|spurious|datasheet|undocumented|alignment error|corrupt\w*|hardware bug|bug in the (chip|sensor|hardware))\b/i
	},
	{
		kind: 'rationale_comment',
		weight: 1,
		re: /\b(do not|don't|must not|must|never|careful|important|XXX|FIXME|HACK)\b/
	}
];

/** Const declarations of timing constants in code (outside directives). */
const CODE_TIMING_CONST =
	/\b(const|constexpr)\s+[\w:]+\s+\w*(timeout|rate|_hz|_us|_ms|period|interval|delay)\w*\s*=\s*-?\d/i;

const clip = (s: string) => (s.length > 160 ? s.slice(0, 157) + '...' : s);

export function detectSignals(path: string, text: string, parsed: Parsed): Signal[] {
	const signals: Signal[] = [];
	const srcLines = text.split('\n');
	const codeLines = parsed.blanked.code.split('\n');
	const add = (line: number, rule: Rule, source: SignalSource, match: string) =>
		signals.push({
			path,
			start: line,
			end: line,
			kind: rule.kind,
			source,
			snippet: clip((srcLines[line - 1] ?? '').trim()),
			detail: match.trim().slice(0, 80),
			weight: rule.weight
		});

	// A function's own definition (`void X::_fifo_reset(`) is not a call to it. ISRs are the
	// exception: defining `EXTI0_IRQHandler` is exactly the signal.
	const definedAt = new Map<number, string>();
	for (const s of parsed.symbols) if (s.kind === 'function') definedAt.set(s.start, s.shortName);

	codeLines.forEach((code, i) => {
		if (!code.trim()) return;
		const seen = new Set<SignalKind>();
		const own = definedAt.get(i + 1);
		for (const rule of CODE_RULES) {
			if (seen.has(rule.kind)) continue;
			const m = rule.re.exec(code);
			if (m && own && rule.kind !== 'isr' && m[0].replace(/\s*\($/, '').endsWith(own)) continue;
			if (m) {
				seen.add(rule.kind);
				add(i + 1, rule, 'static', m[0]);
			}
		}
		const tc = CODE_TIMING_CONST.exec(code);
		if (tc)
			add(i + 1, { kind: 'timing_constant', weight: 1, re: CODE_TIMING_CONST }, 'static', tc[0]);
	});
	for (const d of parsed.blanked.directives) {
		for (const rule of DIRECTIVE_RULES) {
			const m = rule.re.exec(d.text);
			if (m) add(d.line, rule, 'static', m[0]);
		}
	}
	for (const c of parsed.blanked.comments) {
		for (const rule of COMMENT_RULES) {
			const m = rule.re.exec(c.text);
			if (m) {
				signals.push({
					path,
					start: c.line,
					end: c.line,
					kind: rule.kind,
					source: 'comment',
					snippet: clip(c.text),
					detail: m[0],
					weight: rule.weight
				});
				break;
			}
		}
	}
	return signals;
}

/**
 * Git risk signals: code last written by a revert, a workaround/HW-rationale commit, or a bug fix.
 * One signal per blame range (not per line), and only over lines with code on them.
 */
export function gitSignals(
	path: string,
	codeLines: string[],
	blame: BlameRange[],
	commits: Map<string, MinedCommit>
): Signal[] {
	const out: Signal[] = [];
	for (const r of blame) {
		if (r.path !== path) continue;
		const c = commits.get(r.sha);
		if (!c) continue;
		const hasCode = codeLines.slice(r.start - 1, r.end).some((l) => l.trim().length > 0);
		if (!hasCode) continue;
		const kind: SignalKind | null = c.revert
			? 'git_revert'
			: c.rationale
				? 'git_workaround'
				: c.bugfix
					? 'git_bugfix'
					: null;
		if (!kind) continue;
		out.push({
			path,
			start: r.start,
			end: r.end,
			kind,
			source: 'git',
			snippet: clip(c.subject),
			detail: r.sha,
			weight: kind === 'git_revert' ? 3 : kind === 'git_workaround' ? 2 : 1
		});
	}
	return out;
}

export interface Factor {
	factor: string;
	points: number;
	detail: string;
}

export interface Criticality {
	score: number;
	level: 'high' | 'medium' | 'low';
	factors: Factor[];
}

/** Per-kind cap so one noisy pattern can't dominate a function's score. */
const KIND_CAP = 3;

/**
 * Score every function: signals inside its range, git history of its lines, how many resolved
 * callers it has, and whether code outside the deep scope names it. The factors are the
 * explanation shown to the user.
 */
export function scoreSymbols(
	symbols: SymbolRow[],
	signals: Signal[],
	edges: EdgeRow[]
): Map<string, Criticality> {
	const byPath = new Map<string, Signal[]>();
	for (const s of signals) {
		const list = byPath.get(s.path);
		if (list) list.push(s);
		else byPath.set(s.path, [s]);
	}
	const fanIn = new Map<string, { resolved: number; ambiguous: number; outside: number }>();
	for (const e of edges) {
		if (e.kind === 'co_changes') continue;
		const f = fanIn.get(e.to) ?? { resolved: 0, ambiguous: 0, outside: 0 };
		if (e.method === 'reference_index') f.outside++;
		else if (e.resolution === 'resolved') f.resolved++;
		else if (e.resolution === 'ambiguous') f.ambiguous++;
		fanIn.set(e.to, f);
	}

	const scores = new Map<string, Criticality>();
	for (const sym of symbols) {
		if (sym.kind !== 'function') continue;
		const factors: Factor[] = [];
		const inside = (byPath.get(sym.path) ?? []).filter(
			(s) => s.start <= sym.end && s.end >= sym.start
		);
		const byKind = new Map<SignalKind, Signal[]>();
		for (const s of inside) {
			const list = byKind.get(s.kind);
			if (list) list.push(s);
			else byKind.set(s.kind, [s]);
		}
		for (const [kind, list] of byKind) {
			const counted = list.slice(0, KIND_CAP);
			const points = counted.reduce((n, s) => n + s.weight, 0);
			const where = list
				.slice(0, 3)
				.map((s) => `L${s.start}`)
				.join(', ');
			factors.push({
				factor: kind,
				points,
				detail: `${list.length}× (${where}${list.length > 3 ? ', …' : ''})`
			});
		}
		const f = fanIn.get(sym.id);
		if (f && (f.resolved || f.ambiguous)) {
			const points = Math.round(Math.log2(1 + f.resolved + f.ambiguous / 2) * 10) / 10;
			factors.push({
				factor: 'fan_in',
				points,
				detail: `${f.resolved} resolved, ${f.ambiguous} ambiguous callers`
			});
		}
		if (f?.outside) {
			factors.push({
				factor: 'external_references',
				points: 2,
				detail: `named from ${f.outside} file(s) outside the deep scope`
			});
		}
		const score = Math.round(factors.reduce((n, x) => n + x.points, 0) * 10) / 10;
		scores.set(sym.id, {
			score,
			level: 'low',
			factors: factors.sort((a, b) => b.points - a.points)
		});
	}

	// Levels by rank: top 10% high, next 25% medium (among scored functions).
	const ranked = [...scores.values()].filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
	ranked.forEach((c, i) => {
		c.level =
			i < Math.ceil(ranked.length * 0.1)
				? 'high'
				: i < Math.ceil(ranked.length * 0.35)
					? 'medium'
					: 'low';
	});
	return scores;
}
