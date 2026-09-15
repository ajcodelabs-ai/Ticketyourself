/**
 * Buckets the plan catalog relative to the organizer's current plan for the
 * "Plan y facturación" tab. Every bucket is a full-price, independent charge
 * via Nuvei — no proration, credit, or refund (TI-161).
 */

export type PlanChangeMode = "upgrade" | "lateral" | "downgrade";

export function classifyPlanChange(
    plans: { code: string; price_cents: number }[],
    currentCode: string | null | undefined,
    currentPriceCents: number,
) {
    const otherPlans = plans.filter((p) => p.code !== currentCode);
    return {
        upgrades: otherPlans.filter((p) => p.price_cents > currentPriceCents),
        lateral: otherPlans.filter((p) => p.price_cents === currentPriceCents),
        downgrades: otherPlans.filter((p) => p.price_cents < currentPriceCents),
    };
}
