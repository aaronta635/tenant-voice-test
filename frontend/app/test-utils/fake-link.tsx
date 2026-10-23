// next/link for tests, handling a click the way Next's Link does: it runs the
// link's onClick, then its onNavigate, and hands the click to the router
// (`navigate`) unless one of them cancelled it. A test mocks the module with
//
//   vi.mock('next/link', async () => ({
//     default: (await import('@/app/test-utils/fake-link')).fakeLink((href) => router.navigate(href)),
//   }));
//
// Next skips onNavigate for modified and middle clicks, which leave the page to
// the browser; the test DOM sends neither, so they are not modelled here.
import type { MouseEvent, ReactNode } from 'react';

type LinkProps = {
  href: string;
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  onNavigate?: (event: { preventDefault: () => void }) => void;
} & Record<string, unknown>;

export function fakeLink(navigate: (href: string) => void) {
  return function Link({ href, children, onClick, onNavigate, ...props }: LinkProps) {
    function handleClick(event: MouseEvent<HTMLAnchorElement>) {
      onClick?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      let cancelled = false;
      onNavigate?.({ preventDefault: () => { cancelled = true; } });
      if (!cancelled) navigate(href);
    }
    return <a href={href} {...props} onClick={handleClick}>{children}</a>;
  };
}
