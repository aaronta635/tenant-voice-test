// What several journeys do: sign in through the real form, check what a page holds, make a file to upload.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { label, role } from '../driver.mjs';

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Sign a demo account in through the login form, as a person does: a member
 * picks their account type, staff use the staff sign-in. Waits until the form
 * has sent them on.
 */
export async function signIn(page, web, fixtures, key) {
  const account = fixtures.accounts[key];
  assert(account, `No demo account "${key}"`);
  if (account.tab) {
    await page.open(`${web}/login`);
    await page.click(role('button', account.tab, { within: role('group', 'Account type') }));
  } else {
    await page.open(`${web}/login?account=staff`);
  }
  await page.fill(label('Email'), account.email);
  await page.fill(label('Password'), fixtures.password);
  await page.click(role('button', /^Sign in/));
  await page.waitForUrl((href) => !new URL(href).pathname.startsWith('/login'), { timeout: 30_000 });
  await page.waitForIdle();
  return account;
}

/** Fail when any of the values (a member's private details) is anywhere in the page, its markup and data included. */
export async function expectNone(page, values, where = 'the page') {
  const html = (await page.html()).toLowerCase();
  const found = values.filter((value) => html.includes(String(value).toLowerCase()));
  assert(!found.length, `${where} holds private values: ${found.join(', ')}`);
}

/** Open a page of the app and check that it fits the viewport. */
export async function visit(page, url) {
  await page.open(url);
  await page.expectNoHorizontalScroll();
}

/** A one-page PDF named name in the run's output folder, for an upload; returns its path. */
export async function demoPdf(out, name, title = name) {
  const stream = `BT /F1 16 Tf 24 64 Td (Demo document: ${title.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 460 140] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const file = path.join(out, name);
  await writeFile(file, body, 'latin1');
  return file;
}
