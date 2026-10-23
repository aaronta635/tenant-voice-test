'use client';

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import ProviderCard from '@/app/components/providers/ProviderCard';
import type { Category, PublicProvider } from '@/app/lib/api';
import { matchesProviderLocation, providerLocation, providerName } from '@/app/lib/provider-view';

const SORT_OPTIONS = ['Recommended', 'Highest rated', 'Lowest price', 'Most reviews'] as const;
const RATINGS = ['Any', '3.0+', '4.0+', '4.5+'] as const;
// Typing and dragging write the URL once input pauses: every history write
// commits through a router transition, and browsers rate-limit history calls.
const URL_WRITE_DELAY_MS = 300;
type UrlChanges = Record<string, string | string[] | null>;
type Props = {
  category: Category; providers: PublicProvider[]; serviceTypes: string[];
  verificationOptions: string[]; availabilityOptions: string[]; priceCeiling: number;
};
const inputClass = 'min-h-11 w-full rounded-xl border border-control-border bg-white px-3 py-2 text-sm text-text-dark';

export default function CategoryFiltersPanel({ category, providers, serviceTypes, verificationOptions, availabilityOptions, priceCeiling }: Props) {
  const params = useSearchParams();
  const pathname = usePathname();
  const id = useId();
  const rating = RATINGS.find((value) => value === params.get('rating')) ?? 'Any';
  const sort = SORT_OPTIONS.find((value) => value === params.get('sort')) ?? 'Recommended';
  const view = params.get('view') === 'List' ? 'List' : 'Grid';
  const serviceFilters = params.getAll('service');
  const verifications = params.getAll('verified');
  const availability = params.getAll('available');
  const clampPrice = (raw: string | null, fallback: number) => raw !== null && Number.isFinite(Number(raw)) ? Math.max(0, Math.min(priceCeiling, Number(raw))) : fallback;
  // Text and range inputs start from the URL but then read local state: bound to
  // the URL they lag behind each keystroke, which moves the caret to the end.
  const [location, setLocation] = useState(() => params.get('location') ?? '');
  const [search, setSearch] = useState(() => params.get('search') ?? '');
  const [price, setPrice] = useState(() => {
    const min = clampPrice(params.get('min'), 0);
    return { min, max: Math.max(min, clampPrice(params.get('max'), priceCeiling)) };
  });
  const { min: priceMin, max: priceMax } = price;
  const [locationDraft, setLocationDraft] = useState(location);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const pendingChanges = useRef<UrlChanges>({});
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCoHost = category.slug === 'co-host-inspector';

  // A write still pending after navigating away would rewrite the next page's URL.
  useEffect(() => () => cancelPendingWrite(writeTimer, pendingChanges), []);

  function update(changes: UrlChanges = {}) {
    const merged = { ...pendingChanges.current, ...changes };
    cancelPendingWrite(writeTimer, pendingChanges);
    // Read the latest URL so two controls changed in the same tick never overwrite each other.
    const query = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(merged)) {
      query.delete(key);
      for (const item of Array.isArray(value) ? value : value ? [value] : []) query.append(key, item);
    }
    // /categories lists providers only while the URL has a location, keywords or ?all=1.
    if (category.slug === 'all' && !query.get('location') && !query.get('search')) query.set('all', '1');
    window.history.replaceState(null, '', `${pathname}${query.toString() ? `?${query}` : ''}`);
  }
  function updateSoon(changes: UrlChanges) {
    pendingChanges.current = { ...pendingChanges.current, ...changes };
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => update(), URL_WRITE_DELAY_MS);
  }
  function flushUpdate() {
    if (writeTimer.current) update();
  }
  function clearAll() {
    cancelPendingWrite(writeTimer, pendingChanges);
    setLocation(''); setSearch(''); setPrice({ min: 0, max: priceCeiling });
    setLocationDraft(''); setSuggestionsOpen(false);
    window.history.replaceState(null, '', category.slug === 'all' ? `${pathname}?all=1` : pathname);
  }
  function toggle(key: string, values: string[], value: string) {
    update({ [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] });
  }
  function applyLocation(value: string) {
    setLocation(value.trim()); setLocationDraft(value.trim()); setSuggestionsOpen(false); setActiveSuggestion(-1);
    update({ location: value.trim() });
  }
  const suggestions = useMemo(() => {
    const places = new Set<string>();
    for (const provider of providers) {
      for (const place of [providerLocation(provider), provider.profiles?.location, provider.profiles?.state, provider.profiles?.postcode]) {
        if (place && place !== 'Australia') places.add(place);
      }
    }
    const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return [...places].sort().filter((place) => normalize(place).includes(normalize(locationDraft))).slice(0, 8);
  }, [providers, locationDraft]);
  const listOpen = suggestionsOpen && suggestions.length > 0;
  // Profiles opened from here link back to this listing, filters included.
  const listingQuery = params.toString();
  const listingHref = `${pathname}${listingQuery ? `?${listingQuery}` : ''}`;

  const filteredProviders = providers.filter((provider) => {
    if (provider.rating_avg < (rating === 'Any' ? 0 : Number.parseFloat(rating))) return false;
    if (verifications.some((value) => !provider.verifications.includes(value))) return false;
    if (availability.length && !availability.includes(provider.availability_note ?? '')) return false;
    if (serviceFilters.length && !serviceFilters.some((value) => provider.specialties?.includes(value))) return false;
    if (provider.from_price !== null && (provider.from_price < priceMin || provider.from_price > priceMax)) return false;
    if (!matchesProviderLocation(provider, location)) return false;
    return [providerName(provider), provider.tagline, provider.headline, ...(provider.specialties ?? [])].join(' ').toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => sort === 'Highest rated' ? b.rating_avg - a.rating_avg : sort === 'Most reviews' ? b.review_count - a.review_count : sort === 'Lowest price' ? (a.from_price ?? Infinity) - (b.from_price ?? Infinity) : 0);

  return <>
    <h1 className="mt-6 font-heading text-3xl font-bold text-text-dark">{isCoHost ? 'Find a co-host inspector' : `Providers in ${category.name}`}</h1>
    <p className="mt-2 max-w-2xl text-text-body">{category.description}</p>
    {providers.length === 0 ? <section className="mt-8 rounded-2xl border border-border bg-white p-8">
      <h2 className="font-heading text-xl font-bold">No providers listed in this category yet</h2>
      <p className="mt-2 text-text-body">Browse another category, or list your own service.</p>
      <div className="mt-4 flex flex-wrap gap-4"><Link href="/categories" className="font-semibold text-primary-strong underline">Browse categories</Link><Link href="/register?role=service_provider" className="font-semibold text-primary-strong underline">List your service</Link></div>
    </section> : <>
      {isCoHost ? <section className="mt-8 rounded-2xl border border-border bg-white p-5 sm:p-7">
        <h2 className="font-heading text-xl font-bold">Where is your property?</h2>
        <p className="mt-1 text-sm text-text-body">Filter inspectors by their listed suburb, state or postcode.</p>
        <form className="relative mt-4 max-w-xl" onSubmit={(event) => { event.preventDefault(); applyLocation(locationDraft); }}>
          <label htmlFor={`${id}-area`} className="mb-1 block text-sm font-semibold">Property location</label>
          <div className="flex gap-2">
            <input id={`${id}-area`} role="combobox" aria-autocomplete="list" aria-expanded={listOpen} aria-controls={`${id}-suggestions`} aria-activedescendant={listOpen && suggestions[activeSuggestion] ? `${id}-suggestion-${activeSuggestion}` : undefined}
              className={`${inputClass} min-w-0`} value={locationDraft} placeholder="Suburb or postcode" autoComplete="off"
              onChange={(event) => { setLocationDraft(event.target.value); setSuggestionsOpen(true); setActiveSuggestion(-1); }}
              onFocus={() => setSuggestionsOpen(true)} onBlur={() => setSuggestionsOpen(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { event.preventDefault(); setSuggestionsOpen(false); setActiveSuggestion(-1); }
                // With nothing to highlight, the arrows keep moving the caret.
                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) { event.preventDefault(); setSuggestionsOpen(true); setActiveSuggestion((previous) => Math.max(0, Math.min(suggestions.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1)))); }
                if (event.key === 'Enter' && suggestionsOpen && activeSuggestion >= 0 && suggestions[activeSuggestion]) { event.preventDefault(); applyLocation(suggestions[activeSuggestion]); }
              }} />
            <button className="min-h-11 shrink-0 rounded-xl border border-transparent bg-primary-strong px-4 font-semibold text-white">Search</button>
          </div>
          {listOpen ? <ul role="listbox" id={`${id}-suggestions`} className="absolute z-20 mt-1 w-full rounded-xl border border-control-border bg-white p-1 shadow-lg">
            {suggestions.map((place, index) => <li key={place} id={`${id}-suggestion-${index}`} role="option" aria-selected={activeSuggestion === index} onMouseDown={(event) => event.preventDefault()} onClick={() => applyLocation(place)} className={`cursor-pointer rounded-lg px-3 py-3 text-sm ${index === activeSuggestion ? 'bg-primary-strong text-white' : 'text-text-dark hover:bg-surface'}`}>{place}</li>)}
          </ul> : null}
        </form>
        {location ? <button onClick={clearAll} className="mt-3 min-h-11 font-semibold text-primary-strong underline">Show all co-host inspectors</button> : null}
      </section> : null}
      <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-border bg-white p-5 print:hidden">
          <div className="flex items-center justify-between"><h2 className="font-bold">Filters</h2><button className="min-h-11 text-sm font-semibold text-primary-strong underline" onClick={clearAll}>Clear all</button></div>
          <FilterBlock title="Location"><label htmlFor={`${id}-location`} className="sr-only">Location</label><input id={`${id}-location`} className={inputClass} value={location} placeholder="Suburb, state or postcode" onChange={(event) => { setLocation(event.target.value); setLocationDraft(event.target.value); updateSoon({ location: event.target.value }); }} onBlur={flushUpdate} /></FilterBlock>
          <FilterBlock title="Keywords"><label htmlFor={`${id}-search`} className="sr-only">Keywords</label><input id={`${id}-search`} type="search" className={inputClass} value={search} placeholder="What do you need done?" onChange={(event) => { setSearch(event.target.value); updateSoon({ search: event.target.value }); }} onBlur={flushUpdate} /></FilterBlock>
          {serviceTypes.length > 0 ? <FilterBlock title="Service type">{serviceTypes.map((value) => <Check key={value} checked={serviceFilters.includes(value)} label={value} onChange={() => toggle('service', serviceFilters, value)} />)}</FilterBlock> : null}
          <FilterBlock title="Minimum rating"><div role="radiogroup" aria-label="Minimum rating">{RATINGS.map((value) => <label key={value} className="flex min-h-11 items-center gap-3 text-sm text-text-body"><input type="radio" className="size-5 shrink-0 accent-primary" name={`${id}-rating`} checked={rating === value} onChange={() => update({ rating: value === 'Any' ? null : value })} />{value === 'Any' ? 'Any rating' : `${value} stars`}</label>)}</div></FilterBlock>
          <FilterBlock title="Price range">
            <label htmlFor={`${id}-min`} className="text-sm text-text-body">Minimum ${priceMin}</label><input id={`${id}-min`} type="range" className="mt-2 h-6 w-full accent-primary" min={0} max={priceCeiling} step={10} value={priceMin} onChange={(event) => { const min = Math.min(Number(event.target.value), priceMax); setPrice({ min, max: priceMax }); updateSoon({ min: String(min) }); }} onBlur={flushUpdate} />
            <label htmlFor={`${id}-max`} className="mt-3 block text-sm text-text-body">Maximum ${priceMax}</label><input id={`${id}-max`} type="range" className="mt-2 h-6 w-full accent-primary" min={0} max={priceCeiling} step={10} value={priceMax} onChange={(event) => { const max = Math.max(Number(event.target.value), priceMin); setPrice({ min: priceMin, max }); updateSoon({ max: String(max) }); }} onBlur={flushUpdate} />
          </FilterBlock>
          {availabilityOptions.length > 0 ? <FilterBlock title="Availability">{availabilityOptions.map((value) => <Check key={value} checked={availability.includes(value)} label={value} onChange={() => toggle('available', availability, value)} />)}</FilterBlock> : null}
          {verificationOptions.length > 0 ? <FilterBlock title="Verification">{verificationOptions.map((value) => <Check key={value} checked={verifications.includes(value)} label={`${value} (${providers.filter((provider) => provider.verifications.includes(value)).length})`} onChange={() => toggle('verified', verifications, value)} />)}</FilterBlock> : null}
        </aside>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm text-text-body">{filteredProviders.length} of {providers.length} providers{location ? ` matching ${location}` : ''}</p>
            <div className="flex flex-wrap items-center gap-3 print:hidden"><label className="flex items-center gap-2 text-sm">Sort by<select className="min-h-11 rounded-lg border border-control-border bg-white px-2" value={sort} onChange={(event) => update({ sort: event.target.value })}>{SORT_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
              <div role="group" aria-label="Result view" className="flex gap-1">{['Grid', 'List'].map((value) => <button key={value} aria-pressed={view === value} onClick={() => update({ view: value })} className={`min-h-11 rounded-lg border px-3 text-sm ${view === value ? 'border-primary-strong bg-primary-strong text-white' : 'border-control-border bg-white text-text-body'}`}>{value}</button>)}</div>
            </div>
          </div>
          {filteredProviders.length === 0 ? <section className="mt-6 rounded-2xl border border-border bg-white p-8 text-center"><h2 className="font-bold">No providers match these filters</h2><p className="mt-2 text-sm text-text-body">Try another location or clear the filters.</p><button className="mt-3 min-h-11 font-semibold text-primary-strong underline" onClick={clearAll}>Clear all filters</button></section> : <div className={view === 'List' ? 'mt-6 space-y-4' : 'mt-6 grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-3'}>{filteredProviders.map((provider) => <ProviderCard key={provider.id} provider={provider} layout={view === 'List' ? 'list' : 'grid'} listingHref={listingHref} />)}</div>}
        </div>
      </div>
    </>}
  </>;
}
function cancelPendingWrite(timer: RefObject<ReturnType<typeof setTimeout> | null>, pending: RefObject<UrlChanges>) {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
  pending.current = {};
}
function FilterBlock({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mt-4 border-t border-border pt-4"><h3 className="mb-2 text-sm font-bold">{title}</h3>{children}</section>; }
function Check({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) { return <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text-body"><input type="checkbox" className="size-5 shrink-0 accent-primary" checked={checked} onChange={onChange} />{label}</label>; }
