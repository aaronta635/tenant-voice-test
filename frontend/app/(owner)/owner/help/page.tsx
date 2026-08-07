'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import Input from '@/app/components/ui/Input';
import FaqAccordion from '@/app/components/owner/FaqAccordion';
import { BotIcon, MessageSquareIcon, MailIcon, PhoneIcon } from '@/app/components/owner/icons';
import { api, safe, type Faq, type SupportContact } from '@/app/lib/api';

export default function HelpContactPage() {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [contact, setContact] = useState<SupportContact | null>(null);
  const [loading, setLoading] = useState(true);

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

  const quickActions = [
    {
      href: '/owner/help/ai-chat',
      title: 'Chat with AI',
      description: 'Get instant help 24/7',
      icon: <BotIcon className="text-primary" />,
    },
    {
      href: '/owner/messages',
      title: 'Live Chat',
      description: 'Talk to our human team',
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
                <p className="font-medium text-text-dark">{action.title}</p>
                <p className="text-sm text-text-body">{action.description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-heading text-lg font-semibold text-text-dark">Send us a Message</h2>
          <form className="mt-4 flex flex-col gap-4">
            <Input label="Your Name" placeholder="Your full name" />
            <Input label="Email Address" type="email" placeholder="you@example.com" />
            <Input label="Subject" placeholder="Briefly describe your issue" />
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
                placeholder="Tell us how we can help you..."
                className="w-full rounded border border-[#dee1e6] bg-[rgba(243,244,246,0.4)] p-3 text-sm text-text-dark placeholder:text-text-subtle focus:border-transparent focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
            {/* TODO: submission needs a support-ticket endpoint; email/phone above are live. */}
            <Button type="button" variant="primary">
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
