// Shapes the owner UI cards render. There is no mock data here — live records
// from app/lib/api.ts are mapped onto these types in app/lib/owner-adapters.ts.

export type ApplicantStatus = 'new' | 'reviewing' | 'approved' | 'declined';

export type Applicant = {
  id: string;
  name: string;
  propertySlug: string;
  propertyLabel: string;
  status: ApplicantStatus;
  appliedDate: string;
  income: string;
  moveInDate: string;
  email: string;
  phone: string;
  rentOffered: string;
  tenantScore: number;
  shortlisted: boolean;
  hasPets: boolean;
};
