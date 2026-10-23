export type TenantScreenKind =
  | 'notifications'
  | 'messages'
  | 'cards'
  | 'profile'
  | 'form'
  | 'review'
  | 'subscription'
  | 'support'
  | 'connections'
  | 'score'
  | 'checklist';

export type TenantScreen = {
  slug: string;
  figmaId: string;
  title: string;
  eyebrow?: string;
  description: string;
  kind: TenantScreenKind;
};

export const TENANT_NAV = [
  { label: 'Dashboard', href: '/tenant/dashboard', icon: 'dashboard' },
  { label: 'Applications', href: '/tenant/applications', icon: 'applications' },
  { label: 'Inspections', href: '/tenant/inspections', icon: 'search' },
  { label: 'Leases', href: '/tenant/leases', icon: 'applications' },
  { label: 'My rent', href: '/tenant/rent', icon: 'subscription' },
  { label: 'Service bookings', href: '/tenant/bookings', icon: 'applications' },
  { label: 'Properties', href: '/tenant/properties', icon: 'properties' },
  { label: 'Find Providers', href: '/categories', icon: 'providers' },
  { label: 'Recommendations', href: '/tenant/recommendations', icon: 'recommendations' },
  { label: 'Maintenance', href: '/tenant/maintenance', icon: 'repairs' },
  { label: 'Complaints', href: '/tenant/complaints', icon: 'score' },
  { label: 'Network', href: '/tenant/network', icon: 'network' },
  { label: 'Subscription', href: '/tenant/manage-subscription', icon: 'subscription' },
  { label: 'Profile Completion', href: '/tenant/profile-completion', icon: 'profile' },
  { label: 'Tenant Qualities', href: '/tenant/scorecard', icon: 'score' },
  { label: 'Search Profiles', href: '/tenant/search-profile', icon: 'search' },
] as const;

export type TenantNavIcon = (typeof TENANT_NAV)[number]['icon'];

export const TENANT_SCREENS: TenantScreen[] = [
  {
    slug: 'notifications',
    figmaId: '88:509',
    title: 'Notifications',
    description: 'Review moderation, property matches, application updates, and account alerts.',
    kind: 'notifications',
  },
  {
    slug: 'messages',
    figmaId: '88:855',
    title: 'Messages',
    description: 'Keep conversations with owners, agents, and support in one place.',
    kind: 'messages',
  },
  {
    slug: 'recommendations',
    figmaId: '88:1270',
    title: 'Recommendations',
    description: 'Curated rentals and next-best actions based on your profile and preferences.',
    kind: 'cards',
  },
  {
    slug: 'network',
    figmaId: '88:1655',
    title: 'Network',
    description: 'View saved owners, agents, and tenant references connected to your profile.',
    kind: 'connections',
  },
  {
    slug: 'search-profile',
    figmaId: '88:1655',
    title: 'Search Profiles',
    description: 'Search tenants, owners, and service providers to connect with or message.',
    kind: 'connections',
  },
  {
    slug: 'connection-requests',
    figmaId: '88:2143',
    title: 'Connection Requests',
    description: 'Approve, decline, and manage incoming reference or profile connection requests.',
    kind: 'connections',
  },
  {
    slug: 'profile-completion',
    figmaId: '88:2489',
    title: 'Profile Completion',
    description: 'Complete the steps that make your tenant profile stronger for applications.',
    kind: 'checklist',
  },
  {
    slug: 'scorecard',
    figmaId: '88:2893',
    title: 'Scorecard',
    description: 'A simple snapshot of readiness, references, verification, and rental strength.',
    kind: 'score',
  },
  {
    slug: 'tenant-qualities',
    figmaId: '88:3194',
    title: 'Tenant Qualities',
    description: 'Highlight reliability, communication, care, and other qualities owners value.',
    kind: 'form',
  },
  {
    slug: 'address-history',
    figmaId: '88:3601',
    title: 'Address History',
    description: 'Maintain a clean timeline of previous rentals and living history.',
    kind: 'form',
  },
  {
    slug: 'settings',
    figmaId: '88:4013',
    title: 'Settings',
    description: 'Manage account preferences, privacy controls, and notification settings.',
    kind: 'form',
  },
  {
    slug: 'my-profile',
    figmaId: '88:4489',
    title: 'My Profile',
    description: 'Review the public-facing tenant profile used during applications.',
    kind: 'profile',
  },
  {
    slug: 'upload-passport',
    figmaId: '88:4749',
    title: 'Upload Passport',
    description: 'Upload identity documents for secure verification.',
    kind: 'form',
  },
  {
    slug: 'id-verification',
    figmaId: '88:5050',
    title: 'ID Verification',
    description: 'Verify your identity and track document approval status.',
    kind: 'form',
  },
  {
    slug: 'rental-preferences',
    figmaId: '88:5372',
    title: 'Rental Preferences',
    description: 'Set budget, location, property type, and move-in preferences.',
    kind: 'form',
  },
  {
    slug: 'financial-information',
    figmaId: '88:5643',
    title: 'Financial Information',
    description: 'Record employment, income, and supporting financial details.',
    kind: 'form',
  },
  {
    slug: 'contact-details',
    figmaId: '88:5954',
    title: 'Contact Details',
    description: 'Keep phone, email, emergency contact, and address details current.',
    kind: 'form',
  },
  {
    slug: 'personal-information',
    figmaId: '88:6185',
    title: 'Personal Information',
    description: 'Manage the personal details attached to your tenant profile.',
    kind: 'form',
  },
  {
    slug: 'properties',
    figmaId: '88:6837',
    title: 'Property Selection',
    description: 'Choose the property connected to your review or application workflow.',
    kind: 'cards',
  },
  {
    slug: 'financial-pricing-review',
    figmaId: '88:6948',
    title: 'Financial & Pricing Review',
    description: 'Add financial details and review property value or rental pricing.',
    kind: 'review',
  },
  {
    slug: 'submit-review',
    figmaId: '88:7194',
    title: 'Submit Review',
    description: 'Preview and submit your rental experience review.',
    kind: 'review',
  },
  {
    slug: 'photo-upload',
    figmaId: '88:7833',
    title: 'Photo Upload',
    description: 'Attach photos and supporting evidence to a review.',
    kind: 'review',
  },
  {
    slug: 'star-ratings',
    figmaId: '88:8135',
    title: 'Star Ratings',
    description: 'Score the rental experience across key categories.',
    kind: 'review',
  },
  {
    slug: 'detailed-review',
    figmaId: '88:8501',
    title: 'Detailed Review',
    description: 'Write a detailed property, owner, and building experience review.',
    kind: 'review',
  },
  {
    slug: 'tenancy-confirmation',
    figmaId: '88:8658',
    title: 'Tenancy Confirmation',
    description: 'Confirm tenancy dates and evidence before publishing a review.',
    kind: 'review',
  },
  {
    slug: 'help-support',
    figmaId: '88:8767',
    title: 'Help & Support',
    description: 'Find help topics, contact support, and track support requests.',
    kind: 'support',
  },
  {
    slug: 'write-review',
    figmaId: '88:9246',
    title: 'Write a Review',
    description: 'Start a guided review for a property you have rented.',
    kind: 'review',
  },
  {
    slug: 'visual-flow',
    figmaId: '88:14767',
    title: 'Review Flow',
    description: 'Step through the property review journey from selection to submission.',
    kind: 'review',
  },
  {
    slug: 'signup',
    figmaId: '88:15485',
    title: 'Create Account',
    description: 'Create a tenant account and join the TenantVoice platform.',
    kind: 'form',
  },
  {
    slug: 'login',
    figmaId: '88:15632',
    title: 'Tenant Login',
    description: 'Sign in as a tenant and return to your dashboard.',
    kind: 'form',
  },
  {
    slug: 'manage-subscription',
    figmaId: '88:16145',
    title: 'Manage Subscription',
    description: 'Choose access, manage billing information, invoices, and renewal settings.',
    kind: 'subscription',
  },
];

export const getTenantScreen = (slug: string) =>
  TENANT_SCREENS.find((screen) => screen.slug === slug);
