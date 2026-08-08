/**
 * Nuvei Simply Connect helpers.
 * Docs: openOrder (server) → checkout() with sessionToken (client).
 */

declare global {
    interface Window {
        checkout?: (opts: Record<string, unknown>) => void;
    }
}

export type NuveiCheckoutConfig = {
    session_token: string;
    merchant_id: string;
    merchant_site_id: string;
    nuvei_env?: string;
    env?: string;
    checkout_js_url?: string;
    client_unique_id?: string;
};

const DEFAULT_JS =
    "https://cdn.safecharge.com/safecharge_resources/v1/checkout/checkout.js";

let loading: Promise<void> | null = null;

export function loadNuveiCheckoutJs(src?: string): Promise<void> {
    const url = src || DEFAULT_JS;
    if (typeof window !== "undefined" && typeof window.checkout === "function") {
        return Promise.resolve();
    }
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
            `script[data-nuvei-checkout="1"]`,
        );
        if (existing) {
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () =>
                reject(new Error("No se pudo cargar Nuvei checkout.js")),
            );
            return;
        }
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.dataset.nuveiCheckout = "1";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar Nuvei checkout.js"));
        document.head.appendChild(script);
    });
    return loading;
}

export function isApprovedNuveiResult(result: Record<string, unknown> | null | undefined): boolean {
    const status = String(
        result?.result || result?.transactionStatus || result?.status || "",
    ).toUpperCase();
    return ["APPROVED", "SUCCESS", "OK"].includes(status);
}

export async function startNuveiCheckout(
    config: NuveiCheckoutConfig,
    {
        renderTo,
        onResult,
        onError,
    }: {
        renderTo: string;
        onResult: (result: Record<string, unknown>) => void;
        onError?: (err: unknown) => void;
    },
): Promise<void> {
    await loadNuveiCheckoutJs(config.checkout_js_url);
    if (typeof window.checkout !== "function") {
        throw new Error("Nuvei checkout() no está disponible");
    }
    const env = config.nuvei_env || config.env || "int";
    window.checkout({
        sessionToken: config.session_token,
        merchantId: config.merchant_id,
        merchantSiteId: config.merchant_site_id,
        env,
        country: "EC",
        locale: "es",
        renderTo,
        onResult: (result: Record<string, unknown>) => {
            try {
                onResult(result || {});
            } catch (e) {
                onError?.(e);
            }
        },
    });
}
