import AdminComplaintDetail from '@/app/components/admin/AdminComplaintDetail';

export const metadata = { title: 'Complaint · Admin' };

export default async function AdminComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminComplaintDetail complaintId={id} />;
}
