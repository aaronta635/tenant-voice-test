'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { SEARCH_TYPES, searchHref, type SearchType } from '@/app/lib/home-search';
import { pushHref } from '@/app/lib/page-url';

/**
 * One search box for the whole platform: each type opens the page that lists
 * it. Before the page hydrates the form submits natively to /search, which
 * sends each type on to the same page.
 */
export default function HomeSearch() {
  const router = useRouter();
  const id = useId();
  const [type, setType] = useState<SearchType>('profiles');
  const [text, setText] = useState('');
  const current = SEARCH_TYPES.find((option) => option.value === type) ?? SEARCH_TYPES[0];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pushHref(router, searchHref(type, text));
  }

  return (
    <form
      role="search"
      aria-label="Search TenantVoice"
      action="/search"
      onSubmit={submit}
      className="mt-8 flex w-full max-w-[640px] flex-col gap-3 rounded-[22px] border border-border bg-white p-3 shadow-[0_12px_16px_rgba(14,42,72,0.1)] sm:flex-row sm:items-center sm:gap-0 sm:pl-5"
    >
      <div className="relative flex shrink-0 flex-col justify-center rounded-md px-1 py-1 focus-within:ring-2 focus-within:ring-primary sm:w-[150px]">
        <label htmlFor={`${id}-type`} className="text-[10px] font-bold tracking-[1px] text-text-body uppercase">
          Search for
        </label>
        <select
          id={`${id}-type`}
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value as SearchType)}
          className="w-full appearance-none border-0 bg-transparent pr-6 text-sm font-semibold text-text-dark outline-none"
        >
          {SEARCH_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="pointer-events-none absolute right-1 bottom-1.5 text-text-body">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      <div className="hidden h-9 w-px shrink-0 bg-[#f4f4f8] sm:block" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col justify-center rounded-md px-1 py-1 focus-within:ring-2 focus-within:ring-primary sm:px-4">
        <label htmlFor={`${id}-text`} className="text-[10px] font-bold tracking-[1px] text-text-body uppercase">
          Keywords
        </label>
        <input
          id={`${id}-text`}
          type="search"
          name="q"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={current.placeholder}
          className="w-full truncate border-0 bg-transparent text-sm font-semibold text-text-dark outline-none placeholder:font-normal placeholder:text-text-subtle"
        />
        <input type="hidden" name="role" value="all" />
      </div>
      <button
        type="submit"
        className="inline-flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-[16px] border border-transparent bg-primary-strong px-7 text-sm font-bold text-white shadow-[0_4px_6px_rgba(99,106,232,0.3)] transition-colors hover:bg-navy sm:ml-3"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        Search
      </button>
    </form>
  );
}
