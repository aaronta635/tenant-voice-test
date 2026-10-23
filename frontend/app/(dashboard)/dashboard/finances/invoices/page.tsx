import { redirect } from 'next/navigation';

export default function InvoicesIndex() {
  redirect('/dashboard/finances?section=invoices');
}
