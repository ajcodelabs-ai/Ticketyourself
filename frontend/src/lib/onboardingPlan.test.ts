import { describe, expect, it } from "vitest";
import {
    onboardingPayCta,
    planChargeLabel,
    resolveOnboardingPlan,
} from "./onboardingPlan";

const profesional = {
    code: "profesional",
    name: "Profesional",
    price_cents: 5000,
    billing_period: "monthly",
};
const evento = {
    code: "evento-unico",
    name: "Evento único",
    price_cents: 5000,
    billing_period: "one_time",
};

describe("resolveOnboardingPlan", () => {
    it("prefers the plan saved on the organizer over localStorage", () => {
        const resolved = resolveOnboardingPlan({
            signupPlanCode: "profesional",
            localPlanCode: "basico",
            plans: [profesional, evento],
        });
        expect(resolved.code).toBe("profesional");
        expect(resolved.plan.name).toBe("Profesional");
    });

    it("falls back to the local register choice", () => {
        const resolved = resolveOnboardingPlan({
            signupPlanCode: null,
            localPlanCode: "evento-unico",
            plans: [profesional, evento],
        });
        expect(resolved.plan.code).toBe("evento-unico");
    });
});

describe("planChargeLabel", () => {
    it("shows monthly and one-time amounts", () => {
        expect(planChargeLabel(profesional)).toBe("$50 / mes");
        expect(planChargeLabel(evento)).toBe("$50 (pago único)");
    });
});

describe("onboardingPayCta", () => {
    it("puts the amount on the pay button", () => {
        expect(onboardingPayCta(profesional, false)).toBe("Pagar $50 / mes");
        expect(onboardingPayCta(profesional, true)).toBe("Procesando…");
    });
});
