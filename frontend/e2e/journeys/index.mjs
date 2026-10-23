// The journeys a run goes through, in this order (docs/e2e.md).
import { admin } from './admin.mjs';
import { landlord } from './landlord.mjs';
import { provider } from './provider.mjs';
import { tenant } from './tenant.mjs';
import { visitor } from './visitor.mjs';

export const JOURNEYS = [visitor, tenant, landlord, provider, admin];
