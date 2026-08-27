import { describe, expect, it } from "vitest";
import { planLockLabel, planUnlock, upgradePlanHref } from "./planUnlock";

const feats = {
    numbered_seating: false,
    _unlocks: {
        numbered_seating: { code: "profesional", name: "Profesional" },
        verified_lists: { code: "enterprise", name: "Enterprise" },
    },
};

describe("planUnlock", () => {
    it("reads the cheapest unlocking plan", () => {
        expect(planUnlock(feats, "numbered_seating")).toEqual({
            code: "profesional",
            name: "Profesional",
        });
        expect(planLockLabel(feats, "numbered_seating")).toBe("Disponible en Profesional");
        expect(planLockLabel(feats, "verified_lists")).toBe("Disponible en Enterprise");
    });

    it("falls back when the catalog has no match", () => {
        expect(planUnlock({}, "promo_codes")).toBeNull();
        expect(planLockLabel({}, "promo_codes")).toBe("Disponible en un plan superior");
    });

    it("builds the billing deep-link", () => {
        expect(upgradePlanHref("numbered_seating", feats._unlocks.numbered_seating)).toBe(
            "/app/configuracion?tab=plan&feature=numbered_seating&upgrade=profesional",
        );
    });
});
