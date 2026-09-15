import { describe, expect, it } from "vitest";
import { classifyPlanChange } from "./planChange";

const PLANS = [
    { code: "evento_unico", price_cents: 5000 },
    { code: "basico", price_cents: 2000 },
    { code: "profesional", price_cents: 5000 },
    { code: "enterprise", price_cents: 20000 },
];

describe("classifyPlanChange", () => {
    it("buckets same-priced plans as lateral, not downgrade", () => {
        // evento_unico and profesional are both $50 but very different tiers —
        // a same-price plan must never land in "downgrade" (no misleading warning).
        const { upgrades, lateral, downgrades } = classifyPlanChange(
            PLANS,
            "evento_unico",
            5000,
        );
        expect(lateral.map((p) => p.code)).toEqual(["profesional"]);
        expect(downgrades.map((p) => p.code)).toEqual(["basico"]);
        expect(upgrades.map((p) => p.code)).toEqual(["enterprise"]);
    });

    it("excludes the current plan from every bucket", () => {
        const { upgrades, lateral, downgrades } = classifyPlanChange(
            PLANS,
            "basico",
            2000,
        );
        const all = [...upgrades, ...lateral, ...downgrades];
        expect(all.find((p) => p.code === "basico")).toBeUndefined();
    });
});
