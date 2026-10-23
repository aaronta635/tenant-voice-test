import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoLabelFiles } from '@/app/test-utils/demo-label-files';

const doc = readFileSync(new URL('../../../../docs/demo-features.md', import.meta.url), 'utf8');

/** The text of one `## heading` section, up to the next one. */
function section(heading: string) {
  const start = doc.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`docs/demo-features.md has no "## ${heading}" section`);
  const end = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, end === -1 ? undefined : end);
}

/** The components a section names, as `app/…` paths. */
const componentsIn = (text: string) => [...text.matchAll(/`frontend\/(app\/[^`]+\.tsx)`/g)].map(([, file]) => file);

describe('docs/demo-features.md', () => {
  it('lists every component that renders a Demo label', () => {
    const listed = new Set(componentsIn(section('Labelled in the app')));

    expect(demoLabelFiles().filter((file) => !listed.has(file))).toEqual([]);
  });

  it('lists as labelled only components that still render a Demo label', () => {
    const labelled = new Set(demoLabelFiles());

    expect(componentsIn(section('Labelled in the app')).filter((file) => !labelled.has(file))).toEqual([]);
  });

  it('keeps the demos it lists for other areas out of the labelled list until they render a label', () => {
    const labelled = new Set(demoLabelFiles());

    expect(componentsIn(section('Shown by components other areas own')).filter((file) => labelled.has(file))).toEqual([]);
  });

  it('says how demo rows stay off the live shared database and how demo accounts are recognised', () => {
    const accounts = section('Demo accounts and sample rows');

    expect(accounts).toContain('backend/scripts/seed_provider_demo.py');
    expect(accounts).toMatch(/Never write demo rows to the live shared database/);
    expect(accounts).toContain('frontend/app/lib/demo.ts');
  });
});
