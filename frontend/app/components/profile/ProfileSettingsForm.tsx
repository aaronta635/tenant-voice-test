'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { buttonClassName } from '@/app/components/ui/button-styles';
import FormMessage from '@/app/components/ui/FormMessage';
import { ApiError } from '@/app/lib/api';
import {
  PRIVACY_DEFAULTS,
  updateMyProfile,
  type MyProfile,
  type NotificationSwitch,
  type PrivacySwitch,
  type ProfileSettings,
} from '@/app/lib/my-profile';

export type SettingsRole = 'tenant' | 'landlord' | 'service_provider';
type Copy = { label: string; hint: string };

const MESSAGES: Copy = { label: 'New messages', hint: 'When someone writes to you.' };
const PROFILE_UPDATES: Copy = {
  label: 'Profile updates',
  hint: 'Reminders and suggestions about your profile, sent by the TenantVoice app.',
};
const ACCOUNT: Copy = {
  label: 'Account alerts',
  hint: 'Verification, account and security notices. These always arrive.',
};

/** The notices each role gets, in its own words, in the order they are shown. */
const NOTIFICATION_COPY: Record<SettingsRole, Partial<Record<NotificationSwitch, Copy>>> = {
  tenant: {
    matches: { label: 'Property matches', hint: 'Listings that fit your rental preferences.' },
    application: { label: 'Application updates', hint: 'Status changes on properties you applied for.' },
    message: { ...MESSAGES, hint: 'When an owner, provider or member writes to you.' },
    repairs: { label: 'Repairs', hint: 'Updates on the repairs you asked for.' },
    property: { label: 'Complaint updates', hint: 'Answers and status changes on complaints you lodged.' },
    booking: { label: 'Service bookings', hint: 'Changes to services you booked.' },
    review: { label: 'Reviews', hint: 'Replies to reviews you wrote, and answers to your scorecard requests.' },
    profile_updates: PROFILE_UPDATES,
    account: ACCOUNT,
  },
  landlord: {
    application: { label: 'New applications', hint: 'When a tenant applies for one of your listings.' },
    message: { ...MESSAGES, hint: 'When a tenant, provider or member writes to you.' },
    repairs: { label: 'Repairs', hint: 'Repair requests at your properties and the visits booked for them.' },
    property: { label: 'Listing and complaint updates', hint: 'Changes to your listings, and complaints about them.' },
    review: { label: 'Reviews', hint: 'New reviews of your properties, replies, and tenants asking for a scorecard.' },
    booking: { label: 'Service bookings', hint: 'Changes to services you booked.' },
    profile_updates: PROFILE_UPDATES,
    account: ACCOUNT,
  },
  service_provider: {
    booking: { label: 'Bookings', hint: 'New booking requests and changes to your bookings.' },
    message: { ...MESSAGES, hint: 'When a client or member writes to you.' },
    repairs: { label: 'Repair jobs', hint: 'Repairs assigned to you, and changes to them.' },
    review: { label: 'Reviews', hint: 'New reviews of your services.' },
    property: { label: 'Complaint updates', hint: 'Answers and status changes on complaints about your work.' },
    profile_updates: PROFILE_UPDATES,
    account: ACCOUNT,
  },
};

const APP_ONLY = 'The website never shows them.';
const DISCOVERABLE: Copy = {
  label: 'Let people find me in searches',
  hint: 'Off: you are left out of the profile searches, but a link to your profile still opens.',
};
const ALLOW_MESSAGES: Copy = {
  label: 'Let members message me in the app',
  hint: 'Members can start a conversation with you in the TenantVoice app.',
};
const SHOW_CONTACT: Copy = {
  label: 'Show my email and phone in the app',
  hint: `Members see them on your profile in the TenantVoice app. ${APP_ONLY}`,
};

/** The privacy switches each role has, in the order they are shown. */
const PRIVACY_COPY: Record<SettingsRole, Partial<Record<PrivacySwitch, Copy>>> = {
  tenant: {
    public_profile: {
      label: 'Show my public profile',
      hint: 'Visitors and members can find your card: first name, suburbs, budget and about line.',
    },
    discoverable: DISCOVERABLE,
    show_availability: {
      label: 'Show that I am looking',
      hint: 'Whether you are looking for a home shows on your profile in the TenantVoice app.',
    },
    allow_messages: ALLOW_MESSAGES,
    show_contact: SHOW_CONTACT,
    share_score: {
      label: 'Share my readiness score',
      hint: 'Shows the average of the owner scorecards you choose on your public profile, to everyone who can see it.',
    },
  },
  landlord: {
    public_profile: {
      label: 'Show my public profile',
      hint: 'Visitors and members can find your card: your name, business and about line.',
    },
    discoverable: DISCOVERABLE,
    allow_messages: ALLOW_MESSAGES,
    show_contact: SHOW_CONTACT,
  },
  service_provider: {
    public_profile: {
      label: 'Show my member profile',
      hint: 'Your card in the profile search, once your provider profile is published. Off also hides you from '
        + "owners' provider search and suggestions in the TenantVoice app.",
    },
    discoverable: {
      ...DISCOVERABLE,
      hint: `${DISCOVERABLE.hint} In the TenantVoice app, owners' provider search and suggestions leave you out too.`,
    },
    allow_messages: ALLOW_MESSAGES,
    show_contact: SHOW_CONTACT,
  },
};

// No switch stops these (backend services/notifications.py, ALWAYS_SENT).
const ALWAYS_ON: NotificationSwitch[] = ['account'];

function switches<T extends string>(copy: Partial<Record<T, Copy>>): T[] {
  return Object.keys(copy) as T[];
}

/**
 * Notification and privacy switches, saved to the account where the mobile
 * app keeps them (users.metadata.mobile), so they hold in both apps. "All
 * notifications" off stops every notice but account alerts; a kind switched
 * off sends no new notices; account alerts always arrive. Each role sees the
 * switches it has in its own words, and saves only those. The caller puts it
 * on a card.
 */
export default function ProfileSettingsForm({
  role,
  profile,
  onSaved,
}: {
  role: SettingsRole;
  profile: MyProfile;
  onSaved: (profile: MyProfile) => void;
}) {
  const [settings, setSettings] = useState<ProfileSettings>(profile.settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const wasSaving = useRef(false);
  const notificationKeys = switches<NotificationSwitch>(NOTIFICATION_COPY[role]);
  const privacyKeys = switches<PrivacySwitch>(PRIVACY_COPY[role]);
  const notifying = settings.notification_preferences.push_enabled !== false;

  useEffect(() => {
    // The disabled button drops focus while it saves; give it back after.
    if (wasSaving.current && !saving && document.activeElement === document.body) saveButton.current?.focus();
    wasSaving.current = saving;
  }, [saving]);

  /** A notification switch as the server sends it: on unless switched off. */
  function notificationOn(key: NotificationSwitch): boolean {
    return ALWAYS_ON.includes(key) || settings.notification_preferences[key] !== false;
  }

  function privacyOn(key: PrivacySwitch): boolean {
    return settings.privacy[key] ?? PRIVACY_DEFAULTS[key];
  }

  function toggleNotification(key: NotificationSwitch, on: boolean) {
    setSaved(false);
    setSettings((current) => ({
      ...current,
      notification_preferences: { ...current.notification_preferences, [key]: on },
    }));
  }

  function togglePrivacy(key: PrivacySwitch, on: boolean) {
    setSaved(false);
    setSettings((current) => ({ ...current, privacy: { ...current.privacy, [key]: on } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await updateMyProfile({
        settings: {
          notification_preferences: Object.fromEntries(
            (['push_enabled', ...notificationKeys.filter((key) => !ALWAYS_ON.includes(key))] as NotificationSwitch[])
              .map((key) => [key, notificationOn(key)]),
          ),
          privacy: Object.fromEntries(privacyKeys.map((key) => [key, privacyOn(key)])),
        },
      });
      setSettings(updated.settings);
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <fieldset>
        <legend className="font-heading text-lg font-semibold text-text-dark">Notifications</legend>
        <p className="mt-1 text-sm text-text-body">
          Saved to your account, for the website and the TenantVoice app. A kind you switch off sends you no new
          notices from the website; some notices from the TenantVoice app&apos;s own features, such as its messages
          and repair updates, still arrive.
        </p>
        <div className="mt-4 space-y-4">
          <Switch
            id="notify-push_enabled"
            copy={{
              label: 'All notifications',
              hint: 'Off: the website sends only account alerts, whatever the switches below say.',
            }}
            checked={notifying}
            onChange={(on) => toggleNotification('push_enabled', on)}
          />
          {notificationKeys.map((key) => (
            <Switch
              key={key}
              id={`notify-${key}`}
              copy={NOTIFICATION_COPY[role][key] as Copy}
              checked={notificationOn(key)}
              disabled={ALWAYS_ON.includes(key) || !notifying}
              onChange={(on) => toggleNotification(key, on)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-8">
        <legend className="font-heading text-lg font-semibold text-text-dark">Privacy</legend>
        <div className="mt-4 space-y-4">
          {privacyKeys.map((key) => (
            <Switch
              key={key}
              id={`privacy-${key}`}
              copy={PRIVACY_COPY[role][key] as Copy}
              checked={privacyOn(key)}
              onChange={(on) => togglePrivacy(key, on)}
            />
          ))}
        </div>
      </fieldset>
      <FormMessage error={error} success={saved ? 'Settings saved to your account.' : null} className="mt-4" />
      <div className="mt-6 flex justify-end">
        <button ref={saveButton} type="submit" className={buttonClassName({ className: 'h-10 rounded-[8px]' })} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function Switch({ id, copy, checked, disabled = false, onChange }: {
  id: string;
  copy: Copy;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 shrink-0 accent-primary-strong"
      />
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm font-medium text-text-dark">{copy.label}</span>
        <span id={`${id}-hint`} className="block text-sm text-text-body">{copy.hint}</span>
      </label>
    </div>
  );
}
