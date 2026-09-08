import { afterEach, describe, expect, it } from "vitest";
import {
    BILLING_INTENT_STATUS_META,
    billingCheckoutStorageKey,
    billingPeriodLabel,
    billingSuccessPath,
    clearBillingCheckout,
    isBillingIntentPending,
    loadBillingCheckout,
    saveBillingCheckout,
} from "./billingCheckout";

afterEach(() => {
    sessionStorage.clear();
});

describe("billingSuccessPath", () => {
    it("puts session and intent on the processing page URL", () => {
        expect(
            billingSuccessPath({ sessionId: "bill_abc", intentId: "intent-1" }),
        ).toBe("/billing/success?session_id=bill_abc&intent_id=intent-1");
    });

    it("works with only session_id (Nuvei return URL)", () => {
        expect(billingSuccessPath({ sessionId: "bill_abc" })).toBe(
            "/billing/success?session_id=bill_abc",
        );
    });
});

describe("billing intent status", () => {
    it("treats gateway holds as pending, like a ticket waiting on the bank", () => {
        expect(isBillingIntentPending("pending")).toBe(true);
        expect(isBillingIntentPending("pending_gateway")).toBe(true);
        expect(isBillingIntentPending("completed")).toBe(false);
        expect(BILLING_INTENT_STATUS_META.pending.label).toBe("Pendiente");
        expect(BILLING_INTENT_STATUS_META.completed.label).toBe("Pagado");
    });

    it("labels billing periods in Spanish", () => {
        expect(billingPeriodLabel("monthly")).toBe("Mensual");
        expect(billingPeriodLabel("one_time")).toBe("Pago único");
    });
});

describe("billing checkout sessionStorage", () => {
    it("round-trips the Nuvei payload so success can reopen checkout", () => {
        const payload = { session_id: "bill_1", payment_url: "https://pay.example" };
        saveBillingCheckout("bill_1", payload);
        expect(billingCheckoutStorageKey("bill_1")).toBe("tys_billing_checkout_bill_1");
        expect(loadBillingCheckout("bill_1")).toEqual(payload);
        clearBillingCheckout("bill_1");
        expect(loadBillingCheckout("bill_1")).toBeNull();
    });
});
