import { describe, expect, it } from "vitest";
import {
    isApprovedNuveiResult,
    isBillingNuveiCheckout,
    nuveiCheckoutFromApi,
    nuveiPaymentUrl,
} from "./nuvei";

describe("nuveiCheckoutFromApi", () => {
    it("accepts Checkout v3 reference without treating checkout_url as Link to Pay", () => {
        const config = nuveiCheckoutFromApi({
            status: "nuvei_checkout",
            checkout_mode: "reference",
            reference: "12438255612471559230",
            session_token: "12438255612471559230",
            checkout_url:
                "https://ccapi-stg.paymentez.com/v2/transaction/checkout?reference=12438255612471559230",
            payment_url: null,
            amount: "10.00",
            client_unique_id: "TYS-1",
            order_number: "TYS-1",
        });
        expect(config?.checkout_mode).toBe("reference");
        expect(config?.reference).toBe("12438255612471559230");
        expect(config?.client_unique_id).toBe("TYS-1");
        expect(nuveiPaymentUrl(config)).toBe("");
    });

    it("keeps Link to Pay payment_url", () => {
        const config = nuveiCheckoutFromApi({
            status: "nuvei_checkout",
            checkout_mode: "linktopay",
            payment_url: "https://test.paymentez.link/checkout/abc",
            reference: "abc",
            intent_id: "intent-1",
            client_unique_id: "bill_abc",
        });
        expect(nuveiPaymentUrl(config)).toBe("https://test.paymentez.link/checkout/abc");
        expect(config?.intent_id).toBe("intent-1");
        expect(isBillingNuveiCheckout(config)).toBe(true);
    });

    it("rejects payloads without a gateway reference", () => {
        expect(
            nuveiCheckoutFromApi({
                status: "nuvei_checkout",
                checkout_mode: "client",
                client_app_code: "TESTNUVEISTG-EC-CLIENT",
            }),
        ).toBeNull();
    });
});

describe("isApprovedNuveiResult", () => {
    it("requires status success|1 and status_detail 3", () => {
        expect(
            isApprovedNuveiResult({
                transaction: { status: "success", status_detail: 3, id: "CI-1" },
            }),
        ).toBe(true);
        expect(
            isApprovedNuveiResult({
                transaction: { status: "1", status_detail: "3", id: "CI-1" },
            }),
        ).toBe(true);
        expect(
            isApprovedNuveiResult({
                transaction: { status: "success", id: "CI-1" },
            }),
        ).toBe(false);
        expect(
            isApprovedNuveiResult({
                transaction: { status: "success", status_detail: 9, id: "CI-1" },
            }),
        ).toBe(false);
        expect(
            isApprovedNuveiResult({
                transaction: { status: "failure", status_detail: 3, id: "CI-1" },
            }),
        ).toBe(false);
    });
});
