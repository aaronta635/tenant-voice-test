import AdminUserDetail from '@/app/components/admin/AdminUserDetail';

export const metadata = { title: 'Account · Admin' };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminUserDetail userId={id} />;
}
