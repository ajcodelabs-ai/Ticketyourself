import { describe, expect, it } from "vitest";
import { resolveEnabledPaymentCodes } from "@/lib/paymentMethods";

describe("resolveEnabledPaymentCodes", () => {
    it("respects an explicit empty enabled_codes array instead of defaulting to nuvei", () => {
        expect(resolveEnabledPaymentCodes({ enabled_codes: [] })).toEqual([]);
    });

    it("still defaults to nuvei when payment_methods is missing entirely", () => {
        expect(resolveEnabledPaymentCodes(null)).toEqual(["nuvei"]);
    });

    it("returns the codes as configured when enabled_codes is non-empty", () => {
        expect(resolveEnabledPaymentCodes({ enabled_codes: ["transfer", "cash"] })).toEqual([
            "transfer",
            "cash",
        ]);
    });
});
