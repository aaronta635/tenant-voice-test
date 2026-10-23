// The Google Fonts answers an E2E run's `next dev` gets instead of the network
// (NEXT_FONT_GOOGLE_MOCKED_RESPONSES, which Next reads for its own tests).
// Each next/font/google call in app/ gets a stylesheet whose faces use a local
// font, so no font file is downloaded and the pages render in a system face.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const FONT_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']next\/font\/google["']/g;

/** The object literal a call such as `Inter({ subsets: ["latin"] })` passes, read as JSON; null when it is not plain data. */
export function callOptions(source, name) {
  const start = source.search(new RegExp(`\\b${name}\\s*\\(\\s*\\{`));
  if (start < 0) return {};
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      const literal = source.slice(open, index + 1)
        .replace(/\/\/[^\n]*/g, '')
        .replace(/'([^']*)'/g, '"$1"')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(literal);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** [functionName, options] for every next/font/google call in the source. */
export function fontCalls(source) {
  const calls = [];
  for (const match of source.matchAll(FONT_IMPORT)) {
    for (const specifier of match[1].split(',')) {
      const name = specifier.trim().split(/\s+as\s+/).pop();
      const options = name ? callOptions(source, name) : null;
      if (name && options) calls.push([specifier.trim().split(/\s+/)[0], options]);
    }
  }
  return calls;
}

/** A Google Fonts stylesheet for the family, with a local face instead of downloadable files. */
export function mockStylesheet(fontFamily, subsets = ['latin']) {
  return subsets.map((subset) => `/* ${subset} */
@font-face {
  font-family: '${fontFamily}';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: local('Arial');
}
`).join('');
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') files.push(...await sourceFiles(full));
    else if (/\.(t|j)sx?$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
  }
  return files;
}

/** Write the mocked responses for every font the app loads; returns the URLs it covers. */
export async function writeFontMocks(frontendDir, file) {
  const require = createRequire(path.join(frontendDir, 'package.json'));
  const google = 'next/dist/compiled/@next/font/dist/google';
  const { validateGoogleFontFunctionCall } = require(`${google}/validate-google-font-function-call`);
  const { getFontAxes } = require(`${google}/get-font-axes`);
  const { getGoogleFontsUrl } = require(`${google}/get-google-fonts-url`);
  const responses = {};
  for (const source of await sourceFiles(path.join(frontendDir, 'app'))) {
    const text = await readFile(source, 'utf8');
    if (!text.includes('next/font/google')) continue;
    for (const [name, options] of fontCalls(text)) {
      const call = validateGoogleFontFunctionCall(name, options);
      const axes = getFontAxes(call.fontFamily, call.weights, call.styles, call.selectedVariableAxes);
      responses[getGoogleFontsUrl(call.fontFamily, axes, call.display)] = mockStylesheet(call.fontFamily, options.subsets);
    }
  }
  await writeFile(file, `module.exports = ${JSON.stringify(responses, null, 2)};\n`);
  return Object.keys(responses);
}
