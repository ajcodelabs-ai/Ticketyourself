import { describe, expect, it } from "vitest";
import { dashboardPlanView } from "./dashboardPlan";

const profesional = {
    name: "Profesional",
    price_cents: 4900,
    billing_period: "monthly",
};

describe("dashboardPlanView", () => {
    it("shows the signup plan while the account is under review", () => {
        const view = dashboardPlanView({
            accountStatus: "pending",
            subscriptionStatus: "none",
            assignedPlan: null,
            signupPlan: profesional,
        });
        expect(view.name).toBe("Profesional");
        expect(view.badge.label).toBe("En revisión");
        expect(view.subtitle).toMatch(/aún está en revisión/);
        expect(view.canManage).toBe(false);
        expect(view.activateHref).toBeNull();
    });

    it("hides manage until the account is approved and paid", () => {
        const unpaid = dashboardPlanView({
            accountStatus: "approved",
            subscriptionStatus: "none",
            assignedPlan: null,
            signupPlan: profesional,
        });
        expect(unpaid.name).toBe("Profesional");
        expect(unpaid.canManage).toBe(false);
        expect(unpaid.activateHref).toBe("/onboarding");

        const paid = dashboardPlanView({
            accountStatus: "approved",
            subscriptionStatus: "active",
            assignedPlan: profesional,
            signupPlan: profesional,
        });
        expect(paid.name).toBe("Profesional");
        expect(paid.canManage).toBe(true);
        expect(paid.badge.label).toBe("Activa");
    });
});
