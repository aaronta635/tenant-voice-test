// The run empties only an output folder a run made (run.mjs prepareOut): never what --out names by mistake.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { OUT_MARKER, prepareOut } from '../run.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'tenantvoice-e2e-out-test-'));
after(() => rm(root, { recursive: true, force: true }));

describe('the output folder', () => {
  it('refuses a folder holding files no run made, and deletes none of them', async () => {
    const folder = path.join(root, 'desktop');
    await mkdir(folder);
    await writeFile(path.join(folder, 'keep-me.txt'), 'precious');

    await assert.rejects(prepareOut(folder), /holds files no E2E run made/);
    assert.deepEqual(await readdir(folder), ['keep-me.txt']);
  });

  it('makes a new folder, and empties it on the next run', async () => {
    const folder = path.join(root, 'new');

    await prepareOut(folder);
    await writeFile(path.join(folder, 'report.md'), '# E2E report');
    await prepareOut(folder);

    assert.deepEqual((await readdir(folder)).sort(), [OUT_MARKER, 'screenshots']);
  });

  it('takes an empty folder, and the default folder whatever it holds', async () => {
    const empty = path.join(root, 'empty');
    const fallback = path.join(root, 'default');
    await mkdir(empty);
    await mkdir(fallback);
    await writeFile(path.join(fallback, 'report.json'), '[]');

    await prepareOut(empty);
    await prepareOut(fallback, { isDefault: true });

    assert.deepEqual((await readdir(empty)).sort(), [OUT_MARKER, 'screenshots']);
    assert.deepEqual((await readdir(fallback)).sort(), [OUT_MARKER, 'screenshots']);
  });
});
