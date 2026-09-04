import { describe, expect, it } from "vitest";
import {
    approveConfirmMessage,
    isVerificanteLow,
    needsApproveConfirm,
    verificanteRiskMeta,
} from "./verificante";

describe("verificanteRiskMeta", () => {
    it("labels low / medium / high in Spanish", () => {
        expect(verificanteRiskMeta("LOW").label).toBe("Riesgo bajo");
        expect(verificanteRiskMeta("medium").label).toBe("Riesgo medio");
        expect(verificanteRiskMeta("high").label).toBe("Riesgo alto");
    });
});

describe("isVerificanteLow", () => {
    it("treats only low as admitted", () => {
        expect(isVerificanteLow({ risk_level: "low" })).toBe(true);
        expect(isVerificanteLow({ risk_level: "LOW" })).toBe(true);
        expect(isVerificanteLow({ risk_level: "high" })).toBe(false);
        expect(isVerificanteLow(null)).toBe(false);
    });
});

describe("needsApproveConfirm", () => {
    it("skips confirm when risk is low or check was skipped", () => {
        expect(needsApproveConfirm({ status: "completed", risk_level: "LOW" })).toBe(
            false,
        );
        expect(needsApproveConfirm({ status: "skipped" })).toBe(false);
        expect(needsApproveConfirm(null)).toBe(false);
        expect(needsApproveConfirm({})).toBe(false);
    });

    it("asks confirm when pending, failed, or not low", () => {
        expect(needsApproveConfirm({ status: "pending" })).toBe(true);
        expect(needsApproveConfirm({ status: "failed" })).toBe(true);
        expect(needsApproveConfirm({ status: "completed", risk_level: "HIGH" })).toBe(
            true,
        );
    });
});

describe("approveConfirmMessage", () => {
    it("mentions pending vs risk", () => {
        expect(approveConfirmMessage({ status: "pending" })).toMatch(/pendiente/i);
        expect(approveConfirmMessage({ status: "completed", risk_level: "HIGH" })).toMatch(
            /riesgo alto/i,
        );
    });
});
