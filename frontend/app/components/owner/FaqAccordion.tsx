'use client';

import { useState } from 'react';
import { ChevronRightIcon } from '@/app/components/owner/icons';
import type { Faq } from '@/app/lib/api';

export default function FaqAccordion({ items }: { items: Faq[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="divide-y divide-border">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        return (
          <div key={item.question}>
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-center justify-between gap-4 py-4 text-left"
              aria-expanded={isOpen}
            >
              <span className="font-medium text-text-dark">{item.question}</span>
              <ChevronRightIcon
                size={16}
                className={`shrink-0 text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
            </button>
            {isOpen ? <p className="pb-4 text-sm text-text-body">{item.answer}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
