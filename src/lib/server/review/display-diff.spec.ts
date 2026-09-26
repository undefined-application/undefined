import { describe, expect, it } from 'vitest';
import { parseDisplayDiff } from './diff';

const DIFF = `diff --git a/drv/imu.cpp b/drv/imu.cpp
index 1111111..2222222 100644
--- a/drv/imu.cpp
+++ b/drv/imu.cpp
@@ -10,5 +10,5 @@ void read_fifo()
 {
-    if (temp_changed) {
+    if (false) {
         reset_fifo();
--- not a header, a removed line starting with dashes
 }
diff --git a/docs/new.md b/docs/new.md
new file mode 100644
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1,2 @@
+# Title
+text
\\ No newline at end of file
diff --git a/old.c b/old.c
deleted file mode 100644
--- a/old.c
+++ /dev/null
@@ -1 +0,0 @@
-int x;
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;

describe('parseDisplayDiff', () => {
	const files = parseDisplayDiff(DIFF);

	it('reads each file with its status and counts', () => {
		expect(files.map((f) => [f.path, f.status, f.additions, f.deletions, f.binary])).toEqual([
			['drv/imu.cpp', 'modified', 1, 2, false],
			['docs/new.md', 'added', 2, 0, false],
			['old.c', 'deleted', 0, 1, false],
			['img.png', 'modified', 0, 0, true]
		]);
	});

	it('numbers context, removed and added rows on both sides', () => {
		const rows = files[0].hunks[0].lines;
		expect(files[0].hunks[0].header).toBe('@@ -10,5 +10,5 @@ void read_fifo()');
		expect(rows.map((r) => [r.kind, r.old, r.new])).toEqual([
			['ctx', 10, 10],
			['del', 11, null],
			['add', null, 11],
			['ctx', 12, 12],
			['del', 13, null],
			['ctx', 14, 13]
		]);
		// A removed line that starts with dashes is a row, not a file header.
		expect(rows[4].text).toBe('-- not a header, a removed line starting with dashes');
	});

	it('skips "no newline" markers and caps long files', () => {
		expect(files[1].hunks[0].lines.map((r) => r.text)).toEqual(['# Title', 'text']);
		const capped = parseDisplayDiff(DIFF, { linesPerFile: 3 });
		expect(capped[0].hunks[0].lines).toHaveLength(3);
		expect(capped[0].truncated).toBe(true);
		expect(capped[0].deletions).toBe(2);
		expect(parseDisplayDiff(DIFF, { files: 2 }).map((f) => f.path)).toEqual([
			'drv/imu.cpp',
			'docs/new.md'
		]);
	});
});
