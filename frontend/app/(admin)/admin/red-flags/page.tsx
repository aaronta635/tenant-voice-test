import AdminRedFlags from '@/app/components/admin/AdminRedFlags';

export const metadata = { title: 'Red flags · Admin' };

/** Where the database's red-flag notices link (evaluate_red_flag_rule_for_property). */
export default function AdminRedFlagsPage() {
  return <AdminRedFlags />;
}
