'use client';

import { useEffect, useState } from 'react';
import Card from '@/app/components/ui/Card';
import Button from '@/app/components/ui/Button';
import { CheckIcon } from '@/app/components/owner/icons';
import { api, ApiError, safe, type Plan, type Subscription } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';

export default function ManageSubscriptionPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [planList, mine] = await Promise.all([
        safe(api.subscriptions.plans('landlord'), []),
        safe<Subscription | null>(api.subscriptions.mine(), null),
      ]);
      if (!active) return;
      setPlans(planList);
      setSubscription(mine);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function choosePlan(planId: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.subscriptions.select(planId);
      setSubscription(updated);
      setPlans(await api.subscriptions.plans('landlord'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your plan.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      setSubscription(await api.subscriptions.cancel());
      setPlans(await api.subscriptions.plans('landlord'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel your subscription.');
    } finally {
      setBusy(false);
    }
  }

  const currentPlan = subscription?.plan ?? plans.find((p) => p.is_current) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-dark sm:text-[30px]">
          Manage Subscription
        </h1>
        <p className="mt-1 text-lg text-text-body">
          View and manage your plan, billing details, and notifications.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#f3c6c6] bg-[#fdecee] px-4 py-3 text-sm text-[#a12b3b]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-text-body">Loading plans…</p>
      ) : (
        <>
          <div>
            <h2 className="mb-4 font-heading text-xl font-semibold text-text-dark">Current Plan</h2>
            {currentPlan ? (
              <Card className="border border-primary/30 bg-surface p-8">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-heading text-2xl font-bold text-text-dark">
                    {currentPlan.name}
                  </p>
                  {currentPlan.is_popular ? (
                    <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white">
                      Popular
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      subscription?.status === 'active'
                        ? 'bg-success/10 text-success'
                        : 'bg-[#fee2e2] text-[#de3b40]'
                    }`}
                  >
                    {subscription?.status === 'active' ? 'Active' : 'Cancelled'}
                  </span>
                </div>
                <p className="mt-3 font-heading text-3xl font-extrabold text-text-dark">
                  ${currentPlan.price}
                  <span className="text-base font-medium text-text-body">
                    {' '}
                    /{currentPlan.billing_period}
                  </span>
                </p>
                {subscription?.renews_at ? (
                  <p className="mt-1 text-sm text-text-body">
                    {subscription.status === 'active' ? 'Renews' : 'Access until'}{' '}
                    {formatDate(subscription.renews_at)}
                  </p>
                ) : null}
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {currentPlan.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-2">
                      <CheckIcon size={18} className="shrink-0 text-primary" />
                      <span className="text-text-dark">{feature}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="p-8">
                <p className="text-text-body">
                  You&apos;re not on a plan yet — pick one below to unlock more listings.
                </p>
              </Card>
            )}
          </div>

          <div>
            <h2 className="mb-4 font-heading text-xl font-semibold text-text-dark">
              Choose Your Plan
            </h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {plans.map((plan) => (
                <Card
                  key={plan.id}
                  className={`flex flex-col p-8 ${plan.is_current ? 'border-2 border-primary' : ''}`}
                >
                  <p className="font-heading text-xl font-semibold text-text-dark">{plan.name}</p>
                  <p className="mt-2 font-heading text-3xl font-bold text-text-dark">
                    ${plan.price}
                    <span className="text-sm font-normal text-text-body">
                      {' '}
                      /{plan.billing_period}
                    </span>
                  </p>
                  {plan.description ? (
                    <p className="mt-2 text-sm text-text-body">{plan.description}</p>
                  ) : null}
                  <div className="mt-6 flex flex-1 flex-col gap-3">
                    {plan.features.map((feature) => (
                      <div key={feature} className="flex items-center gap-2">
                        <CheckIcon size={16} className="shrink-0 text-text-body" />
                        <span className="text-sm text-text-body">{feature}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant={plan.is_current ? 'secondary' : 'primary'}
                    className="mt-6"
                    fullWidth
                    disabled={busy || plan.is_current}
                    onClick={() => choosePlan(plan.id)}
                  >
                    {plan.is_current
                      ? 'Current Plan'
                      : currentPlan && plan.price > currentPlan.price
                        ? 'Upgrade'
                        : currentPlan
                          ? 'Downgrade'
                          : 'Choose plan'}
                  </Button>
                </Card>
              ))}
            </div>
          </div>

          {/* TODO: billing history and payment methods need a payments backend
              (see docs/SCOPE.md "no real money movement"). */}

          {subscription && subscription.status === 'active' ? (
            <div className="flex justify-center border-t border-border pt-6">
              <Button
                variant="ghost"
                className="text-[#de3b40] hover:bg-[#fee2e2]"
                disabled={busy}
                onClick={cancel}
              >
                Cancel Subscription
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
