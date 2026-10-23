// The components that render a Demo label, read from their source, so that
// docs/demo-features.md and the render tests in components/demo cannot drift
// from the code. DemoNotice is the seeded provider's notice: what imports it
// renders a DemoLabel too.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../', import.meta.url));
const RENDERS_LABEL = /from\s+['"][^'"]*\/(?:demo\/DemoLabel|provider\/DemoNotice)['"]/;

/** Every source file under app/ that renders a Demo label, as `app/…` paths, sorted. */
export function demoLabelFiles(): string[] {
  return readdirSync(APP_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter((file) => RENDERS_LABEL.test(readFileSync(`${APP_DIR}${file}`, 'utf8')))
    .map((file) => `app/${file}`)
    .sort();
}
