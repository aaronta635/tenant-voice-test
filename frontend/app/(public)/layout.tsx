import { cookies } from 'next/headers';
import OwnerShell from '@/app/components/owner/OwnerShell';
import ProviderShell from '@/app/components/provider/ProviderShell';
import PublicFooter from '@/app/components/public/PublicFooter';
import PublicHeader from '@/app/components/public/PublicHeader';
import TenantShell from '@/app/components/tenant/TenantShell';
import { parseRole } from '@/app/lib/session-role';

/**
 * Marketplace / public content stays available after login, but when a role
 * cookie is set we render it inside that role's chrome — never the pre-login
 * Sign in / List your service header that dumps users back onto the guest home.
 * Each way the page sits in one main landmark: the provider shell has its own,
 * and the tenant and owner shells leave it to their pages.
 */
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const role = jar.get('tv_token')?.value ? parseRole(jar.get('tv_role')?.value) : null;

  if (role === 'Provider') {
    return <ProviderShell>{children}</ProviderShell>;
  }
  if (role === 'Owner') {
    return <OwnerShell><main className="min-w-0">{children}</main></OwnerShell>;
  }
  if (role === 'Client') {
    return <TenantShell><main className="min-w-0">{children}</main></TenantShell>;
  }

  return (
    <div className="flex min-h-full flex-col bg-[#fafafe]">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
