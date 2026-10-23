'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import DocumentsPanel from '@/app/components/documents/DocumentsPanel';
import InformationUse from '@/app/components/onboarding/InformationUse';
import TenantCompletion from '@/app/components/onboarding/TenantCompletion';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';
import FormMessage from '@/app/components/ui/FormMessage';
import Input from '@/app/components/ui/Input';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { buttonClassName } from '@/app/components/ui/button-styles';
import LegacyProfileOffer from '@/app/components/tenant/LegacyProfileOffer';
import ProfileSettingsForm from '@/app/components/profile/ProfileSettingsForm';
import { ApiError } from '@/app/lib/api';
import {
  BOND_ANSWERS,
  changedFields,
  EMPLOYMENT_TYPES,
  isEmail,
  isPhone,
  isPostcode,
  moveInRange,
  numberOrNull,
  numberText,
  placeList,
  PROPERTY_TYPES,
  sydneyToday,
  TENANT_QUALITIES,
  textOrNull,
  updateMyProfile,
  WORKING_TYPES,
  type BondReturned,
  type EmploymentType,
  type MyProfile,
  type MyProfileUpdate,
  type PropertyType,
  type QualityTag,
  type RentalHistoryEntry,
  type RentalHistoryInput,
  type TenantDetails,
} from '@/app/lib/my-profile';
import { useMyProfile } from '@/app/lib/use-my-profile';
import type { TenantScreen } from '@/app/lib/tenant-data';
import { DefaultSide, PageFrame } from '@/app/components/tenant/TenantPageFrame';

export default function TenantFormScreens({ screen }: { screen: TenantScreen }) {
  if (screen.slug === 'personal-information') return <PersonalInformationScreen screen={screen} />;
  if (screen.slug === 'contact-details') return <ContactDetailsScreen screen={screen} />;
  if (screen.slug === 'financial-information') return <FinancialInformationScreen screen={screen} />;
  if (screen.slug === 'rental-preferences') return <RentalPreferencesScreen screen={screen} />;
  if (screen.slug === 'upload-passport') return <DocumentUploadScreen screen={screen} kind="passport" />;
  if (screen.slug === 'id-verification') return <DocumentUploadScreen screen={screen} kind="id" />;
  if (screen.slug === 'address-history') return <AddressHistoryScreen screen={screen} />;
  if (screen.slug === 'tenant-qualities') return <TenantQualitiesScreen screen={screen} />;
  if (screen.slug === 'settings') return <SettingsScreen screen={screen} />;
  return <PersonalInformationScreen screen={screen} />;
}

const CARD = 'rounded-[16px] border border-[#dee1e6] p-6';
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.8px] text-[#565d6d]';
const CONTROL =
  'mt-1.5 w-full min-w-0 rounded-lg border border-control-border bg-white p-3 text-sm text-text-dark '
  + 'focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';
const FALLBACK_ERROR = 'Could not save your details. Please try again.';

type Saved = (profile: MyProfile) => void;

/**
 * A tenant profile page: the details saved to the account, loaded for the
 * page's forms, with the offer to move what an older build kept in this
 * browser. Nothing is read from or written to localStorage here.
 */
function TenantProfileScreen({
  screen,
  side,
  children,
}: {
  screen: TenantScreen;
  side?: ReactNode;
  children: (profile: MyProfile, tenant: TenantDetails, onSaved: Saved) => ReactNode;
}) {
  const { profile, setProfile, loading, error, retry } = useMyProfile();
  // Bumped when the offer saves older details, so the forms start again from them.
  const [revision, setRevision] = useState(0);
  // Bumped by every save, so the side panel reads the profile again (its completion moves).
  const [saves, setSaves] = useState(0);

  function saved(next: MyProfile) {
    setProfile(next);
    setSaves((count) => count + 1);
  }

  let body: ReactNode;
  if (loading) {
    body = <p role="status" className="text-sm text-text-body">Loading your details…</p>;
  } else if (error || !profile) {
    body = <LoadErrorCard title="Your details could not be loaded" message={error ?? undefined} onRetry={retry} />;
  } else if (!profile.tenant) {
    body = (
      <Card className={CARD}>
        <p className="text-sm text-text-body">These details are part of a tenant account.</p>
      </Card>
    );
  } else {
    body = (
      <>
        <LegacyProfileOffer
          profile={profile}
          onSaved={(next) => {
            saved(next);
            setRevision((count) => count + 1);
          }}
        />
        <Fragment key={revision}>{children(profile, profile.tenant, saved)}</Fragment>
      </>
    );
  }
  return (
    <PageFrame screen={screen} side={<Fragment key={saves}>{side ?? <DefaultSide />}</Fragment>}>
      {body}
    </PageFrame>
  );
}

/** A form's save: its saving, saved and error states, and the profile the server sends back. */
function useSave(onSaved: Saved) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: MyProfileUpdate, done = 'Saved to your account.'): Promise<MyProfile | null> {
    setSaving(true);
    setSaved(null);
    setError(null);
    try {
      const profile = await updateMyProfile(patch);
      onSaved(profile);
      setSaved(done);
      return profile;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : FALLBACK_ERROR);
      return null;
    } finally {
      setSaving(false);
    }
  }

  return {
    status: { saving, saved, error },
    save,
    /** A problem found before saving, shown like the server's. */
    refuse: (problem: string) => {
      setSaved(null);
      setError(problem);
    },
    /** Nothing changed since the last save. */
    unchanged: () => {
      setError(null);
      setSaved('No changes to save.');
    },
    /** The form changed since it was saved. */
    edited: () => setSaved(null),
  };
}

/**
 * A form's fields, and the values the server holds for them. A save sends
 * only what changed (changedFields), so a value stored before today's checks
 * or by another app, such as an old move-in date, never blocks the rest.
 */
function useDraft<F extends object, V extends object>(initial: () => F, valuesOf: (form: F) => V) {
  const [form, setForm] = useState(initial);
  const [stored, setStored] = useState(() => valuesOf(initial()));
  return {
    form,
    update: (patch: Partial<F>) => setForm((current) => ({ ...current, ...patch })),
    changes: () => changedFields(stored, valuesOf(form)),
    /** The form and the stored values, as the server now holds them. */
    reset: (next: F) => {
      setForm(next);
      setStored(valuesOf(next));
    },
  };
}

/** The defined fields of an object: those a change set holds. */
function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function SaveBar({
  saving,
  saved,
  error,
  label = 'Save changes',
}: {
  saving: boolean;
  saved: string | null;
  error: string | null;
  label?: string;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const wasSaving = useRef(false);

  useEffect(() => {
    // The disabled button drops focus while it saves; give it back after.
    if (wasSaving.current && !saving && document.activeElement === document.body) button.current?.focus();
    wasSaving.current = saving;
  }, [saving]);

  return (
    <>
      <FormMessage error={error} success={saved} className="mt-4" />
      <div className="mt-6 flex justify-end">
        <button
          ref={button}
          type="submit"
          disabled={saving}
          className={buttonClassName({ className: 'h-10 rounded-[8px]' })}
        >
          {saving ? 'Saving…' : label}
        </button>
      </div>
    </>
  );
}

function TextArea({
  id,
  label,
  hint,
  value,
  maxLength,
  rows = 4,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  maxLength: number;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-text-body">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={CONTROL}
      />
    </div>
  );
}

function CheckboxGroup<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
}) {
  function toggle(option: T, on: boolean) {
    const chosen = new Set(value);
    if (on) chosen.add(option);
    else chosen.delete(option);
    onChange(options.map((item) => item.value).filter((item) => chosen.has(item)));
  }

  return (
    <fieldset className="mt-5 min-w-0">
      <legend className={LABEL}>{legend}</legend>
      {hint ? <p className="mt-1 text-xs text-text-body">{hint}</p> : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 items-center gap-3 rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark"
          >
            <input
              type="checkbox"
              checked={value.includes(option.value)}
              onChange={(event) => toggle(option.value, event.target.checked)}
              className="size-4 shrink-0 accent-primary-strong"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Profile completion: worked out by the server, shown by components/onboarding
// ---------------------------------------------------------------------------
export function ProfileCompletionScreen({ screen }: { screen: TenantScreen }) {
  return (
    <TenantProfileScreen screen={screen} side={<InformationUse role="tenant" />}>
      {(profile) => <TenantCompletion profile={profile} />}
    </TenantProfileScreen>
  );
}

// ---------------------------------------------------------------------------
// Personal information
// ---------------------------------------------------------------------------
function PersonalInformationScreen({ screen }: { screen: TenantScreen }) {
  return (
    <TenantProfileScreen screen={screen}>
      {(profile, tenant, onSaved) => <PersonalInformationForm profile={profile} tenant={tenant} onSaved={onSaved} />}
    </TenantProfileScreen>
  );
}

type FormProps = { profile: MyProfile; tenant: TenantDetails; onSaved: Saved };

function personalForm(profile: MyProfile, tenant: TenantDetails) {
  return { full_name: profile.full_name, phone: profile.phone ?? '', about_me: tenant.about_me ?? '' };
}

function personalValues(form: ReturnType<typeof personalForm>) {
  return { full_name: form.full_name.trim(), phone: textOrNull(form.phone), about_me: textOrNull(form.about_me) };
}

function PersonalInformationForm({ profile, tenant, onSaved }: FormProps) {
  const draft = useDraft(() => personalForm(profile, tenant), personalValues);
  const { form } = draft;
  const { status, save, refuse, unchanged, edited } = useSave(onSaved);

  function change(key: keyof typeof form, value: string) {
    draft.update({ [key]: value });
    edited();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { about_me: aboutMe, ...account } = draft.changes();
    if (account.full_name === '') return refuse('Enter your full name.');
    if (account.phone && !isPhone(account.phone)) return refuse('Enter a phone number of 6 to 15 digits.');
    if (aboutMe === undefined && Object.keys(account).length === 0) return unchanged();
    const saved = await save({ ...account, ...(aboutMe === undefined ? {} : { tenant: { about_me: aboutMe } }) });
    if (saved?.tenant) draft.reset(personalForm(saved, saved.tenant));
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className={CARD}>
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            label="Full name"
            autoComplete="name"
            required
            maxLength={120}
            value={form.full_name}
            onChange={(e) => change('full_name', e.target.value)}
          />
          <Input label="Email" value={profile.email ?? ''} readOnly />
          <Input
            label="Phone"
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={form.phone}
            onChange={(e) => change('phone', e.target.value)}
          />
        </div>
        <TextArea
          id="tenant-about-me"
          label="About me"
          hint="Shown on your public profile. A few lines on how you rent and live."
          rows={5}
          maxLength={2000}
          value={form.about_me}
          onChange={(value) => change('about_me', value)}
        />
        <SaveBar {...status} />
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Contact details and the emergency contact
// ---------------------------------------------------------------------------
function ContactDetailsScreen({ screen }: { screen: TenantScreen }) {
  return (
    <TenantProfileScreen screen={screen}>
      {(profile, tenant, onSaved) => <ContactDetailsForm profile={profile} tenant={tenant} onSaved={onSaved} />}
    </TenantProfileScreen>
  );
}

function contactForm(profile: MyProfile, tenant: TenantDetails) {
  const contact = tenant.emergency_contact;
  return {
    phone: profile.phone ?? '',
    location: profile.location ?? '',
    state: profile.state ?? '',
    postcode: profile.postcode ?? '',
    emergency_name: contact.name ?? '',
    emergency_relationship: contact.relationship ?? '',
    emergency_phone: contact.phone ?? '',
    emergency_email: contact.email ?? '',
  };
}

function contactValues(form: ReturnType<typeof contactForm>) {
  return {
    phone: textOrNull(form.phone),
    location: textOrNull(form.location),
    state: textOrNull(form.state),
    postcode: textOrNull(form.postcode),
    emergency_name: textOrNull(form.emergency_name),
    emergency_relationship: textOrNull(form.emergency_relationship),
    emergency_phone: textOrNull(form.emergency_phone),
    emergency_email: textOrNull(form.emergency_email),
  };
}

/**
 * What the server would refuse among the changed values. Once any of the
 * emergency contact changed, it needs a name and a way to reach them, as the
 * server checks the whole contact.
 */
function contactProblem(values: ReturnType<typeof contactValues>, changes: Partial<typeof values>): string | null {
  if (changes.phone && !isPhone(changes.phone)) return 'Enter a phone number of 6 to 15 digits.';
  if (changes.postcode && !isPostcode(changes.postcode)) return 'Enter a 4-digit postcode.';
  if (changes.emergency_phone && !isPhone(changes.emergency_phone)) {
    return "Enter your emergency contact's phone number, 6 to 15 digits.";
  }
  if (changes.emergency_email && !isEmail(changes.emergency_email)) return "Enter your emergency contact's email address.";
  const contactChanged = ['emergency_name', 'emergency_relationship', 'emergency_phone', 'emergency_email']
    .some((key) => key in changes);
  if (!contactChanged) return null;
  const reachable = Boolean(values.emergency_phone || values.emergency_email);
  if (!values.emergency_name && (reachable || values.emergency_relationship)) return "Add your emergency contact's name.";
  if (values.emergency_name && !reachable) return 'Add a phone number or email for your emergency contact.';
  return null;
}

function ContactDetailsForm({ profile, tenant, onSaved }: FormProps) {
  const draft = useDraft(() => contactForm(profile, tenant), contactValues);
  const { form } = draft;
  const { status, save, refuse, unchanged, edited } = useSave(onSaved);

  function change(key: keyof typeof form, value: string) {
    draft.update({ [key]: value });
    edited();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = draft.changes();
    if (Object.keys(changes).length === 0) return unchanged();
    const problem = contactProblem(contactValues(form), changes);
    if (problem) return refuse(problem);
    const { emergency_name: name, emergency_relationship: relationship, emergency_phone: phone,
      emergency_email: email, ...account } = changes;
    const contact = defined({ name, relationship, phone, email });
    const saved = await save({
      ...account,
      ...(Object.keys(contact).length ? { tenant: { emergency_contact: contact } } : {}),
    });
    if (saved?.tenant) draft.reset(contactForm(saved, saved.tenant));
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className={CARD}>
        <div className="grid gap-5 md:grid-cols-2">
          <Input label="Email" value={profile.email ?? ''} readOnly />
          <Input
            label="Phone"
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={form.phone}
            onChange={(e) => change('phone', e.target.value)}
          />
          <Input
            label="Suburb"
            autoComplete="address-level2"
            maxLength={80}
            value={form.location}
            onChange={(e) => change('location', e.target.value)}
          />
          <Input
            label="State"
            autoComplete="address-level1"
            maxLength={40}
            value={form.state}
            onChange={(e) => change('state', e.target.value)}
          />
          <Input
            label="Postcode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            value={form.postcode}
            onChange={(e) => change('postcode', e.target.value)}
          />
        </div>
        <p className="mt-3 text-xs text-text-body">
          Your suburb and state show on your public profile; your phone, email and postcode never do.
        </p>
        <h2 className="mt-8 font-heading text-lg font-semibold text-text-dark">Emergency contact</h2>
        <p className="mt-1 text-sm text-text-body">
          Only you can see your emergency contact. It is never shown to owners.
        </p>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <Input
            label="Their full name"
            maxLength={120}
            value={form.emergency_name}
            onChange={(e) => change('emergency_name', e.target.value)}
          />
          <Input
            label="Relationship"
            placeholder="Parent, sibling, friend"
            maxLength={60}
            value={form.emergency_relationship}
            onChange={(e) => change('emergency_relationship', e.target.value)}
          />
          <Input
            label="Their phone"
            type="tel"
            maxLength={30}
            value={form.emergency_phone}
            onChange={(e) => change('emergency_phone', e.target.value)}
          />
          <Input
            label="Their email"
            type="email"
            maxLength={254}
            value={form.emergency_email}
            onChange={(e) => change('emergency_email', e.target.value)}
          />
        </div>
        <SaveBar {...status} />
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Employment and income
// ---------------------------------------------------------------------------
function FinancialInformationScreen({ screen }: { screen: TenantScreen }) {
  return (
    <TenantProfileScreen screen={screen}>
      {(_profile, tenant, onSaved) => <FinancialInformationForm tenant={tenant} onSaved={onSaved} />}
    </TenantProfileScreen>
  );
}

function employmentForm(tenant: TenantDetails) {
  const employment = tenant.employment;
  return {
    types: employment.types,
    employer: employment.employer ?? '',
    job_title: employment.job_title ?? '',
    annual_income: numberText(employment.annual_income),
    notes: employment.notes ?? '',
  };
}

function employmentValues(form: ReturnType<typeof employmentForm>) {
  return {
    types: form.types,
    employer: textOrNull(form.employer),
    job_title: textOrNull(form.job_title),
    annual_income: numberOrNull(form.annual_income),
    notes: textOrNull(form.notes),
  };
}

function FinancialInformationForm({ tenant, onSaved }: { tenant: TenantDetails; onSaved: Saved }) {
  const draft = useDraft(() => employmentForm(tenant), employmentValues);
  const { form } = draft;
  const { status, save, refuse, unchanged, edited } = useSave(onSaved);
  const working = form.types.some((type) => WORKING_TYPES.includes(type));

  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    draft.update({ [key]: value } as Partial<typeof form>);
    edited();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = draft.changes();
    if (Object.keys(changes).length === 0) return unchanged();
    const income = changes.annual_income;
    if (income != null && !(income >= 0 && income <= 10_000_000)) {
      return refuse('Enter your annual income in dollars, up to 10,000,000.');
    }
    const saved = await save({ tenant: { employment: changes } });
    if (saved?.tenant) draft.reset(employmentForm(saved.tenant));
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className={CARD}>
        <p className="text-sm text-text-body">Only you can see your employment and income.</p>
        <CheckboxGroup<EmploymentType>
          legend="Employment"
          hint="Choose every one that applies."
          options={EMPLOYMENT_TYPES}
          value={form.types}
          onChange={(types) => change('types', types)}
        />
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Input
            label={working ? 'Employer or business' : 'Employer or business (if any)'}
            autoComplete="organization"
            maxLength={120}
            value={form.employer}
            onChange={(e) => change('employer', e.target.value)}
          />
          <Input
            label="Job title"
            autoComplete="organization-title"
            maxLength={120}
            value={form.job_title}
            onChange={(e) => change('job_title', e.target.value)}
          />
          <Input
            label="Annual income"
            type="number"
            min={0}
            max={10_000_000}
            step={1}
            inputMode="numeric"
            placeholder="85000"
            value={form.annual_income}
            onChange={(e) => change('annual_income', e.target.value)}
          />
        </div>
        <TextArea
          id="tenant-employment-notes"
          label="Supporting notes"
          maxLength={1000}
          value={form.notes}
          onChange={(value) => change('notes', value)}
        />
        <SaveBar {...status} />
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Rental preferences and the household
// ---------------------------------------------------------------------------
function RentalPreferencesScreen({ screen }: { screen: TenantScreen }) {
  return (
    <TenantProfileScreen screen={screen}>
      {(_profile, tenant, onSaved) => (
        <div className="space-y-6">
          <PreferencesForm tenant={tenant} onSaved={onSaved} />
          <HouseholdForm tenant={tenant} onSaved={onSaved} />
        </div>
      )}
    </TenantProfileScreen>
  );
}

function preferencesForm(tenant: TenantDetails) {
  const preferences = tenant.rental_preferences;
  return {
    budget_min: numberText(tenant.budget_min),
    budget_max: numberText(tenant.budget_max),
    preferred_locations: tenant.preferred_locations.join(', '),
    move_in_date: tenant.move_in_date ?? '',
    property_types: preferences.property_types,
    bedrooms_min: numberText(preferences.bedrooms_min),
    bathrooms_min: numberText(preferences.bathrooms_min),
    parking_min: numberText(preferences.parking_min),
    notes: preferences.notes ?? '',
  };
}

function preferencesValues(form: ReturnType<typeof preferencesForm>) {
  return {
    budget_min: numberOrNull(form.budget_min),
    budget_max: numberOrNull(form.budget_max),
    preferred_locations: placeList(form.preferred_locations),
    move_in_date: form.move_in_date || null,
    property_types: form.property_types,
    bedrooms_min: numberOrNull(form.bedrooms_min),
    bathrooms_min: numberOrNull(form.bathrooms_min),
    parking_min: numberOrNull(form.parking_min),
    notes: textOrNull(form.notes),
  };
}

/** What the server would refuse among the changed values; the budget is checked whole once either end changed. */
function preferencesProblem(values: ReturnType<typeof preferencesValues>, changes: Partial<typeof values>): string | null {
  if ('budget_min' in changes || 'budget_max' in changes) {
    const { budget_min: low, budget_max: high } = values;
    for (const budget of [low, high]) {
      if (budget != null && !(budget >= 0 && budget <= 20_000)) return 'Enter a weekly budget from $0 to $20,000.';
    }
    if (low != null && high != null && low > high) return "The minimum budget can't be more than the maximum.";
  }
  const places = changes.preferred_locations ?? [];
  if (places.length > 10) return 'Choose up to 10 suburbs.';
  if (places.some((place) => place.length > 80)) return 'Each suburb can be up to 80 characters.';
  for (const count of [changes.bedrooms_min, changes.bathrooms_min, changes.parking_min]) {
    if (count != null && !(Number.isInteger(count) && count >= 0 && count <= 10)) {
      return 'Enter a whole number of rooms from 0 to 10.';
    }
  }
  const { min, max } = moveInRange();
  if (changes.move_in_date && !(changes.move_in_date >= min && changes.move_in_date <= max)) {
    return 'Choose a move-in date between a year ago and two years from today.';
  }
  return null;
}

function PreferencesForm({ tenant, onSaved }: { tenant: TenantDetails; onSaved: Saved }) {
  const draft = useDraft(() => preferencesForm(tenant), preferencesValues);
  const { form } = draft;
  const { status, save, refuse, unchanged, edited } = useSave(onSaved);
  const { min, max } = moveInRange();

  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    draft.update({ [key]: value } as Partial<typeof form>);
    edited();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = draft.changes();
    if (Object.keys(changes).length === 0) return unchanged();
    const problem = preferencesProblem(preferencesValues(form), changes);
    if (problem) return refuse(problem);
    const { property_types, bedrooms_min, bathrooms_min, parking_min, notes, ...columns } = changes;
    const preferences = defined({ property_types, bedrooms_min, bathrooms_min, parking_min, notes });
    const saved = await save({
      tenant: { ...columns, ...(Object.keys(preferences).length ? { rental_preferences: preferences } : {}) },
    });
    if (saved?.tenant) draft.reset(preferencesForm(saved.tenant));
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="tenant-preferences-title">
      <Card className={CARD}>
        <h2 id="tenant-preferences-title" className="font-heading text-lg font-semibold text-text-dark">
          What you are looking for
        </h2>
        <p className="mt-1 text-sm text-text-body">
          Your weekly budget, suburbs and move-in month show on your public profile.
        </p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Input
            label="Minimum weekly budget ($)"
            type="number"
            min={0}
            max={20_000}
            inputMode="numeric"
            value={form.budget_min}
            onChange={(e) => change('budget_min', e.target.value)}
          />
          <Input
            label="Maximum weekly budget ($)"
            type="number"
            min={0}
            max={20_000}
            inputMode="numeric"
            value={form.budget_max}
            onChange={(e) => change('budget_max', e.target.value)}
          />
          <Input
            label="Preferred suburbs"
            placeholder="Newtown, Glebe"
            value={form.preferred_locations}
            aria-describedby="tenant-suburbs-hint"
            onChange={(e) => change('preferred_locations', e.target.value)}
          />
          <Input
            label="Preferred move-in date"
            type="date"
            min={min}
            max={max}
            value={form.move_in_date}
            onChange={(e) => change('move_in_date', e.target.value)}
          />
        </div>
        <p id="tenant-suburbs-hint" className="mt-2 text-xs text-text-body">
          Separate suburbs with commas, up to 10.
        </p>
        <CheckboxGroup<PropertyType>
          legend="Property types"
          options={PROPERTY_TYPES}
          value={form.property_types}
          onChange={(types) => change('property_types', types)}
        />
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <Input
            label="Bedrooms (at least)"
            type="number"
            min={0}
            max={10}
            inputMode="numeric"
            value={form.bedrooms_min}
            onChange={(e) => change('bedrooms_min', e.target.value)}
          />
          <Input
            label="Bathrooms (at least)"
            type="number"
            min={0}
            max={10}
            inputMode="numeric"
            value={form.bathrooms_min}
            onChange={(e) => change('bathrooms_min', e.target.value)}
          />
          <Input
            label="Car spaces (at least)"
            type="number"
            min={0}
            max={10}
            inputMode="numeric"
            value={form.parking_min}
            onChange={(e) => change('parking_min', e.target.value)}
          />
        </div>
        <TextArea
          id="tenant-preference-notes"
          label="Anything else you need"
          hint="Only you can see this."
          rows={3}
          maxLength={1000}
          value={form.notes}
          onChange={(value) => change('notes', value)}
        />
        <SaveBar {...status} label="Save preferences" />
      </Card>
    </form>
  );
}

type MemberDraft = { key: string; name: string; age: string; relationship: string };

function householdForm(tenant: TenantDetails) {
  return {
    household_size: numberText(tenant.household_size),
    has_pets: tenant.has_pets,
    pets: tenant.household.pets ?? '',
    members: tenant.household.members.map((member, index): MemberDraft => ({
      key: `stored-${index}`,
      name: member.name,
      age: numberText(member.age),
      relationship: member.relationship ?? '',
    })),
  };
}

function householdValues(form: ReturnType<typeof householdForm>) {
  return {
    household_size: numberOrNull(form.household_size),
    has_pets: form.has_pets,
    pets: form.has_pets ? textOrNull(form.pets) : null,
    members: form.members.map((member) => ({
      name: member.name.trim(),
      age: numberOrNull(member.age),
      relationship: textOrNull(member.relationship),
    })),
  };
}

function householdProblem(changes: Partial<ReturnType<typeof householdValues>>): string | null {
  const size = changes.household_size;
  if (size != null && !(Number.isInteger(size) && size >= 1 && size <= 20)) {
    return 'Enter how many people will live there, from 1 to 20.';
  }
  const members = changes.members ?? [];
  if (members.length > 10) return 'Add up to 10 household members.';
  for (const member of members) {
    if (!member.name) return 'Give each household member a name, or remove the row.';
    if (member.age != null && !(Number.isInteger(member.age) && member.age >= 0 && member.age <= 120)) {
      return `Enter ${member.name}'s age in whole years.`;
    }
  }
  return null;
}

function HouseholdForm({ tenant, onSaved }: { tenant: TenantDetails; onSaved: Saved }) {
  const draft = useDraft(() => householdForm(tenant), householdValues);
  const { form } = draft;
  const [nextKey, setNextKey] = useState(0);
  const { status, save, refuse, unchanged, edited } = useSave(onSaved);

  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    draft.update({ [key]: value } as Partial<typeof form>);
    edited();
  }

  function changeMember(key: string, field: keyof Omit<MemberDraft, 'key'>, value: string) {
    change('members', form.members.map((member) => (member.key === key ? { ...member, [field]: value } : member)));
  }

  function addMember() {
    change('members', [...form.members, { key: `new-${nextKey}`, name: '', age: '', relationship: '' }]);
    setNextKey((count) => count + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = draft.changes();
    if (Object.keys(changes).length === 0) return unchanged();
    const problem = householdProblem(changes);
    if (problem) return refuse(problem);
    const { pets, members, ...columns } = changes;
    const household = defined({ pets, members });
    const saved = await save({
      tenant: { ...columns, ...(Object.keys(household).length ? { household } : {}) },
    });
    if (saved?.tenant) draft.reset(householdForm(saved.tenant));
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="tenant-household-title">
      <Card className={CARD}>
        <h2 id="tenant-household-title" className="font-heading text-lg font-semibold text-text-dark">
          Who is moving in
        </h2>
        <p className="mt-1 text-sm text-text-body">Only you can see your household.</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Input
            label="People in the household"
            type="number"
            min={1}
            max={20}
            inputMode="numeric"
            value={form.household_size}
            onChange={(e) => change('household_size', e.target.value)}
          />
          <label className="flex items-center gap-2 self-end pb-3 text-sm text-text-dark">
            <input
              type="checkbox"
              checked={form.has_pets}
              onChange={(e) => change('has_pets', e.target.checked)}
              className="size-4 accent-primary-strong"
            />
            The household includes pets
          </label>
          {form.has_pets ? (
            <Input
              label="Pets"
              placeholder="One small dog"
              maxLength={200}
              value={form.pets}
              onChange={(e) => change('pets', e.target.value)}
            />
          ) : null}
        </div>
        <fieldset className="mt-6 min-w-0">
          <legend className={LABEL}>Other people living with you</legend>
          {form.members.length === 0 ? (
            <p className="mt-2 text-sm text-text-body">No household members added yet.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {form.members.map((member, index) => (
                <li
                  key={member.key}
                  className="grid gap-3 rounded-[12px] border border-[#dee1e6] p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end"
                >
                  <Input
                    label={`Person ${index + 1}: name`}
                    maxLength={120}
                    value={member.name}
                    onChange={(e) => changeMember(member.key, 'name', e.target.value)}
                  />
                  <Input
                    label="Age"
                    type="number"
                    min={0}
                    max={120}
                    inputMode="numeric"
                    value={member.age}
                    onChange={(e) => changeMember(member.key, 'age', e.target.value)}
                  />
                  <Input
                    label="Relationship to you"
                    placeholder="Partner, friend, sibling"
                    maxLength={60}
                    value={member.relationship}
                    onChange={(e) => changeMember(member.key, 'relationship', e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-11 rounded-[8px]"
                    onClick={() => change('members', form.members.filter((item) => item.key !== member.key))}
                  >
                    Remove<span className="sr-only"> person {index + 1}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="secondary"
            className="mt-3 h-10 rounded-[8px]"
            onClick={addMember}
            disabled={form.members.length >= 10}
          >
            Add a person
          </Button>
        </fieldset>
        <SaveBar {...status} label="Save household" />
      </Card>
    </form>
  );
}

function DocumentUploadScreen({ screen }: { screen: TenantScreen; kind: 'passport' | 'id' }) {
  // Both ID screens show every tenant document: what is saved is the server's.
  return (
    <PageFrame screen={screen}>
      <DocumentsPanel legacyPicks="tenant" />
    </PageFrame>
  );
}

function AddressHistoryScreen({ screen }: { screen: TenantScreen }) {
  return (
    <TenantProfileScreen screen={screen}>
      {(_profile, tenant, onSaved) => <AddressHistoryForm tenant={tenant} onSaved={onSaved} />}
    </TenantProfileScreen>
  );
}

const EMPTY_ADDRESS = {
  address: '',
  suburb: '',
  state: '',
  start_date: '',
  end_date: '',
  current: false,
  weekly_rent: '',
  landlord_name: '',
  landlord_contact: '',
  reason_for_leaving: '',
  bond_returned: '' as BondReturned | '',
};

function addressProblem(draft: typeof EMPTY_ADDRESS): string | null {
  const today = sydneyToday();
  if (!draft.address.trim()) return 'Enter the street address.';
  if (draft.start_date && !(draft.start_date >= '1950-01-01' && draft.start_date <= today)) {
    return 'A tenancy must start between 1950 and today.';
  }
  if (!draft.current && draft.end_date && !(draft.end_date >= '1950-01-01' && draft.end_date <= today)) {
    return 'A past tenancy must end between 1950 and today. Tick "I live here now" if you still do.';
  }
  if (!draft.current && draft.start_date && draft.end_date && draft.end_date < draft.start_date) {
    return 'A tenancy cannot end before it starts.';
  }
  const rent = numberOrNull(draft.weekly_rent);
  if (rent != null && !(rent >= 0 && rent <= 20_000)) return 'Enter the weekly rent from $0 to $20,000.';
  return null;
}

function entryInput(draft: typeof EMPTY_ADDRESS): RentalHistoryInput {
  return {
    address: draft.address.trim(),
    suburb: textOrNull(draft.suburb),
    state: textOrNull(draft.state),
    start_date: draft.start_date || null,
    end_date: draft.current ? null : draft.end_date || null,
    current: draft.current,
    weekly_rent: numberOrNull(draft.weekly_rent),
    landlord_name: textOrNull(draft.landlord_name),
    landlord_contact: textOrNull(draft.landlord_contact),
    reason_for_leaving: textOrNull(draft.reason_for_leaving),
    bond_returned: draft.bond_returned || null,
  };
}

function tenancyDates(entry: RentalHistoryEntry): string {
  const month = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const start = entry.start_date ? month(entry.start_date) : null;
  const end = entry.current ? 'now' : entry.end_date ? month(entry.end_date) : null;
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  return end === 'now' ? 'Current address' : end ? `Until ${end}` : '';
}

function AddressHistoryForm({ tenant, onSaved }: { tenant: TenantDetails; onSaved: Saved }) {
  const [entries, setEntries] = useState(tenant.rental_history);
  const [draft, setDraft] = useState(EMPTY_ADDRESS);
  const { status, save, refuse, edited } = useSave(onSaved);
  const today = sydneyToday();

  function change<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    edited();
  }

  async function saveList(next: RentalHistoryInput[], done: string): Promise<boolean> {
    const saved = await save({ tenant: { rental_history: next } }, done);
    if (saved?.tenant) setEntries(saved.tenant.rental_history);
    return Boolean(saved);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (entries.length >= 20) return refuse('You can keep up to 20 addresses. Remove one to add another.');
    const problem = addressProblem(draft);
    if (problem) return refuse(problem);
    if (await saveList([...entries, entryInput(draft)], 'Address added to your rental history.')) {
      setDraft(EMPTY_ADDRESS);
    }
  }

  return (
    <form onSubmit={add} noValidate>
      <Card className={CARD}>
        <p className="text-sm text-text-body">
          Your rental history from the past three years. Only you can see these addresses and contacts.
        </p>
        <h2 className="mt-6 font-heading text-lg font-semibold text-text-dark">Your addresses</h2>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-text-body">No previous addresses yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-[12px] border border-[#dee1e6] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium text-text-dark">
                    {[entry.address, entry.suburb, entry.state].filter(Boolean).join(', ')}
                  </p>
                  <p className="break-words text-sm text-text-body">
                    {[
                      tenancyDates(entry),
                      entry.weekly_rent != null ? `$${entry.weekly_rent}/wk` : null,
                      entry.landlord_name ? `Owner or agent: ${entry.landlord_name}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 rounded-[8px] text-danger"
                  disabled={status.saving}
                  onClick={() => saveList(entries.filter((item) => item.id !== entry.id), 'Address removed.')}
                >
                  Remove<span className="sr-only"> {entry.address}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <h2 className="mt-8 font-heading text-lg font-semibold text-text-dark">Add an address</h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <Input
            label="Street address"
            required
            maxLength={200}
            value={draft.address}
            onChange={(e) => change('address', e.target.value)}
          />
          <Input
            label="Suburb"
            maxLength={80}
            value={draft.suburb}
            onChange={(e) => change('suburb', e.target.value)}
          />
          <Input label="State" maxLength={40} value={draft.state} onChange={(e) => change('state', e.target.value)} />
          <Input
            label="Weekly rent ($)"
            type="number"
            min={0}
            max={20_000}
            inputMode="numeric"
            value={draft.weekly_rent}
            onChange={(e) => change('weekly_rent', e.target.value)}
          />
          <Input
            label="Lease start"
            type="date"
            min="1950-01-01"
            max={today}
            value={draft.start_date}
            onChange={(e) => change('start_date', e.target.value)}
          />
          <Input
            label="Lease end"
            type="date"
            min="1950-01-01"
            max={today}
            disabled={draft.current}
            value={draft.current ? '' : draft.end_date}
            onChange={(e) => change('end_date', e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-text-dark md:col-span-2">
            <input
              type="checkbox"
              checked={draft.current}
              onChange={(e) => change('current', e.target.checked)}
              className="size-4 accent-primary-strong"
            />
            I live here now
          </label>
          <Input
            label="Owner or agent name"
            maxLength={120}
            value={draft.landlord_name}
            onChange={(e) => change('landlord_name', e.target.value)}
          />
          <Input
            label="Owner or agent phone or email"
            maxLength={200}
            value={draft.landlord_contact}
            onChange={(e) => change('landlord_contact', e.target.value)}
          />
          <Input
            label="Reason for leaving"
            maxLength={200}
            value={draft.reason_for_leaving}
            onChange={(e) => change('reason_for_leaving', e.target.value)}
          />
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="tenant-bond-returned" className={LABEL}>
              Bond
            </label>
            <select
              id="tenant-bond-returned"
              value={draft.bond_returned}
              onChange={(e) => change('bond_returned', e.target.value as BondReturned | '')}
              className="min-h-11 w-full rounded-lg border border-control-border bg-white px-3 text-sm text-text-dark focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
            >
              <option value="">Not saying</option>
              {BOND_ANSWERS.map((answer) => (
                <option key={answer.value} value={answer.value}>
                  {answer.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <SaveBar {...status} label="Add address" />
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tenant qualities
// ---------------------------------------------------------------------------
function TenantQualitiesScreen({ screen }: { screen: TenantScreen }) {
  return (
    <TenantProfileScreen screen={screen}>
      {(_profile, tenant, onSaved) => <TenantQualitiesForm tenant={tenant} onSaved={onSaved} />}
    </TenantProfileScreen>
  );
}

function qualitiesForm(tenant: TenantDetails) {
  return { tags: tenant.qualities.tags, notes: tenant.qualities.notes ?? '' };
}

function qualitiesValues(form: ReturnType<typeof qualitiesForm>) {
  return { tags: form.tags, notes: textOrNull(form.notes) };
}

function TenantQualitiesForm({ tenant, onSaved }: { tenant: TenantDetails; onSaved: Saved }) {
  const draft = useDraft(() => qualitiesForm(tenant), qualitiesValues);
  const { tags, notes } = draft.form;
  const { status, save, unchanged, edited } = useSave(onSaved);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes = draft.changes();
    if (Object.keys(changes).length === 0) return unchanged();
    const saved = await save({ tenant: { qualities: changes } });
    if (saved?.tenant) draft.reset(qualitiesForm(saved.tenant));
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card className={CARD}>
        <CheckboxGroup<QualityTag>
          legend="How you rent"
          hint="Only you can see these until you share your profile with an owner."
          options={TENANT_QUALITIES}
          value={tags}
          onChange={(next) => {
            draft.update({ tags: next });
            edited();
          }}
        />
        <TextArea
          id="tenant-quality-notes"
          label="Anything else owners should know"
          maxLength={1000}
          value={notes}
          onChange={(value) => {
            draft.update({ notes: value });
            edited();
          }}
        />
        <SaveBar {...status} />
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Notification and privacy settings
// ---------------------------------------------------------------------------
function SettingsScreen({ screen }: { screen: TenantScreen }) {
  return (
    <TenantProfileScreen screen={screen}>
      {(profile, _tenant, onSaved) => (
        <Card className={CARD}>
          <ProfileSettingsForm role="tenant" profile={profile} onSaved={onSaved} />
        </Card>
      )}
    </TenantProfileScreen>
  );
}
