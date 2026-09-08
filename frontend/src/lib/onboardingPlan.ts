/**
 * Onboarding step 3 (pago): the plan chosen at register is already on the
 * organizer. This module turns that code + the catalog into the amount
 * the organizer will pay — without re-asking them to pick a card.
 */

export function resolveOnboardingPlan({ signupPlanCode, localPlanCode, plans }) {
    const code = signupPlanCode || localPlanCode || null;
    const plan = (plans || []).find((p) => p.code === code) || null;
    return { code: plan ? plan.code : code, plan };
}

export function planChargeLabel(plan) {
    if (!plan) return "";
    const dollars = (Number(plan.price_cents) || 0) / 100;
    const display = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
    if (plan.billing_period === "monthly") return `$${display} / mes`;
    if (plan.billing_period === "one_time") return `$${display} (pago único)`;
    return `$${display}`;
}

export function onboardingPayCta(plan, paying) {
    if (paying) return "Procesando…";
    const amount = planChargeLabel(plan);
    return amount ? `Pagar ${amount}` : "Pagar";
}
