'use client';

import { useState } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import { BotIcon } from '@/app/components/owner/icons';

type AiMessage = {
  id: string;
  sender: 'ai' | 'me';
  text: string;
};

const INITIAL_MESSAGES: AiMessage[] = [
  {
    id: 'ai-1',
    sender: 'ai',
    text: "Hi! I'm TenantVoice AI Assistant. How can I help you today?",
  },
];

// TODO: this is UI only — no real LLM call is wired up yet. Per CLAUDE.md, AI features
// must remain a simple LLM-wrapper (a single backend call), not agentic/autonomous.

export default function AiChatSupportPage() {
  const [messages, setMessages] = useState<AiMessage[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState('');

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { id: `me-${Date.now()}`, sender: 'me', text },
      {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: "Thanks for your message — a real AI response isn't wired up yet, this is a placeholder reply.",
      },
    ]);
    setDraft('');
  }

  return (
    <Card className="flex h-[calc(100vh-220px)] min-h-[480px] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-primary text-white">
            <BotIcon size={20} />
          </div>
          <p className="font-heading text-lg font-semibold text-text-dark">TenantVoice AI</p>
        </div>
        <Link href="/owner/help" className="text-sm font-medium text-primary hover:underline">
          Back to Help & Contact
        </Link>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto bg-background/40 px-6 py-6">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'me' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm ${
                message.sender === 'me'
                  ? 'rounded-br-md bg-primary text-white'
                  : 'rounded-bl-md border border-border bg-white text-text-dark'
              }`}
            >
              {message.text}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-6 py-4">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder="Ask a question..."
          className="flex-1 rounded-2xl bg-background px-4 py-3 text-sm text-text-dark placeholder:text-text-body focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSend}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-opacity hover:opacity-90"
          aria-label="Send message"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m3 3 18 9-18 9 4-9Z" />
          </svg>
        </button>
      </div>
    </Card>
  );
}
