// Display helpers shared by pages. Numbers render in mono tabular figures at the call site.

const numberFormat = new Intl.NumberFormat('en');

export const num = (n: number | null | undefined) => (n == null ? '-' : numberFormat.format(n));

export const pct = (share: number) => {
	const p = share * 100;
	if (p === 0) return '0%';
	if (p < 1) return '<1%';
	return `${p < 10 ? p.toFixed(1).replace(/\.0$/, '') : Math.round(p)}%`;
};

export const shortSha = (sha: string, n = 7) => sha.slice(0, n);

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

const units: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 24 * 3600],
	['month', 30 * 24 * 3600],
	['week', 7 * 24 * 3600],
	['day', 24 * 3600],
	['hour', 3600],
	['minute', 60]
];
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

/** "3 hr. ago", "yesterday", "just now". */
export function ago(iso: string | null | undefined, now = Date.now()) {
	if (!iso) return '';
	const seconds = (Date.parse(iso) - now) / 1000;
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
	}
	return 'just now';
}

export const plural = (n: number, one: string, many = `${one}s`) =>
	`${num(n)} ${n === 1 ? one : many}`;

const monthFormat = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' });

/** "Nov 2016". */
export const month = (iso: string) => monthFormat.format(new Date(iso));

/** A commit subject without its `AP_InertialSensor:`-style component prefix. */
export const bareSubject = (subject: string) => subject.replace(/^[\w./-]+:\s*/, '');
