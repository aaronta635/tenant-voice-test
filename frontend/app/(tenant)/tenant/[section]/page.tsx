import { notFound, redirect } from 'next/navigation';
import TenantShell from '@/app/components/tenant/TenantShell';
import TenantScreenTemplates from '@/app/components/tenant/TenantScreenTemplates';
import { getTenantScreen, TENANT_SCREENS } from '@/app/lib/tenant-data';

type TenantSectionPageProps = {
  params: Promise<{ section: string }>;
};

export function generateStaticParams() {
  return TENANT_SCREENS
    .filter(
      (screen) =>
        !['messages', 'properties', 'network', 'recommendations'].includes(screen.slug),
    )
    .map((screen) => ({ section: screen.slug }));
}

export async function generateMetadata({ params }: TenantSectionPageProps) {
  const { section } = await params;
  const screen = getTenantScreen(section);

  return {
    title: screen ? `${screen.title} - TenantVoice` : 'TenantVoice',
  };
}

export default async function TenantSectionPage({ params }: TenantSectionPageProps) {
  const { section } = await params;
  const screen = getTenantScreen(section);

  if (!screen) notFound();
  if (section === 'signup') redirect('/register?role=tenant');
  if (section === 'login') redirect('/login?role=tenant');

  return (
    <TenantShell>
      <TenantScreenTemplates screen={screen} />
    </TenantShell>
  );
}
