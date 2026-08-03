import { describe, expect, it } from "vitest";
import { draftToRule, ruleToDraft } from "./DiscountRulesPanel";

describe("DiscountRulesPanel quantity-rule round trip", () => {
    it("preserves type=quantity and min_quantity when re-saving an existing quantity rule", () => {
        const existing = {
            id: "r1",
            name: "10% off 5+",
            type: "quantity",
            enabled: true,
            min_quantity: 5,
            discount: { type: "percent", value: 10 },
            conditions: {},
        };

        const draft = ruleToDraft(existing);
        const saved = draftToRule(draft);

        expect(saved.type).toBe("quantity");
        expect(saved.min_quantity).toBe(5);
    });

    it("still saves as auto when there is no code and no min_quantity", () => {
        const draft = ruleToDraft({
            id: "r2",
            name: "10% off everyone",
            type: "auto",
            enabled: true,
            discount: { type: "percent", value: 10 },
            conditions: {},
        });
        const saved = draftToRule(draft);
        expect(saved.type).toBe("auto");
        expect(saved.min_quantity).toBeNull();
    });
});
