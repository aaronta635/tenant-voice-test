'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DemoLabel from '@/app/components/demo/DemoLabel';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import FaqAccordion from '@/app/components/owner/FaqAccordion';
import SupportChat from '@/app/components/support/SupportChat';
import { BotIcon, MessageSquareIcon, MailIcon, PhoneIcon } from '@/app/components/owner/icons';
import { api, safe, type Faq, type SupportContact } from '@/app/lib/api';
import { sampleContactReason } from '@/app/lib/demo';

export default function HelpContactPage() {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [contact, setContact] = useState<SupportContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const [faqList, supportContact] = await Promise.all([
        safe(api.content.faqs('landlord'), []),
        safe<SupportContact | null>(api.content.supportContact(), null),
      ]);
      if (!active) return;
      setFaqs(faqList);
      setContact(supportContact);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // The form below mails this address when the contact cannot be read.
  const supportEmail = contact?.email ?? 'support@tenantvoice.test';
  const sampleReason = sampleContactReason({ email: supportEmail, phone: contact?.phone });
  const quickActions: { href: string; title: string; description: string; icon: React.ReactNode; demo?: string }[] = [
    {
      href: '/owner/help/ai-chat',
      title: 'Chat with AI',
      description: 'Get instant help 24/7',
      // Real since R29: the model answers once a key is set, else fixed rules from the owner's records.
      icon: <BotIcon className="text-primary" />,
    },
    {
      href: '/contact',
      title: 'Contact us',
      description: 'Send our team a message',
      icon: <MessageSquareIcon className="text-primary" />,
    },
    ...(contact
      ? [
          {
            href: `mailto:${contact.email}`,
            title: 'Email Us',
            description: contact.email,
            icon: <MailIcon className="text-primary" />,
          },
          {
            href: `tel:${contact.phone.replace(/\s+/g, '')}`,
            title: 'Call Us',
            description: contact.phone,
            icon: <PhoneIcon className="text-primary" />,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold text-text-dark">Help &amp; Support</h1>
        <p className="mt-1 text-text-body">We&apos;re here to help you succeed.</p>
      </div>

      <div className="mx-auto flex rounded-full border border-border bg-white p-1">
        <span className="rounded-full bg-primary px-6 py-2 text-sm font-medium text-white">
          Contact
        </span>
        <Link
          href="/owner/help/ai-chat"
          className="rounded-full px-6 py-2 text-sm font-medium text-text-body hover:text-text-dark"
        >
          AI Chat
        </Link>
      </div>

      <div>
        <h2 className="mb-4 font-heading text-xl font-semibold text-text-dark">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => (
            <Link key={action.title} href={action.href} className="block">
              <Card className="flex flex-col items-center gap-2 p-6 text-center transition-shadow hover:shadow-md">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-surface">
                  {action.icon}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <p className="font-medium text-text-dark">{action.title}</p>
                  {action.demo ? <DemoLabel reason={action.demo} /> : null}
                </div>
                <p className="text-sm text-text-body">{action.description}</p>
              </Card>
            </Link>
          ))}
        </div>
        {!loading && sampleReason ? <DemoLabel variant="notice" className="mt-4" reason={sampleReason} /> : null}
      </div>

      <SupportChat audience="landlord" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-heading text-lg font-semibold text-text-dark">Send us a Message</h2>
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const body = [`From: ${name} <${email}>`, '', message].join('\n');
              window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(subject || 'Owner support')}&body=${encodeURIComponent(body)}`;
            }}
          >
            <Input label="Your Name" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input label="Email Address" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input label="Subject" placeholder="Briefly describe your issue" value={subject} onChange={(e) => setSubject(e.target.value)} required />
            <div className="flex flex-col gap-[6px]">
              <label
                htmlFor="support-message"
                className="text-[11px] font-semibold tracking-[0.8px] text-text-body uppercase"
              >
                Message
              </label>
              <textarea
                id="support-message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                className="w-full rounded border border-[#dee1e6] bg-[rgba(243,244,246,0.4)] p-3 text-sm text-text-dark placeholder:text-text-subtle focus:border-transparent focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
            <Button type="submit" variant="primary">
              Send Message
            </Button>
            <p className="text-center text-xs text-text-subtle">
              We typically respond within 24 hours.
            </p>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="font-heading text-lg font-semibold text-text-dark">
            Frequently Asked Questions
          </h2>
          {loading ? (
            <p className="mt-4 text-sm text-text-body">Loading FAQs…</p>
          ) : faqs.length === 0 ? (
            <p className="mt-4 text-sm text-text-body">No FAQs published yet.</p>
          ) : (
            <FaqAccordion items={faqs} />
          )}
        </Card>
      </div>
    </div>
  );
}
