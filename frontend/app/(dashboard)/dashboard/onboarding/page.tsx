'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  api,
  ApiError,
  orNotFound,
  type Category,
  type Profile,
  type ProviderService,
  type ServiceProvider,
  type VerificationDocument,
} from '@/app/lib/api';
import FormMessage from '@/app/components/ui/FormMessage';
import OnboardingServiceRow from '@/app/components/provider/OnboardingServiceRow';
import RemoveServiceDialog from '@/app/components/provider/RemoveServiceDialog';
import VerificationDocuments from '@/app/components/provider/VerificationDocuments';
import VerificationRequired from '@/app/components/trust/VerificationRequired';
import { safeNextPath } from '@/app/lib/auth-redirect';
import { formatServicePrice } from '@/app/lib/format';
import { deleteQueuedServices, draftFromService, nextOnboardingStep, parseServiceAmount, serviceProblem, splitProviderLocation, type DraftService } from '@/app/lib/provider-workspace';
import { announceAccountChange } from '@/app/lib/provider-refresh';
import { verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';

// The wizard's step copy is UI flow definition, not content — the data each
// step reads and writes comes from Supabase.
const STEPS = [
  { id: 1, title: 'Choose your category', subtitle: 'Pick the service you offer. You can change it later.' },
  { id: 2, title: 'Add your services', subtitle: 'Set clear fixed, hourly or starting prices for clients.' },
  { id: 3, title: 'Set your service area', subtitle: 'Tell clients where you work and how far you travel.' },
  { id: 4, title: 'Verify your credentials', subtitle: "Only TenantVoice's trust team can access these documents." },
  { id: 5, title: 'Complete your public profile', subtitle: 'Your name, headline and bio help clients understand what you offer.' },
  { id: 6, title: 'Review & go live', subtitle: 'Check everything once, then publish to the marketplace.' },
] as const;
// The last step for a profile that is already public: nothing on it publishes.
const LIVE_REVIEW = { id: 6, title: 'Review your profile', subtitle: 'Your profile is live. Check everything once, then return to your profile.' } as const;

export default function OnboardingPage() {
  return <Suspense fallback={<p role="status">Loading onboarding…</p>}><Onboarding /></Suspense>;
}

function Onboarding() {
  const router = useRouter();
  const task = safeNextPath(useSearchParams().get('next'));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const [invalidRow, setInvalidRow] = useState<number | null>(null);
  const [removingRow, setRemovingRow] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Going live needs a verified provider (R18): the server's refusal of the last step.
  const [gate, setGate] = useState<VerificationRequiredDetail | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<ServiceProvider | null>(null);
  // Read once on load, so publishing on the last step doesn't flip its wording.
  const [alreadyLive, setAlreadyLive] = useState(false);
  const [documents, setDocuments] = useState<VerificationDocument[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const [category, setCategory] = useState('');
  const [services, setServices] = useState<DraftService[]>([{ title: '', price: '' }]);
  const [removedServices, setRemovedServices] = useState<DraftService[]>([]);
  const [suburb, setSuburb] = useState('');
  const [radius, setRadius] = useState(15);
  const [bio, setBio] = useState('');
  const [headline, setHeadline] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadFailed(false);
      try {
        const categoryList = await api.categories.list();
        const [me, mine] = await Promise.all([
          orNotFound<Profile | null>(api.profiles.me(), null),
          orNotFound<ServiceProvider | null>(api.providers.mine(), null),
        ]);
        const [serviceList, docs] = mine
          ? await Promise.all([
              orNotFound<ProviderService[]>(api.providers.myServices(), []),
              orNotFound<VerificationDocument[]>(api.providers.myDocuments(), []),
            ])
          : [[], []];

        if (!active) return;
        setCategories(categoryList);
        setProfile(me);
        setProvider(mine);
        setAlreadyLive(Boolean(mine?.is_published));
        setDocuments(docs);
        setCategory(mine?.category ?? '');
        setStep(nextOnboardingStep(mine, me, serviceList, docs));
        setServices(
          serviceList.length > 0
            ? serviceList.map(draftFromService)
            : [{ title: '', price: '' }],
        );
        // Shown with its state, as on the Profile page, because step 3 saves both.
        setSuburb([me?.location, me?.state].filter(Boolean).join(', '));
        setRadius(mine?.service_radius_km ?? 15);
        setBio(mine?.bio ?? '');
        // Step 5 saves the headline as the tagline too, so show the tagline an
        // older profile has rather than clear it.
        setHeadline(mine?.headline ?? mine?.tagline ?? '');
        setDisplayName(mine?.business_name ?? me?.full_name ?? '');
        setLoading(false);
      } catch (err) {
        if (!active) return;
        setLoadFailed(true);
        setError(err instanceof ApiError ? err.message : 'Could not load onboarding. Please try again.');
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const current = step === STEPS.length && alreadyLive ? LIVE_REVIEW : STEPS[step - 1];
  // A task started before sign-up, such as adding a service, resumes once
  // setup is finished or skipped. Otherwise a new provider lands on their
  // dashboard, which offers to finish setup until the profile is live, and a
  // live one reviewing their profile returns to it.
  const resumeHref = task ?? (alreadyLive ? '/dashboard/profile' : '/dashboard');
  const progress = provider?.profile_completion ?? 0;
  const canContinue = useMemo(() => {
    if (step === 1) return category.length > 0;
    if (step === 2) return services.some((s) => s.is_active !== false && s.title.trim() && s.price.trim());
    if (step === 3) return splitProviderLocation(suburb).location !== null;
    // Allow continue after any credential is submitted (ID + ABN are encouraged).
    if (step === 4) return documents.some((doc) => doc.status !== 'rejected');
    if (step === 5) return displayName.trim().length > 0 && bio.trim().length >= 10;
    return true;
  }, [step, category, services, suburb, documents, displayName, bio]);

  async function ensureProvider(): Promise<ServiceProvider> {
    if (provider) return provider;
    if (!category) throw new Error('Choose a category before continuing.');
    try {
      const created = await api.providers.createMine({
        category,
      });
      setProvider(created);
      return created;
    } catch (err) {
      // Profile may already exist from an earlier step or previous attempt.
      if (err instanceof ApiError && err.status === 409) {
        const existing = await api.providers.mine();
        setProvider(existing);
        return existing;
      }
      throw err;
    }
  }

  /** Persist the current step to Supabase before moving on. */
  async function persistStep(): Promise<boolean> {
    setSaving(true);
    setError(null);
    setGate(null);
    try {
      const record = await ensureProvider();

      if (step === 1 && record.category !== category) {
        setProvider(await api.providers.updateMine({ category }));
      }

      if (step === 2) {
        // Preserve successful row IDs immediately, so retries reuse successfully returned services.
        for (let index = 0; index < services.length; index += 1) {
          const draft = services[index];
          if (!draft.title.trim() && !draft.price.trim()) continue;
          const payload = { title: draft.title.trim(), price: parseServiceAmount(draft.price), description: draft.description?.trim() || null, pricing_type: draft.pricing_type ?? 'flat', is_active: draft.is_active ?? true };
          const saved = draft.id
            ? await api.providers.updateService(draft.id, payload)
            : await api.providers.createService(payload);
          setServices((prev) => prev.map((row, i) => i === index ? { ...row, id: saved.id, booking_count: saved.booking_count } : row));
        }
        // Deletions happen only after all remaining rows have saved. A booked
        // service comes straight back as disabled; the next Continue saves it.
        const kept = await deleteQueuedServices(removedServices, (id) => api.providers.deleteService(id), (service, restored) => {
          setRemovedServices((prev) => prev.filter((item) => item.id !== service.id));
          if (restored) setServices((prev) => [...prev, restored]);
        });
        if (kept.length > 0) {
          const one = kept.length === 1;
          setError(`${kept.map((service) => service.title).join(', ')} ${one ? 'has bookings, so it' : 'have bookings, so they'} can't be removed. ${one ? 'It is' : 'They are'} back in your list as disabled, hidden from your public profile. Select Continue to save.`);
          return false;
        }
      }

      if (step === 3) {
        // The state goes too, null when none is recognised, so an old state
        // that no longer matches the suburb is cleared.
        setProfile(await api.profiles.update(splitProviderLocation(suburb)));
        setProvider(await api.providers.updateMine({ service_radius_km: radius }));
      }

      if (step === 5) {
        const name = displayName.trim();
        const bioText = bio.trim();
        const headlineText = headline.trim();
        setProvider(
          await api.providers.updateMine({
            business_name: name,
            bio: bioText,
            headline: headlineText || null,
            tagline: headlineText || null,
          }),
        );
      }

      if (step === STEPS.length && !alreadyLive) {
        const name = displayName.trim();
        const bioText = bio.trim();
        const headlineText = headline.trim();
        setProvider(
          await api.providers.updateMine({
            business_name: name || undefined,
            bio: bioText || undefined,
            headline: headlineText || undefined,
            tagline: headlineText || undefined,
            is_published: true,
          }),
        );
      }

      setProvider(await api.providers.mine());
      announceAccountChange();
      return true;
    } catch (err) {
      const refusal = verificationRequired(err);
      if (refusal) {
        setGate(refusal);
        return false;
      }
      setError(`${err instanceof Error ? err.message : 'Could not save this step.'}${step === 2 ? ' Your draft is retained. Some rows may have saved; retry to finish the remaining changes.' : ''}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    if (saving || !canContinue) return;
    if (step === 2) {
      // Validate every row before anything is written, so a bad price can't
      // leave the earlier rows half-saved.
      // The shared rules: an enabled service needs a description and a price above $0.
      const problemOf = (s: DraftService) =>
        serviceProblem(s.title, s.price, { description: s.description ?? '', active: s.is_active !== false });
      const invalid = services.findIndex((s) => {
        if (!s.title.trim() && !s.price.trim()) return false;
        return Boolean(problemOf(s));
      });
      if (invalid >= 0) {
        const row = services[invalid];
        setInvalidRow(invalid);
        setError(`Service ${invalid + 1}: ${problemOf(row)}`);
        const field = serviceProblem(row.title, row.price, { active: row.is_active !== false })
          ? (row.title.trim() && row.title.trim().length <= 80 ? '-price' : '')
          : '-description';
        document.getElementById(`onboarding-service-${invalid}${field}`)?.focus();
        return;
      }
    }
    setInvalidRow(null);
    const ok = await persistStep();
    // A gate's refusal takes focus, so its way forward is read first; any other one leaves it on Continue.
    if (!ok) { requestAnimationFrame(() => (gateRef.current ?? continueRef.current)?.focus()); return; }
    if (step < STEPS.length) setStep((s) => s + 1);
    else router.push(resumeHref);
  }

  function removeService(index: number) {
    setServices((prev) => {
      if (prev.length <= 1) return prev;
      const target = prev[index];
      if (target?.id) {
        setRemovedServices((removed) =>
          removed.some((item) => item.id === target.id) ? removed : [...removed, target],
        );
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  function disableService(index: number) {
    setServices((prev) => prev.map((row, i) => i === index ? { ...row, is_active: false } : row));
  }

  useEffect(() => {
    if (!loading && !loadFailed) {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [step, loading, loadFailed]);

  if (loading) return <div><h1 className="font-heading text-h2 font-semibold text-text-dark">Provider onboarding</h1><p role="status">Loading onboarding…</p></div>;

  if (loadFailed) {
    return (
      <div className="max-w-lg rounded-xl border border-border bg-white shadow-sm p-8 text-center">
        <h1 className="font-heading text-h2 font-semibold text-text-dark">Provider onboarding</h1><h2 className="mt-4 text-lg font-bold">Couldn&apos;t load onboarding</h2>
        <p className="mt-2 text-sm text-[#5f6b76]">{error ?? 'Categories are unavailable right now.'}</p>
        <button
          type="button"
          className="min-h-11 mt-5 rounded-lg bg-primary-strong px-5 py-2 text-sm font-bold text-white"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <p className="text-sm font-semibold text-primary-strong">Provider onboarding</p>
          <h1 ref={headingRef} tabIndex={-1} className="font-heading text-h2 font-semibold text-text-dark scroll-mt-24">
            {current.title}
          </h1>
          <p className="mt-1 text-sm text-[#5f6b76]">{current.subtitle}</p>
        </div>
        <Link
          href={resumeHref}
          className="text-sm font-semibold text-[#5f6b76] hover:text-[#1b1b1f]"
        >
          Skip for now
        </Link>
      </div>

      <div className="mb-2 flex justify-between text-xs font-semibold text-[#5f6b76]">
        <span>
          Step {step} of {STEPS.length}
        </span>
        <span>Profile {Math.round(progress)}% complete</span>
      </div>
      <div role="progressbar" aria-label="Profile completion" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="mb-8 h-2 rounded-full border border-control-border bg-[#eeeffd]">
        <div className="h-full rounded-full bg-primary-strong transition-all forced-colors:bg-[Highlight]" style={{ width: `${progress}%` }} />
      </div>


      <div className="rounded-xl border border-border bg-white shadow-sm p-6 sm:p-8">
        <fieldset disabled={saving}>
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
                      ? 'border-primary/40 bg-[#eeeffd] text-primary-strong'
                      : 'border-control-border bg-[#fafafe] text-[#1b1b1f] hover:border-[#c5cad3]'
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
              <OnboardingServiceRow
                key={service.id ?? `draft-${index}`}
                service={service}
                index={index}
                invalid={invalidRow === index}
                canRemove={services.length > 1}
                onChange={(patch) => setServices((prev) => prev.map((row, i) => i === index ? { ...row, ...patch } : row))}
                onRemove={() => setRemovingRow(index)}
              />
            ))}
            <button
              type="button"
              onClick={() => setServices((s) => [...s, { title: '', price: '' }])}
              className="min-h-11 text-sm font-semibold text-primary-strong"
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
                className="mb-1.5 block text-xs font-bold tracking-wide text-[#5f6b76] uppercase"
              >
                Base suburb
              </label>
              <input
                id="onboarding-suburb"
                value={suburb}
                onChange={(e) => setSuburb(e.target.value)}
                className="h-11 w-full rounded-[14px] border border-control-border bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-xs font-bold tracking-wide text-[#5f6b76] uppercase">
                <label htmlFor="onboarding-radius">Travel radius</label>
                <span className="text-primary-strong">{radius} km</span>
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

        {step === 4 ? <VerificationDocuments documents={documents} enabled={Boolean(provider)} onChange={(docs) => { setDocuments(docs); void api.providers.mine().then(setProvider).catch(() => undefined); }} /> : null}

        {step === 5 ? (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="onboarding-name"
                className="mb-1.5 block text-xs font-bold tracking-wide text-[#5f6b76] uppercase"
              >
                Display name
              </label>
              <input
                id="onboarding-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-11 w-full rounded-[14px] border border-control-border bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label
                htmlFor="onboarding-headline"
                className="mb-1.5 block text-xs font-bold tracking-wide text-[#5f6b76] uppercase"
              >
                Headline
              </label>
              <input
                id="onboarding-headline"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="What you do, in one line"
                className="h-11 w-full rounded-[14px] border border-control-border bg-[#fafafe] px-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label
                htmlFor="onboarding-bio"
                className="mb-1.5 block text-xs font-bold tracking-wide text-[#5f6b76] uppercase"
              >
                Public bio
              </label>
              <textarea
                id="onboarding-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={5}
                placeholder="Tell clients what you do, where you work, and why they can trust you."
                className="w-full rounded-[14px] border border-control-border bg-[#fafafe] px-4 py-3 text-sm outline-none focus:border-primary"
              />
              <p
                className={`mt-1.5 text-xs ${
                  bio.trim().length >= 10 ? 'text-[#1b7c4f]' : 'text-[#5f6b76]'
                }`}
              >
                {bio.trim().length}/10 characters minimum
                {displayName.trim().length === 0 ? ' · Display name is required' : ''}
              </p>
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
                  .map((s) => `${s.title} (${formatServicePrice(parseServiceAmount(s.price), s.pricing_type ?? 'flat')}${s.is_active === false ? ' · Draft' : ''})`)
                  .join(' · ') || 'None'
              }
            />
            <SummaryRow label="Service area" value={`${suburb || '—'} · ${radius} km`} />
            <SummaryRow
              label="Documents"
              value={
                documents.map((d) => `${d.label ?? d.type} · ${d.status === 'verified' ? 'Verified' : d.status === 'rejected' ? 'Rejected' : 'Pending review'}`).join(', ') || 'None'
              }
            />
            <SummaryRow label="Public name" value={displayName || profile?.full_name || '—'} />
            <SummaryRow label="Headline" value={headline || "—"} />
            <SummaryRow label="Bio" value={bio || "—"} />
            <p className="rounded-[14px] bg-[#eeeffd] p-4 text-[#0e2a48]">
              {alreadyLive
                ? 'Your profile is live on TenantVoice. Keep your weekly hours under Availability up to date so clients can book real time slots.'
                : 'Publishing makes your profile searchable on TenantVoice. After you go live, set your weekly hours under Availability so clients can book real time slots.'}
            </p>
          </div>
        ) : null}

        </fieldset>
        {gate ? (
          <div ref={gateRef} tabIndex={-1} className="mt-6">
            <VerificationRequired detail={gate} />
            <p className="mt-2 text-sm text-text-body">
              Everything else is saved. Your profile goes live once your account is verified;{' '}
              <Link href={resumeHref} className="font-semibold text-primary-strong underline">finish later</Link>.
            </p>
          </div>
        ) : null}
        <div id="onboarding-service-error" className="mt-6"><FormMessage error={error} /></div>
        {!canContinue ? <p className="mt-4 text-sm text-text-muted" role="status">{step === 1 ? 'Choose a category to continue.' : step === 2 ? 'Enable at least one service with a name and price to continue.' : step === 3 ? 'Enter your base suburb to continue.' : step === 4 ? 'Submit at least one credential to continue. You can submit an ABN without a file.' : 'Add a display name and a bio of at least 10 characters to continue.'}</p> : null}
        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => { setError(null); setGate(null); setInvalidRow(null); setStep((s) => Math.max(1, s - 1)); }}
            disabled={step === 1 || saving}
            className="min-h-11 rounded-lg border border-control-border px-5 text-sm font-semibold disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            ref={continueRef}
            onClick={next}
            disabled={!canContinue || saving}
            className="min-h-11 rounded-lg bg-primary-strong px-6 text-sm font-bold text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : step < STEPS.length ? 'Continue' : alreadyLive ? 'Finish' : 'Publish profile'}
          </button>
        </div>
      </div>
      <RemoveServiceDialog
        service={removingRow !== null ? services[removingRow] ?? null : null}
        name={removingRow !== null ? services[removingRow]?.title || `Service ${removingRow + 1}` : ''}
        onClose={() => setRemovingRow(null)}
        onRemove={() => { if (removingRow !== null) removeService(removingRow); setRemovingRow(null); }}
        onDisable={() => { if (removingRow !== null) disableService(removingRow); setRemovingRow(null); }}
      />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-control-border bg-[#fafafe] px-4 py-3">
      <p className="text-xs font-bold tracking-wide text-[#5f6b76] uppercase">{label}</p>
      <p className="mt-1 font-semibold text-[#1b1b1f]">{value}</p>
    </div>
  );
}
