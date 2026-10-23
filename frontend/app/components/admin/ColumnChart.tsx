'use client';

import { useId, useState, type KeyboardEvent } from 'react';

export type Granularity = 'day' | 'week' | 'month';

type Props = {
  title: string;
  /** One count per period, oldest first. */
  counts: number[];
  /** The first day of each period (YYYY-MM-DD). */
  periods: string[];
  granularity: Granularity;
  /** What is counted, one and many: ["review", "reviews"]. */
  noun: [string, string];
};

const STEPS = [1, 2, 2.5, 5, 10];

/** The top of the scale: the largest count rounded up to a clean number. */
export function scaleTop(largest: number) {
  if (largest <= 5) return Math.max(largest, 1);
  const power = 10 ** Math.floor(Math.log10(largest));
  return (STEPS.find((step) => step * power >= largest) ?? 10) * power;
}

/** A period as the chart names it: "21 Sep", "Week of 20 Jul", "Oct 2026". */
export function periodLabel(day: string, granularity: Granularity) {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  if (granularity === 'month') return date.toLocaleDateString('en-AU', { timeZone: 'UTC', month: 'short', year: 'numeric' });
  const short = date.toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return granularity === 'week' ? `Week of ${short}` : short;
}

/**
 * One count over time as columns, one series per chart (the title names it,
 * so there is no legend). Each column's band is its hover target, and the
 * plot takes focus: the arrow keys read one period at a time, as the
 * pointer does. Every value is also in the table under the chart.
 */
export default function ColumnChart({ title, counts, periods, granularity, noun }: Props) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const top = scaleTop(Math.max(0, ...counts));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const last = counts.length - 1;
  const words = (count: number) => `${count} ${noun[count === 1 ? 0 : 1]}`;
  const unit = granularity === 'day' ? 'day' : granularity;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (!(event.key in moves) || last < 0) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, (active ?? last) + moves[event.key])));
  }

  const position = active === null ? 0 : ((active + 0.5) / counts.length) * 100;
  const align = position < 18 ? 'translate-x-0' : position > 82 ? '-translate-x-full' : '-translate-x-1/2';

  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-heading text-base font-semibold text-text-dark">{title}</h3>
        <p className="text-sm text-text-body">{words(total)}</p>
      </figcaption>
      <div className="mt-4">
        <div className="relative pl-8">
          <span aria-hidden className="absolute left-0 top-0 -translate-y-1/2 text-xs tabular-nums text-text-body">{top}</span>
          <span aria-hidden className="absolute bottom-0 left-0 translate-y-1/2 text-xs tabular-nums text-text-body">0</span>
          <div
            role="group"
            tabIndex={0}
            aria-label={`${title} per ${unit}. Use the left and right arrow keys to read each ${unit}.`}
            aria-describedby={`${id}-reading`}
            onKeyDown={onKeyDown}
            onFocus={() => setActive((value) => value ?? last)}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="relative flex h-32 items-end gap-0.5 border-b border-control-border focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-strong"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-border" />
            {counts.map((count, index) => (
              <div
                key={periods[index] ?? index}
                aria-hidden
                data-period={periods[index]}
                onPointerEnter={() => setActive(index)}
                className="flex h-full min-w-0 flex-1 items-end justify-center"
              >
                {/* Inline height: the column's length is the data. */}
                <div
                  className={`w-full max-w-6 rounded-t ${index === active ? 'bg-navy' : 'bg-primary-strong'}`}
                  style={{ height: `${(count / top) * 100}%` }}
                />
              </div>
            ))}
            {active !== null && counts[active] !== undefined ? (
              <div
                aria-hidden
                className={`pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg border border-border bg-white px-3 py-2 shadow-sm ${align}`}
                // Inline position: the tooltip sits over its column.
                style={{ left: `${position}%` }}
              >
                <p className="text-sm font-semibold text-text-dark">{words(counts[active])}</p>
                <p className="text-xs text-text-body">{periodLabel(periods[active], granularity)}</p>
              </div>
            ) : null}
          </div>
        </div>
        {periods.length ? (
          <div aria-hidden className="mt-1 flex justify-between gap-2 pl-8 text-xs text-text-body">
            <span>{periodLabel(periods[0], granularity)}</span>
            <span>{periodLabel(periods[last], granularity)}</span>
          </div>
        ) : null}
      </div>
      <p id={`${id}-reading`} aria-live="polite" className="sr-only">
        {active !== null && counts[active] !== undefined ? `${periodLabel(periods[active], granularity)}: ${words(counts[active])}` : ''}
      </p>
      {total === 0 ? <p className="mt-2 text-sm text-text-body">None in this range.</p> : null}
      <details className="mt-3 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary-strong underline">
          Show the numbers<span className="sr-only"> for {title.toLowerCase()}</span>
        </summary>
        <div className="mt-2 rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title} per {unit}</caption>
            <thead className="bg-background text-xs uppercase tracking-wide text-text-body">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">{granularity === 'month' ? 'Month' : granularity === 'week' ? 'Week' : 'Day'}</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">{noun[1].charAt(0).toUpperCase() + noun[1].slice(1)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {counts.map((count, index) => (
                <tr key={periods[index] ?? index}>
                  <th scope="row" className="px-3 py-1.5 font-normal text-text-dark">{periodLabel(periods[index], granularity)}</th>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-dark">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
