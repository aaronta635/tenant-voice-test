'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import { api, type ProviderRecommendationLocation } from '@/app/lib/api';

type LookupState = {
  key: string;
  status: 'loading' | 'ready' | 'error';
  items: ProviderRecommendationLocation[];
};

export default function ProviderLocationAutocomplete({
  id,
  value,
  role,
  disabled = false,
  describedBy,
  onChange,
  onSelect,
}: {
  id: string;
  value: string;
  role?: 'tenant' | 'landlord';
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lookup, setLookup] = useState<LookupState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, ProviderRecommendationLocation[]>());
  const query = value.trim();
  const queryKey = JSON.stringify([role ?? '', query]);
  const visible = open && !disabled;
  const currentLookup = lookup?.key === queryKey ? lookup : null;
  const loading = visible && (!currentLookup || currentLookup.status === 'loading');
  const items = currentLookup?.status === 'ready' ? currentLookup.items : [];
  const activeItem = items[activeIndex];
  const listId = `${id}-suggestions`;

  useEffect(() => {
    if (!visible) return;
    let current = true;
    const timer = window.setTimeout(async () => {
      const cached = cache.current.get(queryKey);
      if (cached) {
        setLookup({ key: queryKey, status: 'ready', items: cached });
        return;
      }
      setLookup({ key: queryKey, status: 'loading', items: [] });
      try {
        const response = await api.recommendations.providerLocations({ search: query, role });
        if (!current) return;
        cache.current.set(queryKey, response.items);
        setLookup({ key: queryKey, status: 'ready', items: response.items });
      } catch {
        if (current) setLookup({ key: queryKey, status: 'error', items: [] });
      }
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [visible, query, queryKey, role, attempt]);

  useEffect(() => {
    if (!visible) return;
    function dismissOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('pointerdown', dismissOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointer);
  }, [visible]);

  useEffect(() => {
    if (!visible || !activeItem) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [visible, activeItem, activeIndex, listId]);

  function selectLocation(item: ProviderRecommendationLocation) {
    setOpen(false);
    setActiveIndex(-1);
    onSelect(item.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Safari reports the Enter that commits an IME candidate as keyCode 229.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (items.length) {
        setActiveIndex((index) => event.key === 'ArrowDown'
          ? (index + 1) % items.length
          : index <= 0 ? items.length - 1 : index - 1);
      }
    } else if (event.key === 'Enter' && visible) {
      setOpen(false);
      setActiveIndex(-1);
      if (activeItem) {
        event.preventDefault();
        event.stopPropagation();
        selectLocation(activeItem);
      }
    } else if (event.key === 'Escape' && visible) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div
      ref={container}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <Input
        id={id}
        label="Location"
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && activeItem ? `${listId}-${activeIndex}` : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder="Suburb, state or postcode"
        maxLength={80}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          setActiveIndex(-1);
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setOpen(true);
          setActiveIndex(-1);
          onChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
      />
      {visible ? (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          <div role="status" aria-live="polite" className="border-b border-border px-3 py-2 text-xs text-text-body">
            {loading ? 'Finding locations…' : currentLookup?.status === 'error'
              ? 'Location suggestions could not be loaded.'
              : items.length ? 'Locations from matching profiles'
                : 'No matching profile locations. You can still apply your typed location.'}
          </div>
          <div id={listId} role="listbox" aria-label="Suggested locations" aria-busy={loading} className="max-h-64 overflow-y-auto p-1">
            {items.map((item, index) => (
              <button
                id={`${listId}-${index}`}
                key={item.value}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary ${index === activeIndex ? 'bg-surface text-primary-strong' : 'text-text-dark'}`}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => selectLocation(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {currentLookup?.status === 'error' ? (
            <div className="px-3 pb-3">
              <Button
                type="button"
                variant="ghost"
                className="h-9 rounded-lg"
                onClick={() => setAttempt((current) => current + 1)}
              >
                Retry suggestions
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
