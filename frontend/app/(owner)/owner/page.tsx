import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import {
  StarIcon,
  HouseIcon,
  FileTextIcon,
  MessageSquareIcon,
  UsersIcon,
  NetworkIcon,
  SparklesIcon,
  BotIcon,
  ChevronRightIcon,
} from '@/app/components/owner/icons';

type QuickLink = {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
};

// Destinations follow docs/navigation-flow.md "Home (HomeFlow - Dashboard)".
// In-App Chat, Network, and AI Assistant have no real Figma prototype wiring —
// TODO: no real Figma prototype connection — confirm with design.
const QUICK_LINKS: QuickLink[] = [
  {
    href: '/owner/scorecard',
    title: 'Ratings & Reviews',
    description: 'See and submit feedback for properties.',
    icon: <StarIcon className="text-amber-500" />,
    iconBg: 'bg-[#fef3c7]',
  },
  {
    href: '/owner/properties',
    title: 'Properties',
    description: 'Manage your listings or find new homes.',
    icon: <HouseIcon className="text-blue-500" />,
    iconBg: 'bg-[#dbeafe]',
  },
  {
    href: '/owner/applications',
    title: 'Rental Applications',
    description: 'Review tenant applications and proposals.',
    icon: <FileTextIcon className="text-teal-600" />,
    iconBg: 'bg-[#ccfbf1]',
  },
  {
    href: '/owner/messages',
    title: 'In-App Chat',
    description: 'Communicate directly with tenants or owners.',
    icon: <MessageSquareIcon className="text-purple-600" />,
    iconBg: 'bg-[#f3e8ff]',
  },
  {
    href: '/owner/profile',
    title: 'Search for Profiles',
    description: 'Search for tenant or service provider profiles.',
    icon: <UsersIcon className="text-orange-500" />,
    iconBg: 'bg-[#ffedd5]',
  },
  {
    href: '/owner/network',
    title: 'Network',
    description: 'View and manage your connection requests.',
    icon: <NetworkIcon className="text-green-600" />,
    iconBg: 'bg-[#dcfce7]',
  },
  {
    href: '/owner/recommendations',
    title: 'Recommendations',
    description: 'Manage your listings or find new homes.',
    icon: <SparklesIcon className="text-sky-600" />,
    iconBg: 'bg-[#e0f2fe]',
  },
  {
    href: '/owner/help/ai-chat',
    title: 'AI Assistant',
    description: 'Ask AI to help manage listings, applications, rent, and maintenance.',
    icon: <BotIcon className="text-primary" />,
    iconBg: 'bg-primary/10',
  },
];

export default function OwnerHomePage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-2xl bg-surface p-6 sm:p-8 lg:p-10">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight text-text-dark sm:text-[36px] sm:leading-[40px]">
          Welcome Back!
        </h1>
        <p className="mt-2 text-base text-text-body sm:text-xl">
          Streamline your rental journey with ease.
        </p>
      </div>

      <div>
        <h2 className="mb-4 font-heading text-xl font-bold text-text-dark sm:text-2xl">
          Your Dashboard
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="block">
              <Card className="flex items-center gap-4 p-6 transition-shadow hover:shadow-md">
                <div
                  className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${link.iconBg}`}
                >
                  {link.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-lg font-bold text-text-dark">{link.title}</p>
                  <p className="mt-1 text-sm text-text-body">{link.description}</p>
                </div>
                <ChevronRightIcon
                  size={20}
                  className="shrink-0 text-text-muted opacity-40"
                />
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
