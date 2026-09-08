/**
 * Copy + CTAs for the organizer dashboard "Tu plan" card.
 * Assigned plan (plan_id) is what TYS bills; signup plan is only an intention.
 */

export const DASHBOARD_SUB_BADGE = {
    active: { label: "Activa", className: "bg-emerald-100 text-emerald-800" },
    trialing: { label: "Periodo de prueba", className: "bg-sky-100 text-sky-800" },
    past_due: { label: "Pago atrasado", className: "bg-amber-100 text-amber-800" },
    canceled: { label: "Cancelada", className: "bg-slate-100 text-slate-700" },
    none: { label: "Sin plan", className: "bg-slate-100 text-slate-700" },
};

const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

function planName(plan) {
    return (plan && plan.name) || "";
}

/**
 * @param {{
 *   accountStatus?: string,
 *   subscriptionStatus?: string,
 *   assignedPlan?: { name?: string, price_cents?: number, billing_period?: string } | null,
 *   signupPlan?: { name?: string, price_cents?: number, billing_period?: string } | null,
 * }} input
 */
export function dashboardPlanView({
    accountStatus,
    subscriptionStatus,
    assignedPlan,
    signupPlan,
}) {
    const approved = accountStatus === "approved";
    const paid = PAID_STATUSES.has(subscriptionStatus);
    const displayPlan = assignedPlan || signupPlan || null;
    const name = planName(displayPlan) || (approved && paid ? "Sin plan" : "Tu plan");

    if (!approved) {
        return {
            name: planName(displayPlan) || "Tu plan",
            badge: { label: "En revisión", className: "bg-amber-100 text-amber-800" },
            subtitle: planName(displayPlan)
                ? "Tu plan aún está en revisión. Se activa cuando TYS apruebe tu cuenta y completes el pago."
                : "Tu cuenta está en revisión. El plan se activa después de la aprobación y el pago.",
            canManage: false,
            activateHref: null,
            showPrice: false,
            plan: displayPlan,
        };
    }

    if (!paid) {
        return {
            name: planName(displayPlan) || "Sin plan",
            badge: {
                label: subscriptionStatus === "canceled" ? "Cancelada" : "Pendiente de pago",
                className: "bg-amber-100 text-amber-800",
            },
            subtitle: planName(displayPlan)
                ? "Ya te aprobaron. Activá este plan para publicar eventos."
                : "Elegí un plan para publicar eventos.",
            canManage: false,
            activateHref: "/onboarding",
            showPrice: Boolean(displayPlan),
            plan: displayPlan,
        };
    }

    return {
        name: planName(assignedPlan) || planName(signupPlan) || "Sin plan",
        badge: DASHBOARD_SUB_BADGE[subscriptionStatus] || DASHBOARD_SUB_BADGE.active,
        subtitle: null,
        canManage: true,
        activateHref: null,
        showPrice: Boolean(assignedPlan),
        plan: assignedPlan || signupPlan,
    };
}
