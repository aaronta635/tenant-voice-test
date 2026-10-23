import AdminViewLink from '@/app/components/admin/AdminViewLink';

const SECTIONS = [
  { key: 'complaints', href: '/admin/complaints', label: 'Complaints' },
  { key: 'categories', href: '/admin/complaints/categories', label: 'Alert policies' },
  { key: 'red-flags', href: '/admin/red-flags', label: 'Red flags' },
  { key: 'alerts', href: '/admin/alerts', label: 'Alerts' },
] as const;

/**
 * The parts of the console's complaints work: the complaints, the alert
 * policies over their categories, the red flags the rules raise, and the
 * alerts past a policy's limits. /admin/red-flags is where the database's
 * red-flag notices link.
 */
export default function ComplaintsSectionNav({ current }: { current: (typeof SECTIONS)[number]['key'] }) {
  return (
    <nav aria-label="Complaints sections" className="min-w-0">
      <ul className="flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <li key={section.key}>
            <AdminViewLink href={section.href} selected={section.key === current}>{section.label}</AdminViewLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
