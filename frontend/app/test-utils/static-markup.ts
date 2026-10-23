import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" };
const decode = (value: string) => value.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
// Comments (React's Suspense and text-node markers) join their neighbours; tags separate them.
const visible = (html: string) => decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The markup, the text a reader sees, every link and every heading. */
function readMarkup(html: string) {
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
    href: decode(/\bhref="([^"]*)"/.exec(attributes)?.[1] ?? ''),
    text: visible(inner),
  }));
  // In document order, e.g. "h1 Every service category".
  const headings = [...html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g)].map(([, tag, inner]) => `${tag} ${visible(inner)}`);
  return { html, text: visible(html), links, headings };
}

/** Server-renders an element: its markup, the text a reader sees, every link and every heading. */
export function renderMarkup(element: ReactElement) {
  return readMarkup(renderToStaticMarkup(element));
}

/** As renderMarkup, with every Suspense boundary resolved in place of its fallback. */
export async function prerenderMarkup(element: ReactElement) {
  // A long page otherwise has its later boundaries written after it, with the
  // script that moves them into place, and their fallbacks still inline.
  const { prelude } = await prerender(element, { progressiveChunkSize: Number.POSITIVE_INFINITY });
  return readMarkup(await new Response(prelude).text());
}
