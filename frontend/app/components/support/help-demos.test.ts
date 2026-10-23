/**
 * A help passage that tells members something is a demo names the components
 * that label it (backend app/data/help/*.md, "Demo:"), and each of them still
 * renders a Demo label and is in docs/demo-features.md's labelled list. The
 * change that makes a feature real removes its label and its row there, so it
 * fails here too until the passages that call the feature a demo are
 * rewritten: the support chat never tells a member that something real is not
 * built yet.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoLabelFiles } from '@/app/test-utils/demo-label-files';

const HELP_DIR = new URL('../../../../backend/app/data/help/', import.meta.url);
const doc = readFileSync(new URL('../../../../docs/demo-features.md', import.meta.url), 'utf8');
const FIELD = /^(Page|For|Keywords|Demo):\s*(.*)$/;
// The passage that explains what a Demo label is, rather than one demo.
const ABOUT_LABELS = 'demo-labels.md: What a Demo label means';

type Passage = { id: string; demo: string[]; text: string };

/** Each passage of the help files, with the components its Demo: line names (as `app/…` paths). */
const passages: Passage[] = readdirSync(HELP_DIR).filter((name) => name.endsWith('.md')).flatMap((name) =>
  readFileSync(new URL(name, HELP_DIR), 'utf8').split(/^## /m).slice(1).map((part) => {
    const [title, ...lines] = part.split('\n').map((line) => line.trim());
    const fields: Record<string, string> = {};
    while (lines.length && FIELD.test(lines[0])) {
      const [, key, value] = lines.shift()!.match(FIELD)!;
      fields[key] = value;
    }
    const demo = (fields.Demo ?? '').split(',').map((path) => path.trim()).filter(Boolean)
      .map((path) => path.replace(/^frontend\//, ''));
    return { id: `${name}: ${title}`, demo, text: lines.join(' ') };
  }));

/** The components docs/demo-features.md lists as rendering a Demo label. */
function labelledInDoc() {
  const start = doc.indexOf('\n## Labelled in the app\n');
  const end = doc.indexOf('\n## ', start + 1);
  return new Set([...doc.slice(start, end).matchAll(/`frontend\/(app\/[^`]+\.tsx)`/g)].map(([, file]) => file));
}

describe('the help passages about demos', () => {
  it('name the components that label each demo they describe', () => {
    const untied = passages.filter((passage) => passage.id !== ABOUT_LABELS && /Demo label/.test(passage.text) && !passage.demo.length);

    expect(untied.map((passage) => passage.id)).toEqual([]);
    expect(passages.filter((passage) => passage.demo.length).length).toBeGreaterThan(5);
  });

  it.each(passages.filter((passage) => passage.demo.length))('$id: each component still renders a Demo label', ({ demo }) => {
    const rendering = new Set(demoLabelFiles());
    const listed = labelledInDoc();

    expect(demo.filter((file) => !rendering.has(file))).toEqual([]);
    expect(demo.filter((file) => !listed.has(file))).toEqual([]);
  });
});
