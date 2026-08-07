'use client';

import { useState } from 'react';

type Props = {
  /** Locations that published providers actually list, newest first. */
  cities: string[];
  onSelect?: (city: string) => void;
};

export default function CityTabs({ cities, onSelect }: Props) {
  const [active, setActive] = useState(cities[0] ?? '');

  if (cities.length === 0) return null;

  return (
    <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Featured location">
      {cities.map((city) => {
        const selected = active === city;
        return (
          <button
            key={city}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              setActive(city);
              onSelect?.(city);
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              selected
                ? 'bg-[#0e2a48] text-white'
                : 'bg-white text-[#5f6b76] ring-1 ring-[#efeff2] hover:text-[#1b1b1f]'
            }`}
          >
            {city}
          </button>
        );
      })}
    </div>
  );
}
