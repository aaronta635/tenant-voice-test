'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  ApiError,
  safe,
  type Category,
  type Profile,
  type ProviderService,
  type ServiceProvider,
  type VerificationDocument,
} from '@/app/lib/api';

// The wizard's step copy is UI flow definition, not content — the data each
// step reads and writes comes from Supabase.
const STEPS = [
  { id: 1, title: 'Choose your category', subtitle: 'Pick the service you offer. You can change it later.' },
  { id: 2, title: 'Add fixed-price services', subtitle: 'TenantVoice runs on fixed pricing — no quote games.' },
  { id: 3, title: 'Set your service area', subtitle: 'Tell clients where you work and how far you travel.' },
  { id: 4, title: 'Verify your credentials', subtitle: "Only TenantVoice's trust team can access these documents." },
  { id: 5, title: 'Complete your public profile', subtitle: 'Bio, headline and specialties help you show up in search.' },
  { id: 6, title: 'Review & go live', subtitle: 'Check everything once, then publish to the marketplace.' },
] as const;

const DOCUMENT_TYPES: { type: VerificationDocument['type']; label: string }[] = [
  { type: 'id', label: 'Government ID' },
  { type: 'abn', label: 'ABN registration' },
  { type: 'licence', label: 'Professional licence' },
  { type: 'insurance', label: 'Public liability insurance' },
];

type DraftService = { id?: string; title: string; price: string };

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  const [documents, setDocuments] = useState<VerificationDocument[]>([]);

  const [category, setCategory] = useState('');
  const [services, setServices] = useState<DraftService[]>([{ title: '', price: '' }]);
  const [suburb, setSuburb] = useState('');
  const [radius, setRadius] = useState(15);
  const [bio, setBio] = useState('');
  const [headline, setHeadline] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const [categoryList, me, mine] = await Promise.all([
        safe(api.categories.list(), []),
        safe<Profile | null>(api.profiles.me(), null),
        safe<ServiceProvider | null>(api.providers.mine(), null),
      ]);
      const [serviceList, docs] = mine
        ? await Promise.all([
            safe<ProviderService[]>(api.providers.myServices(), []),
            safe<VerificationDocument[]>(api.providers.myDocuments(), []),
          ])
        : [[], []];

      if (!active) return;
      setCategories(categoryList);
      setProfile(me);
      setProvider(mine);
      setDocuments(docs);
      setCategory(mine?.category ?? categoryList[0]?.category ?? '');
      setServices(
        serviceList.length > 0
          ? serviceList.map((s) => ({ id: s.id, title: s.title, price: String(s.price) }))
          : [{ title: '', price: '' }],
      );
      setSuburb(me?.location ?? '');
      setRadius(mine?.service_radius_km ?? 15);
      setBio(mine?.bio ?? '');
      setHeadline(mine?.headline ?? '');
      setDisplayName(mine?.business_name ?? me?.full_name ?? '');
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const current = STEPS[step - 1];
  const progress = (step / STEPS.length) * 100;
  const verifiedTypes = useMemo(
    () => new Set(documents.filter((d) => d.status === 'verified').map((d) => d.type)),
    [documents],
  );
  const submittedTypes = useMemo(() => new Set(documents.map((d) => d.type)), [documents]);

  const canContinue = useMemo(() => {
    if (step === 1) return category.length > 0;
    if (step === 2) return services.some((s) => s.title.trim() && s.price.trim());
    if (step === 3) return suburb.trim().length > 0;
    if (step === 4) return submittedTypes.has('id') && submittedTypes.has('abn');
    if (step === 5) return displayName.trim().length > 0 && bio.trim().length > 20;
    return true;
  }, [step, category, services, suburb, submittedTypes, displayName, bio]);

  /** Persist the current step to Supabase before moving on. */
  async function persistStep(): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      let record = provider;
      if (!record) {
        record = await api.providers.createMine({ category });
        setProvider(record);
      }

      if (step === 1 && record.category !== category) {
        setProvider(await api.providers.updateMine({ category }));
      }

      if (step === 2) {
        for (const draft of services) {
          if (!draft.title.trim() || !draft.price.trim()) continue;
          const payload = { title: draft.title.trim(), price: Number(draft.price) };
          if (draft.id) await api.providers.updateService(draft.id, payload);
          else await api.providers.createService(payload);
        }
        setServices(
          (await api.providers.myServices()).map((s) => ({
            id: s.id,
            title: s.title,
            price: String(s.price),
          })),
        );
      }

      if (step === 3) {
        await api.profiles.update({ location: suburb });
        setProvider(await api.providers.updateMine({ service_radius_km: radius }));
      }

      if (step === 5) {
        setProvider(
          await api.providers.updateMine({ business_name: displayName, bio, headline }),
        );
      }

      if (step === STEPS.length) {
        setProvider(await api.providers.updateMine({ is_published: true }));
      }

      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this step.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    const ok = await persistStep();
    if (!ok) return;
    if (step < STEPS.length) setStep((s) => s + 1);
    else router.push('/dashboard/profile');
  }

  async function addDocument(type: VerificationDocument['type'], label: string) {
    setError(null);
    try {
      if (!provider) setProvider(await api.providers.createMine({ category }));
      const doc = await api.providers.addDocument({ type, label });
      setDocuments((prev) => [...prev, doc]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that document.');
    }
  }

  if (loading) return <p className="text-[#5f6b76]">Loading onboarding…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-primary">Provider onboarding</p>
          <h1 className="text-[28px] font-extrabold tracking-tight text-[#1b1b1f]">
            {current.title}
          </h1>
          <p className="mt-1 text-sm text-[#5f6b76]">{current.subtitle}</p>
        </div>
        <Link
          href="/dashboard/profile"
          className="text-sm font-semibold text-[#8c97a2] hover:text-[#1b1b1f]"
        >
          Skip for now
        </Link>
      </div>

      <div className="mb-2 flex justify-between text-xs font-semibold text-[#8c97a2]">
        <span>
          Step {step} of {STEPS.length}
        </span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="mb-8 h-2 rounded-full bg-[#eeeffd]">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      {error ? (
        <p className="mb-4 rounded-[12px] border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      <div className="rounded-[24px] border border-[#efeff2] bg-white p-6 shadow-[0_8px_24px_rgba(14,42,72,0.06)] sm:p-8">
        {step === 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {categories.map((option) => {
              const selected = category === option.category;
              return (
                <button
                  key={option.category}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCategory(option.category)}
                  className={`rounded-[16px] border px-4 py-4 text-left text-sm font-semibold transition-colors ${
                    selected
                      ? 'border-primary/40 bg-[#eeeffd] text-primary'
                      : 'border-[#efeff2] bg-[#fafafe] text-[#1b1b1f] hover:border-[#c5cad3]'
                  }`}
                >
                  {selected ? '✓ ' : ''}
                  {option.name}
                </button>
              );
            })}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            {services.map((service, index) => (
              <div key={service.id ?? index} className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <input
                  value={service.title}
                  onChange={(e) => {
                    const next = [...services];
                    next[index] = { ...next[index], title: e.target.value };
                    setServices(next);
                  }}
                  placeholder="Service name"
                  aria-label={`Service ${index + 1} name`}
                  className="h-11 rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
                />
                <div className="relative">
                  <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[#8c97a2]">
                    $
                  </span>
                  <input
                    value={service.price}
                    onChange={(e) => {
                      const next = [...services];
                      next[index] = { ...next[index], price: e.target.value };
                      setServices(next);
                    }}
                    placeholder="99"
                    inputMode="decimal"
                    aria-label={`Service ${index + 1} price`}
                    className="h-11 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] py-2 pr-3 pl-7 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setServices((s) => [...s, { title: '', price: '' }])}
              className="text-sm font-semibold text-primary"
            >
              + Add another service
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-5">
            <div>
              <label
                htmlFor="onboarding-suburb"
                className="mb-1.5 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
              >
                Base suburb
              </label>
              <input
                id="onboarding-suburb"
                value={suburb}
                onChange={(e) => setSuburb(e.target.value)}
                className="h-11 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-xs font-bold tracking-wide text-[#8c97a2] uppercase">
                <label htmlFor="onboarding-radius">Travel radius</label>
                <span className="text-primary">{radius} km</span>
              </div>
              <input
                id="onboarding-radius"
                type="range"
                min={5}
                max={50}
                step={5}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-3">
            {DOCUMENT_TYPES.map(({ type, label }) => {
              const submitted = submittedTypes.has(type);
              const verified = verifiedTypes.has(type);
              return (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-[16px] border border-[#efeff2] bg-[#fafafe] px-4 py-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#1b1b1f]">{label}</p>
                    <p className="text-xs text-[#8c97a2]">
                      {verified ? 'Verified' : submitted ? 'Pending review' : 'Not submitted'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={submitted}
                    onClick={() => addDocument(type, label)}
                    className="h-9 rounded-full bg-primary px-4 text-sm font-bold text-white disabled:bg-[#e6f4ed] disabled:text-[#1b7c4f]"
                  >
                    {submitted ? '✓ Submitted' : 'Submit'}
                  </button>
                </div>
              );
            })}
            <p className="text-xs text-[#8c97a2]">
              Submitting records the document against your profile; the trust team marks it
              verified.
            </p>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="onboarding-name"
                className="mb-1.5 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
              >
                Display name
              </label>
              <input
                id="onboarding-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-11 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label
                htmlFor="onboarding-headline"
                className="mb-1.5 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
              >
                Headline
              </label>
              <input
                id="onboarding-headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="What you do, in one line"
                className="h-11 w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label
                htmlFor="onboarding-bio"
                className="mb-1.5 block text-xs font-bold tracking-wide text-[#8c97a2] uppercase"
              >
                Public bio
              </label>
              <textarea
                id="onboarding-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={5}
                className="w-full rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-4 text-sm">
            <SummaryRow
              label="Category"
              value={categories.find((c) => c.category === category)?.name ?? '—'}
            />
            <SummaryRow
              label="Services"
              value={
                services
                  .filter((s) => s.title)
                  .map((s) => `${s.title} ($${s.price || '0'})`)
                  .join(' · ') || 'None'
              }
            />
            <SummaryRow label="Service area" value={`${suburb || '—'} · ${radius} km`} />
            <SummaryRow
              label="Documents"
              value={
                documents.map((d) => (d.label ?? d.type).toUpperCase()).join(', ') || 'None'
              }
            />
            <SummaryRow label="Public name" value={displayName || profile?.full_name || '—'} />
            <p className="rounded-[14px] bg-[#eeeffd] p-4 text-[#0e2a48]">
              Publishing makes your profile searchable on TenantVoice. You can edit anything later
              from My Profile and My Services.
            </p>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || saving}
            className="h-11 rounded-full border border-[#efeff2] px-5 text-sm font-semibold disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!canContinue || saving}
            className="h-11 rounded-full bg-primary px-6 text-sm font-bold text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : step === STEPS.length ? 'Publish profile' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-[#efeff2] bg-[#fafafe] px-4 py-3">
      <p className="text-xs font-bold tracking-wide text-[#8c97a2] uppercase">{label}</p>
      <p className="mt-1 font-semibold text-[#1b1b1f]">{value}</p>
    </div>
  );
}
