import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const doc = readFileSync(new URL('../../../../docs/DESIGN_SYSTEM.md', import.meta.url), 'utf8');
const DELIMITER_ROW = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;

/**
 * Runs of consecutive pipe-led lines outside code fences. GitHub ends a table
 * at the first line that is not a row, so each run must open with a header
 * and a delimiter row or it renders as a plain paragraph.
 */
function tableRuns(markdown: string) {
  const runs: { start: number; rows: string[] }[] = [];
  let fenced = false;
  markdown.split('\n').forEach((line, index) => {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced || !line.startsWith('|')) return;
    const last = runs.at(-1);
    if (last && last.start + last.rows.length === index) last.rows.push(line);
    else runs.push({ start: index, rows: [line] });
  });
  return runs;
}

describe('DESIGN_SYSTEM.md', () => {
  it('keeps every table row attached to a header and delimiter row', () => {
    const detached = tableRuns(doc)
      .filter(({ rows }) => rows.length < 2 || !DELIMITER_ROW.test(rows[1]))
      .map(({ start, rows }) => `line ${start + 1}: ${rows[0].slice(0, 60)}`);

    expect(detached).toEqual([]);
  });
});
