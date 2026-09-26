import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureCommit, inScope, languageOf, listTree, parseLsTree } from './acquire';

describe('stage 0 on a fixture repo', () => {
	let root: string;
	let origin: string;
	let head: string;

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), 'undefined-acquire-'));
		origin = join(root, 'origin');
		const git = (...args: string[]) =>
			execFileSync('git', args, { cwd: origin, encoding: 'utf8' }).trim();

		mkdirSync(join(origin, 'drivers/imu'), { recursive: true });
		execFileSync('git', ['init', '-q', '-b', 'main', origin]);
		writeFileSync(join(origin, 'drivers/imu/imu.c'), 'int imu_read(void) { return 0; }\n');
		writeFileSync(join(origin, 'drivers/imu/imu.h'), 'int imu_read(void);\n');
		writeFileSync(join(origin, 'README.md'), '# fixture\n');
		git('add', '.');
		git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
		head = git('rev-parse', 'HEAD');
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it('clones, then reuses the clone, and lists the tree at the commit', async () => {
		const dir = join(root, 'clones/fixture.git');
		await ensureCommit({ url: `file://${origin}`, dir, commitSha: head });
		await ensureCommit({ url: `file://${origin}`, dir, commitSha: head });

		const files = await listTree(dir, head);
		expect(files.map((f) => f.path).sort()).toEqual([
			'README.md',
			'drivers/imu/imu.c',
			'drivers/imu/imu.h'
		]);
	});

	it('fails for a commit the remote does not have', async () => {
		const dir = join(root, 'clones/fixture.git');
		await expect(
			ensureCommit({ url: `file://${origin}`, dir, commitSha: 'f'.repeat(40) })
		).rejects.toThrow();
	});
});

describe('parseLsTree', () => {
	it('keeps blobs, skips submodules and symlinks, handles tabs in paths', () => {
		const out = [
			'100644 blob aaa\tsrc/a.c',
			'160000 commit bbb\tmodules/lib',
			'120000 blob ccc\tlink',
			'100644 blob ddd\tweird\tname.h'
		].join('\0');
		expect(parseLsTree(out)).toEqual([
			{ path: 'src/a.c', blobSha: 'aaa' },
			{ path: 'weird\tname.h', blobSha: 'ddd' }
		]);
	});
});

describe('languageOf / inScope', () => {
	it('classifies embedded source files', () => {
		expect(languageOf('a/b.cpp')).toBe('cpp');
		expect(languageOf('a/b.h')).toBe('c-header');
		expect(languageOf('start.S')).toBe('asm');
		expect(languageOf('x/CMakeLists.txt')).toBe('cmake');
		expect(languageOf('.gitignore')).toBe('other');
	});

	it('matches whole path segments only', () => {
		expect(inScope('libraries/AP_Baro/x.cpp', 'libraries/AP_Baro')).toBe(true);
		expect(inScope('libraries/AP_Baro_Ext/x.cpp', 'libraries/AP_Baro')).toBe(false);
		expect(inScope('anything', '')).toBe(true);
	});
});
