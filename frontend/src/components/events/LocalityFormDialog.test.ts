import { describe, expect, it } from "vitest";
import { localityBuyerBreakdown, servicesWithAmount } from "./LocalityFormDialog";

describe("servicesWithAmount", () => {
    it("starts empty for a new locality", () => {
        expect(servicesWithAmount(null)).toEqual([]);
        expect(servicesWithAmount({})).toEqual([]);
    });

    it("only includes optional fees that already have an amount", () => {
        expect(
            servicesWithAmount({
                price_cents: 2500,
                service_fee_cents: 150,
                admin_fee_cents: 0,
                vxs_cents: 80,
                wallet_fee_cents: 0,
            }),
        ).toEqual(["service", "vxs"]);
    });
});

describe("localityBuyerBreakdown", () => {
    it("sums entrada + added services + TYS when the buyer pays the fee", () => {
        const result = localityBuyerBreakdown({
            money: { price: "10", service: "1.50", admin: "", vxs: "0.80", wallet: "" },
            addedServices: ["service", "vxs"],
            feeQuote: { fee_cents: 50 },
            feeBearer: "buyer",
        });
        expect(result.totalCents).toBe(1280);
        expect(result.tysOnBuyer).toBe(true);
        expect(result.lines.map((l) => l.key)).toEqual(["price", "service", "vxs", "tys"]);
    });

    it("does not add TYS to the buyer total when the organizer absorbs it", () => {
        const result = localityBuyerBreakdown({
            money: { price: "10", service: "2", admin: "", vxs: "", wallet: "" },
            addedServices: ["service"],
            feeQuote: { fee_cents: 75 },
            feeBearer: "organizer",
        });
        expect(result.totalCents).toBe(1200);
        expect(result.tysAbsorbed).toBe(true);
        expect(result.lines.some((l) => l.key === "tys")).toBe(false);
    });
});


describe("servicesWithAmount", () => {
    it("starts empty for a new locality", () => {
        expect(servicesWithAmount(null)).toEqual([]);
        expect(servicesWithAmount({})).toEqual([]);
    });

    it("only includes optional fees that already have an amount", () => {
        expect(
            servicesWithAmount({
                price_cents: 2500,
                service_fee_cents: 150,
                admin_fee_cents: 0,
                vxs_cents: 80,
                wallet_fee_cents: 0,
            }),
        ).toEqual(["service", "vxs"]);
    });
});
