import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureCommit, languageOf, listTree } from './acquire';
import { classifyMessage, mineHistory, parseBlameIncremental, type MinedHistory } from './gitmine';

describe('classifyMessage', () => {
	it('detects reverts and the reverted commit', () => {
		const c = classifyMessage(
			'Revert "AP_InertialSensor: disable temperature based fifo check"\n\nThis reverts commit 05f8e3c18d164ffe3766835786e67aae3a235b61.\n\nthis leads to bad IMU data'
		);
		expect(c.subject).toBe('Revert "AP_InertialSensor: disable temperature based fifo check"');
		expect(c.revert).toBe(true);
		expect(c.revertOf).toBe('05f8e3c18d164ffe3766835786e67aae3a235b61');
	});

	it('flags hardware rationale without a fix keyword (the demo STOP commit)', () => {
		const c = classifyMessage(
			'AP_InertialSensor: catch FIFO alignment errors using temperature reading\n\nTwo cases of what seems to be FIFO alignment errors have been seen on a Pixracer-beta board'
		);
		expect(c).toMatchObject({ bugfix: false, revert: false, rationale: true, refs: [] });
	});

	it('flags bug fixes and collects #refs', () => {
		const c = classifyMessage('AP_Baro: fixed WHOAMI read (#17054)\n\nsee #12 and #12');
		expect(c).toMatchObject({ bugfix: true, revert: false, refs: [17054, 12] });
	});

	it('leaves plain feature commits unflagged', () => {
		expect(classifyMessage('AP_InertialSensor: add ICM45686 driver')).toMatchObject({
			bugfix: false,
			revert: false,
			rationale: false
		});
	});
});

describe('parseBlameIncremental', () => {
	it('reads ranges and the original path', () => {
		const a = 'a'.repeat(40);
		const b = 'b'.repeat(40);
		const out = [
			`${b} 10 3 2`,
			'author B',
			'summary later',
			'filename new.c',
			`${a} 1 1 2`,
			'author A',
			'filename old.c',
			`${a} 5 5 1`,
			'filename old.c',
			''
		].join('\n');
		expect(parseBlameIncremental(out, 'new.c')).toEqual([
			{ path: 'new.c', start: 1, end: 2, sha: a, origPath: 'old.c', origStart: 1 },
			{ path: 'new.c', start: 3, end: 4, sha: b, origPath: 'new.c', origStart: 10 },
			{ path: 'new.c', start: 5, end: 5, sha: a, origPath: 'old.c', origStart: 5 }
		]);
	});
});

describe('mineHistory on a blobless fixture clone', () => {
	let root: string;
	let origin: string;
	const shas: Record<string, string> = {};
	let head: string;
	let mined: MinedHistory;

	beforeAll(async () => {
		root = mkdtempSync(join(tmpdir(), 'undefined-gitmine-'));
		origin = join(root, 'origin');
		const git = (...args: string[]) =>
			execFileSync('git', args, { cwd: origin, encoding: 'utf8' }).trim();
		let day = 0;
		const commit = (name: string, message: string, email = 'tridge@example.com') => {
			// Keep the index-only submodule entry below (it has no working tree).
			git('add', '-A', '--', '.', ':!drivers/imu/vendor');
			const date = `2016-11-${String(++day).padStart(2, '0')}T12:00:00Z`;
			execFileSync(
				'git',
				[
					'-c',
					`user.name=${email.split('@')[0]}`,
					'-c',
					`user.email=${email}`,
					'commit',
					'-q',
					'-m',
					message
				],
				{ cwd: origin, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }
			);
			shas[name] = git('rev-parse', 'HEAD');
		};
		const write = (path: string, text: string) => writeFileSync(join(origin, path), text);
		const imu = (path: string) => join(origin, path);

		mkdirSync(join(origin, 'drivers/imu'), { recursive: true });
		mkdirSync(join(origin, 'other'), { recursive: true });
		execFileSync('git', ['init', '-q', '-b', 'main', origin]);
		// Let the blobless clone fetch blobs by SHA, like GitHub does.
		git('config', 'uploadpack.allowFilter', 'true');
		git('config', 'uploadpack.allowAnySHA1InWant', 'true');

		const body = [
			'int imu_read(void) {',
			'    int t = read_temp();',
			'    return read_fifo();',
			'}'
		];
		write('drivers/imu/imu.c', body.join('\n') + '\n');
		write('drivers/imu/imu.h', 'int imu_read(void);\n');
		write('other/x.c', 'int x;\n');
		// A submodule inside the deep scope: its commits live in another repo (qpcpp `examples`).
		const gitlink = (sha: string) =>
			git('update-index', '--add', '--cacheinfo', `160000,${sha},drivers/imu/vendor`);
		gitlink('1'.repeat(40));
		commit('init', 'init');

		body.splice(2, 0, '    if (!check_temp(t)) return -1;');
		write('drivers/imu/imu.c', body.join('\n') + '\n');
		commit('check', 'imu: catch FIFO alignment errors using temperature reading');

		git('mv', 'drivers/imu/imu.c', 'drivers/imu/imu_driver.c');
		commit('rename', 'imu: rename driver file');

		const withCheck = readFileSync(imu('drivers/imu/imu_driver.c'), 'utf8');
		write(
			'drivers/imu/imu_driver.c',
			withCheck.replace('    if (!check_temp(t)) return -1;\n', '')
		);
		commit('disable', 'imu: disable temperature check', 'someone@example.com');

		write('drivers/imu/imu_driver.c', withCheck);
		commit(
			'revert',
			`Revert "imu: disable temperature check"\n\nThis reverts commit ${shas.disable}.\n\nthis leads to bad IMU data`
		);

		for (let i = 1; i <= 3; i++) {
			write('drivers/imu/imu.h', `int imu_read(void); // v${i}\n`);
			write('drivers/imu/imu_driver.c', withCheck + `// v${i}\n`);
			write('other/x.c', `int x = ${i};\n`);
			if (i === 1) gitlink('2'.repeat(40));
			commit(`pair${i}`, `imu: fix header drift #${40 + i}`);
		}
		head = shas.pair3;

		const dir = join(root, 'clones/fixture.git');
		await ensureCommit({ url: `file://${origin}`, dir, commitSha: head });
		const deepFiles = (await listTree(dir, head))
			.filter((f) => f.path.startsWith('drivers/imu/'))
			.map((f) => ({ path: f.path, language: languageOf(f.path) }));
		mined = await mineHistory({ dir, commitSha: head, deepScope: 'drivers/imu', deepFiles });
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it('prefetches historical blobs in one batch instead of lazily', () => {
		expect(mined.stats.blobsFetched).toBeGreaterThan(0);
		expect(mined.stats.blameFailures).toBe(0);
	});

	it('collects only deep-scope commits, newest first', () => {
		expect(mined.stats.commits).toBe(8);
		expect(mined.commits[0].sha).toBe(shas.pair3);
		expect(mined.commits.every((c) => c.files.every((f) => f.startsWith('drivers/imu/')))).toBe(
			true
		);
	});

	it('follows the rename: pre-rename commits count for the new path', () => {
		const initCommit = mined.commits.find((c) => c.sha === shas.init)!;
		expect(initCommit.files).toEqual(['drivers/imu/imu.h', 'drivers/imu/imu_driver.c']);
		const driver = mined.files.find((f) => f.path === 'drivers/imu/imu_driver.c')!;
		expect(driver).toMatchObject({ commits: 8, reverts: 1, bugfixCommits: 3, authors: 2 });
		expect(driver.topAuthors[0]).toMatchObject({ email: 'tridge@example.com', commits: 7 });
	});

	it('classifies the revert and links it to the reverted commit', () => {
		const revert = mined.commits.find((c) => c.sha === shas.revert)!;
		expect(revert).toMatchObject({ revert: true, revertOf: shas.disable });
		expect(mined.commits.find((c) => c.sha === shas.check)!.rationale).toBe(true);
		expect(mined.commits.find((c) => c.sha === shas.pair1)!.refs).toEqual([41]);
	});

	it('blames the re-added check line to the revert, and old lines through the rename', () => {
		const ranges = mined.blame.filter((r) => r.path === 'drivers/imu/imu_driver.c');
		const at = (line: number) => ranges.find((r) => r.start <= line && line <= r.end)!;
		expect(at(3).sha).toBe(shas.revert);
		expect(at(1)).toMatchObject({ sha: shas.init, origPath: 'drivers/imu/imu.c' });
	});

	it('records co-change pairs inside the deep scope only', () => {
		expect(mined.coChanges).toHaveLength(1);
		expect(mined.coChanges[0]).toMatchObject({
			a: 'drivers/imu/imu.h',
			b: 'drivers/imu/imu_driver.c',
			count: 4
		});
		expect(mined.coChanges[0].shas[0]).toBe(shas.pair3);
	});

	it('builds the author identity map', () => {
		expect(mined.authors.map((a) => [a.email, a.commits])).toEqual([
			['tridge@example.com', 7],
			['someone@example.com', 1]
		]);
	});
});
