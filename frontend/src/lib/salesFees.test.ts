import { describe, expect, it } from "vitest";
import {
    bpsToPercent,
    dollarsToCents,
    formatFeeFormula,
    formatPriceRange,
    percentToBps,
} from "./salesFees";

describe("salesFees helpers", () => {
    it("converts percent to bps", () => {
        expect(percentToBps("4.50")).toBe(450);
        expect(bpsToPercent(250)).toBe("2.50");
    });

    it("formats formula and open-ended range", () => {
        expect(formatFeeFormula({ fee_mode: "percent", fee_percent_bps: 400 })).toBe(
            "4.00%",
        );
        expect(formatFeeFormula({ fee_mode: "fixed", fee_fixed_cents: 25 })).toBe(
            "$0.25",
        );
        expect(
            formatFeeFormula({ fee_fixed_cents: 25, fee_percent_bps: 400 }),
        ).toBe("4.00%");
        expect(
            formatPriceRange({ min_price_cents: 0, max_price_cents: null }),
        ).toBe("desde $0.00");
        expect(dollarsToCents("15.5")).toBe(1550);
    });
});
