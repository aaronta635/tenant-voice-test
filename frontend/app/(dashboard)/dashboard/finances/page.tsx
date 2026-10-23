'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import DemoLabel from '@/app/components/demo/DemoLabel';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import StatCard from '@/app/components/ui/StatCard';
import EmptyState from '@/app/components/ui/EmptyState';
import FilterChip from '@/app/components/ui/FilterChip';
import PageHeader from '@/app/components/ui/PageHeader';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { api, ApiError, orNotFound, type Invoice, type ProviderFinance, type Transaction } from '@/app/lib/api';
import { formatDate, formatMoneyExact, formatPercent, initialsOf, TRANSACTION_TYPE_LABELS } from '@/app/lib/format';
import { shownCount, usePrinting, visibleRows } from '@/app/lib/provider-print';

const SECTIONS = [{ key: 'overview', label: 'Overview' }, { key: 'transactions', label: 'Transactions' }, { key: 'invoices', label: 'Invoices' }, { key: 'payouts', label: 'Payout records' }] as const;
const INVOICE_STATUS = { draft: 'Draft', issued: 'Awaiting payment', paid: 'Paid', void: 'Void' };

function monthLabel(value: string) {
  const date = new Date(`${value}-01T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-AU', { timeZone: 'UTC', month: 'short', year: 'numeric' });
}

export default function FinancesPage() {
  return <Suspense fallback={<p role="status">Loading finances…</p>}><FinancesContent /></Suspense>;
}

function FinancesContent() {
  const searchParams = useSearchParams();
  const section = SECTIONS.find(item => item.key === searchParams.get('section'))?.key ?? 'overview';
  const [months, setMonths] = useState(6);
  const [finance, setFinance] = useState<ProviderFinance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const limit = limits[section] ?? 15;
  const printing = usePrinting();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [summary, txns, inv] = await Promise.all([
          orNotFound<ProviderFinance | null>(api.dashboard.providerFinance(), null),
          orNotFound(api.finance.transactions(), []), orNotFound(api.finance.invoices(), []),
        ]);
        if (!active) return;
        setFinance(summary); setTransactions(txns); setInvoices(inv);
      } catch (error) {
        if (active) setLoadError(error instanceof ApiError ? error.message : 'Could not load your finances.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [reloadKey]);

  const points = (finance?.monthly ?? []).slice(-months);
  const peak = Math.max(0, ...points.map(point => Math.abs(point.amount)));
  const displayedTransactions = section === 'payouts' ? transactions.filter(transaction => transaction.type === 'payout') : transactions;
  // A printout lists every record, not just those revealed with "Load more".
  const shownInvoices = visibleRows(invoices, limit, printing);
  const shownTransactions = visibleRows(displayedTransactions, limit, printing);
  const cards = finance ? [
    { label: 'Ledger balance', value: finance.available_balance },
    { label: 'Earned this month', value: finance.month_earnings },
    { label: 'Pending booking value', value: finance.pending_payments },
    { label: 'Simulated payouts', value: finance.total_payouts },
  ] : [];

  return <div className="space-y-6">
    <PageHeader title="Finances" description="Review your booking income, fees and invoice records." />
    <DemoLabel variant="notice" reason="Simulated ledger: bookings record payments, fees and payouts here, but TenantVoice does not charge, hold or transfer money. Payout records are not bank transfers." />
    <nav aria-label="Finance sections" className="flex flex-wrap gap-2 print:hidden">{SECTIONS.map(item => <FilterChip key={item.key} href={`/dashboard/finances?section=${item.key}`} scroll={false} selected={section === item.key}>{item.label}</FilterChip>)}</nav>
    {loading ? <p role="status" className="text-sm text-text-body">Loading your ledger…</p> : loadError ? <LoadErrorCard message={loadError} onRetry={() => { setLoading(true); setLoadError(null); setReloadKey(value => value + 1); }} /> : !finance ? <EmptyState title="No provider profile yet" description="Finish onboarding to start recording bookings and viewing the ledger." action={<Link href="/dashboard/onboarding" className="font-semibold text-primary-strong underline">Start onboarding</Link>} /> : section === 'overview' ? <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map(card => <StatCard key={card.label} label={card.label} value={formatMoneyExact(card.value)} />)}</div>
      <Card className="min-w-0 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-lg font-semibold">Monthly net earnings</h2><div role="group" aria-label="Earnings period" className="flex gap-2 print:hidden">{[3,6,12].map(count => <FilterChip key={count} selected={months === count} onClick={() => setMonths(count)}>{count}m</FilterChip>)}</div></div>
        {peak === 0 ? <p className="mt-5 text-sm text-text-body">No payments recorded in this period. Completed bookings appear here.</p> : <ul aria-label="Monthly earnings, in Australian dollars" className="mt-6 space-y-3">{points.map(point => <li key={point.month} className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2 text-xs sm:text-sm"><span className="text-text-body">{monthLabel(point.month)}</span><div aria-hidden="true" className="min-w-0"><div className={`h-5 rounded border border-current ${point.amount < 0 ? 'bg-danger text-danger' : 'bg-primary-strong text-primary-strong'}`} style={{ width: `${Math.abs(point.amount) / peak * 100}%` }} /></div><span className="whitespace-nowrap font-semibold tabular-nums">{formatMoneyExact(point.amount)}</span></li>)}</ul>}
        <p className="mt-5 text-sm text-text-body">Year to date {formatMoneyExact(finance.ytd_earnings)} · Lifetime {formatMoneyExact(finance.lifetime_earnings)} after fees and refunds{finance.yoy_change_pct === null ? '' : ` · ${formatPercent(finance.yoy_change_pct)} year on year`}</p>
      </Card>
    </> : section === 'invoices' ? <section aria-labelledby="invoices-heading">
      <h2 id="invoices-heading" className="mb-4 font-heading text-lg font-semibold">Invoices</h2>
      {invoices.length === 0 ? <EmptyState title="No invoices yet" description="Invoice records for your bookings will appear here." /> : <Card className="divide-y divide-border">{shownInvoices.map(invoice => <article key={invoice.id} className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{invoice.number}</h3><p className="mt-2 text-sm text-text-body">{invoice.status === 'draft' ? `Created ${formatDate(invoice.created_at)}` : `Issued ${formatDate(invoice.issued_at)}`} · Due {formatDate(invoice.due_date)}</p><p className="mt-2"><Pill tone={invoice.status === 'paid' ? 'good' : invoice.status === 'issued' ? 'warn' : 'neutral'}>{INVOICE_STATUS[invoice.status]}</Pill></p></div>
        <div className="flex shrink-0 flex-col items-end gap-2"><p className="font-bold tabular-nums">{formatMoneyExact(invoice.amount)}</p><Link className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline" href={`/dashboard/finances/invoices/${invoice.id}`} aria-label={`View invoice ${invoice.number}`}>View invoice</Link></div>
      </article>)}</Card>}
      {invoices.length > limit ? <Button className="mt-4 print:hidden" variant="secondary" onClick={() => setLimits(previous => ({ ...previous, [section]: limit + 15 }))}>Load more invoices</Button> : null}
      {invoices.length > 0 ? <p role="status" className="mt-3 text-sm text-text-body">{shownCount(shownInvoices.length, invoices.length, 'invoice')}</p> : null}
    </section> : <section aria-labelledby="transactions-heading">
      <h2 id="transactions-heading" className="mb-4 font-heading text-lg font-semibold">{section === 'payouts' ? 'Simulated payout records' : 'Transactions'}</h2>
      {displayedTransactions.length === 0 ? <EmptyState title="Nothing recorded yet" description="Records will appear here when booking activity is added to the ledger." /> : <Card className="divide-y divide-border">{shownTransactions.map(transaction => {
        const person = transaction.client_name ?? (transaction.type === 'platform_fee' || transaction.type === 'payout' ? 'TenantVoice' : 'Unlinked payment');
        return <article key={transaction.id} className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 flex-1 items-center gap-3"><span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold text-primary-strong">{initialsOf(person,'—')}</span><div className="min-w-0"><p className="text-xs text-text-body">From / to</p><h3 className="break-words font-semibold">{person}</h3></div></div><p className={`shrink-0 whitespace-nowrap font-bold tabular-nums ${transaction.type === 'payment' ? 'text-success' : 'text-text-dark'}`}>{transaction.type === 'payment' ? '+' : '−'}{formatMoneyExact(transaction.amount)}</p></div><p className="mt-3 break-words text-sm text-text-body"><span className="sr-only">Description: </span>{transaction.service_title ?? transaction.description ?? 'Unlinked ledger entry'}</p><div className="mt-3 flex flex-wrap items-center gap-3"><time dateTime={transaction.created_at} className="whitespace-nowrap text-sm text-text-body">{formatDate(transaction.created_at)}</time><Pill tone={transaction.type === 'payment' ? 'good' : transaction.type === 'refund' ? 'bad' : 'neutral'}>{transaction.type === 'payout' ? 'Simulated payout' : TRANSACTION_TYPE_LABELS[transaction.type] ?? transaction.type}</Pill></div></article>;
      })}</Card>}
      {displayedTransactions.length > limit ? <Button className="mt-4 print:hidden" variant="secondary" onClick={() => setLimits(previous => ({ ...previous, [section]: limit + 15 }))}>Load more transactions</Button> : null}
      <p role="status" className="mt-3 text-sm text-text-body">{shownCount(shownTransactions.length, displayedTransactions.length, 'record')}</p>
    </section>}
  </div>;
}

function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: React.ReactNode }) {
  const styles = { good: 'border-success bg-success/10 text-success', warn: 'border-warning bg-[#fff4e5] text-warning', bad: 'border-danger bg-danger/10 text-danger', neutral: 'border-border bg-background text-text-body' };
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${styles[tone]}`}>{children}</span>;
}
