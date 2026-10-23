// Where the signed-in account stands for the verification gates (backend
// GET /me/standing, services/gates.py, tracker R18). The provider workspace
// says what a suspended account can still do (assumption #14) before an
// action is refused.

/** approved, or why the gates refuse new work: the verification (pending, rejected, unknown) or the account. */
export type AccountStanding = 'approved' | 'pending' | 'rejected' | 'unknown' | 'suspended' | 'inactive';

export type AccountStandingOut = { state: AccountStanding };

/** Whether the account itself keeps new work away (suspended, or not active), whatever its documents say. */
export function outOfWork(state: AccountStanding | null | undefined): state is 'suspended' | 'inactive' {
  return state === 'suspended' || state === 'inactive';
}
