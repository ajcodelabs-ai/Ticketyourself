/** Resolve which catalog plan unlocks a gated feature. */

export type PlanUnlock = { code: string; name: string };

export type PlanFeatures = Record<string, unknown> & {
    _plan_code?: string | null;
    _unlocks?: Record<string, PlanUnlock>;
};

export const UPGRADE_PLAN_PATH = "/app/configuracion";

export function planUnlock(
    features: PlanFeatures | null | undefined,
    feature: string,
): PlanUnlock | null {
    const entry = features?._unlocks?.[feature];
    if (!entry?.name) return null;
    return { code: entry.code, name: entry.name };
}

/** Badge copy for a locked control, e.g. "Disponible en Profesional". */
export function planLockLabel(
    features: PlanFeatures | null | undefined,
    feature: string,
): string {
    const name = planUnlock(features, feature)?.name;
    return name ? `Disponible en ${name}` : "Disponible en un plan superior";
}

export function upgradePlanHref(feature: string, unlock?: PlanUnlock | null): string {
    const params = new URLSearchParams({ tab: "plan", feature });
    if (unlock?.code) params.set("upgrade", unlock.code);
    return `${UPGRADE_PLAN_PATH}?${params.toString()}`;
}
