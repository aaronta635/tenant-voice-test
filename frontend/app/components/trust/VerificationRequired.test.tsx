import { cleanup, descendants, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import { verificationRequired, type VerificationRequiredDetail } from '@/app/lib/verification-gate';
import VerificationRequired from './VerificationRequired';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(cleanup);

function gate(over: Partial<VerificationRequiredDetail> = {}): VerificationRequiredDetail {
  return {
    code: 'verification_required',
    action: 'apply',
    status: 'rejected',
    message: 'Your account needs to be verified before you can apply for rentals. A document was rejected: replace it to send it for review again.',
    documents_href: '/tenant/id-verification',
    ...over,
  };
}

describe('VerificationRequired', () => {
  it('says what the gate said, as an alert, with a link to the documents', async () => {
    const view = await render(<VerificationRequired detail={gate()} />);
    const [alert] = descendants(view).filter((element) => element.getAttribute('role') === 'alert');

    expect(textOf(alert)).toContain('A document needs replacing');
    expect(textOf(alert)).toContain('replace it to send it for review again');
    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/tenant/id-verification');
  });

  it('leaves the link out when documents would not help', async () => {
    const view = await render(<VerificationRequired detail={gate({
      status: 'suspended', message: "Your account is suspended, so you can't apply for rentals. Contact support to restore it.", documents_href: null,
    })} />);

    expect(textOf(view)).toContain('Account suspended');
    expect(descendants(view).some((element) => element.tagName === 'A')).toBe(false);
  });

  it('shows a refusal straight from the API error', async () => {
    const error = new ApiError(403, 'x', { ...gate({ action: 'go_live', status: 'pending', documents_href: '/dashboard/profile#verification-documents' }) });
    const detail = verificationRequired(error);
    expect(detail).not.toBeNull();

    const view = await render(<VerificationRequired detail={detail!} id="go-live-result" />);

    expect(textOf(view)).toContain('Verification needed');
    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/dashboard/profile#verification-documents');
    // A caller can move focus to it, but it is no tab stop.
    const [box] = descendants(view).filter((element) => element.id === 'go-live-result');
    expect(box.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps AA contrast, also under the pointer', async () => {
    const view = await render(<div className="bg-white"><VerificationRequired detail={gate()} /></div>);

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
