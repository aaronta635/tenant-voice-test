import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_DIR = fileURLToPath(new URL('./', import.meta.url));
const pages = readdirSync(APP_DIR, { recursive: true, encoding: 'utf8' }).filter((file) => /(^|\/)page\.tsx$/.test(file));

describe("the pages' titles", () => {
  it('leave the site name to the root layout, whose template adds " · TenantVoice"', () => {
    // A plain string title gets the template: "Rent ledger · TenantVoice" would show the name twice.
    const doubled = pages.filter((file) => /title: '[^']*TenantVoice'/.test(readFileSync(`${APP_DIR}${file}`, 'utf8')));

    expect(doubled).toEqual([]);
  });
});
