'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  api,
  safe,
  type Invoice,
  type ProviderFinance,
  type Transaction,
} from '@/app/lib/api';
import {
  formatDate,
  formatMoney,
  formatMoneyExact,
  formatPercent,
  initialsOf,
  TRANSACTION_TYPE_LABELS,
} from '@/app/lib/format';

const SIDEBAR = ['Overview', 'Transactions', 'Invoices', 'Payouts'] as const;

export default function FinancesPage() {
  const [section, setSection] = useState<(typeof SIDEBAR)[number]>('Overview');
  const [months, setMonths] = useState(12);
  const [finance, setFinance] = useState<ProviderFinance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [summary, txns, inv] = await Promise.all([
        safe<ProviderFinance | null>(api.dashboard.providerFinance(), null),
        safe(api.finance.transactions(), []),
        safe(api.finance.invoices(), []),
      ]);
      if (!active) return;
      setFinance(summary);
      setTransactions(txns);
      setInvoices(inv);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const chart = useMemo(() => {
    const points = (finance?.monthly ?? []).slice(-months);
    const peak = points.reduce((max, p) => Math.max(max, p.amount), 0);
    return { points, peak };
  }, [finance, months]);

  const visibleTransactions = useMemo(() => {
    if (section === 'Payouts') return transactions.filter((t) => t.type === 'payout');
    return transactions;
  }, [transactions, section]);

  const cards = finance
    ? [
        { label: 'Pending payments', value: formatMoney(finance.pending_payments) },
        { label: 'This month earnings', value: formatMoney(finance.month_earnings) },
        { label: 'Total payouts', value: formatMoney(finance.total_payouts) },
        { label: 'Upcoming payouts', value: formatMoney(finance.upcoming_payouts) },
      ]
    : [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[32px] font-extrabold tracking-tight text-[#1b1b1f]">
          Finance / Earnings
        </h1>
        <p className="mt-1 text-[#5f6b76]">Track payouts, fees, and booking income.</p>
      </div>

      {loading ? (
        <p className="text-[#5f6b76]">Loading your ledger…</p>
      ) : !finance ? (
        <div className="rounded-[20px] border border-dashed border-[#c5cad3] bg-white p-10 text-center text-[#5f6b76]">
          No provider profile yet — finish onboarding to start tracking earnings.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <aside className="h-fit rounded-[20px] border border-[#efeff2] bg-white p-4">
            <nav className="space-y-1">
              {SIDEBAR.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSection(item)}
                  className={`flex w-full rounded-[10px] px-3 py-2.5 text-left text-sm font-semibold ${
                    section === item
                      ? 'bg-[#eeeffd] text-primary'
                      : 'text-[#5f6b76] hover:bg-[#fafafe]'
                  }`}
                >
                  {item}
                </button>
              ))}
            </nav>
            <div className="mt-6 rounded-[16px] bg-[#0e2a48] p-4 text-white">
              <p className="text-xs text-white/70">Available balance</p>
              <p className="mt-1 text-2xl font-extrabold">
                {formatMoney(finance.available_balance)}
              </p>
              <button
                type="button"
                className="mt-3 h-9 w-full rounded-full bg-primary text-sm font-bold"
              >
                Withdraw
              </button>
            </div>
          </aside>

          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {cards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-[18px] border border-[#efeff2] bg-white p-4"
                >
                  <p className="text-xs font-bold tracking-wide text-[#8c97a2] uppercase">
                    {card.label}
                  </p>
                  <p className="mt-2 text-2xl font-extrabold text-[#1b1b1f]">{card.value}</p>
                </div>
              ))}
            </div>

            <section className="rounded-[20px] border border-[#efeff2] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-bold text-[#1b1b1f]">Earnings overview</h2>
                <div className="flex gap-1">
                  {[3, 6, 12].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setMonths(count)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        months === count
                          ? 'bg-[#0e2a48] text-white'
                          : 'bg-[#f4f4f8] text-[#5f6b76]'
                      }`}
                    >
                      {count}m
                    </button>
                  ))}
                </div>
              </div>
              {chart.points.length === 0 ? (
                <p className="mt-6 text-sm text-[#8c97a2]">
                  No payments recorded yet — completed bookings appear here.
                </p>
              ) : (
                <>
                  <div className="mt-6 flex h-40 items-end gap-2">
                    {chart.points.map((point) => (
                      <div key={point.month} className="flex flex-1 flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t-md bg-primary/80"
                          style={{
                            height: `${chart.peak ? (point.amount / chart.peak) * 100 : 0}%`,
                          }}
                          title={`${point.month}: ${formatMoney(point.amount)}`}
                        />
                        <span className="text-[10px] text-[#8c97a2]">{point.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-[#5f6b76]">
                    YTD {formatMoney(finance.ytd_earnings)}
                    {finance.yoy_change_pct === null
                      ? ''
                      : ` (${formatPercent(finance.yoy_change_pct)} YoY)`}
                  </p>
                </>
              )}
            </section>

            {section === 'Invoices' ? (
              <section className="overflow-hidden rounded-[20px] border border-[#efeff2] bg-white">
                <div className="border-b border-[#efeff2] px-5 py-4">
                  <h2 className="font-bold text-[#1b1b1f]">Invoices</h2>
                </div>
                {invoices.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-[#8c97a2]">No invoices yet.</p>
                ) : (
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[#fafafe] text-xs tracking-wide text-[#8c97a2] uppercase">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Number</th>
                        <th className="px-5 py-3 font-semibold">Issued</th>
                        <th className="px-5 py-3 font-semibold">Due</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                        <th className="px-5 py-3 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((invoice) => (
                        <tr key={invoice.id} className="border-t border-[#f4f4f8]">
                          <td className="px-5 py-3 font-semibold text-[#1b1b1f]">
                            {invoice.number}
                          </td>
                          <td className="px-5 py-3 text-[#5f6b76]">{formatDate(invoice.issued_at)}</td>
                          <td className="px-5 py-3 text-[#5f6b76]">{formatDate(invoice.due_date)}</td>
                          <td className="px-5 py-3">
                            <Pill tone={invoice.status === 'paid' ? 'good' : 'warn'}>
                              {invoice.status}
                            </Pill>
                          </td>
                          <td className="px-5 py-3 text-right font-bold text-[#1b1b1f]">
                            {formatMoneyExact(invoice.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ) : (
              <section className="overflow-hidden rounded-[20px] border border-[#efeff2] bg-white">
                <div className="border-b border-[#efeff2] px-5 py-4">
                  <h2 className="font-bold text-[#1b1b1f]">
                    {section === 'Payouts' ? 'Payouts' : 'Transactions'}
                  </h2>
                </div>
                {visibleTransactions.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-[#8c97a2]">
                    Nothing recorded yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-[#fafafe] text-xs tracking-wide text-[#8c97a2] uppercase">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Client</th>
                          <th className="px-5 py-3 font-semibold">Service</th>
                          <th className="px-5 py-3 font-semibold">Date</th>
                          <th className="px-5 py-3 font-semibold">Type</th>
                          <th className="px-5 py-3 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTransactions.map((tx) => (
                          <tr key={tx.id} className="border-t border-[#f4f4f8]">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="flex size-8 items-center justify-center rounded-full bg-[#eeeffd] text-[11px] font-bold text-[#0e2a48]">
                                  {initialsOf(tx.client_name, '—')}
                                </span>
                                <span className="font-semibold text-[#1b1b1f]">
                                  {tx.client_name ?? 'TenantVoice'}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-[#5f6b76]">
                              {tx.service_title ?? tx.description ?? '—'}
                            </td>
                            <td className="px-5 py-3 text-[#5f6b76]">{formatDate(tx.created_at)}</td>
                            <td className="px-5 py-3">
                              <Pill
                                tone={
                                  tx.type === 'payment'
                                    ? 'good'
                                    : tx.type === 'refund'
                                      ? 'bad'
                                      : 'neutral'
                                }
                              >
                                {TRANSACTION_TYPE_LABELS[tx.type] ?? tx.type}
                              </Pill>
                            </td>
                            <td className="px-5 py-3 text-right font-bold text-[#1b1b1f]">
                              {formatMoneyExact(tx.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  children: React.ReactNode;
}) {
  const map = {
    good: 'bg-[#e6f4ed] text-[#1b7c4f]',
    warn: 'bg-[#fff4e5] text-[#b86e00]',
    bad: 'bg-[#fde8e8] text-[#b42318]',
    neutral: 'bg-[#f4f4f8] text-[#5f6b76]',
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${map[tone]}`}>
      {children}
    </span>
  );
}
