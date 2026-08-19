/**
 * DEUNA Payment Widget helpers.
 * Docs: https://docs.deuna.com/reference/web-sdk
 * Server creates orderToken via private API; client uses publicApiKey + initPaymentWidget.
 */

declare global {
    interface Window {
        DeunaSDK?: {
            initialize: (opts: Record<string, unknown>) => Promise<void>;
            initPaymentWidget: (opts: Record<string, unknown>) => Promise<void>;
            close: () => Promise<void>;
        };
    }
}

export type DeunaCheckoutConfig = {
    order_token: string;
    public_api_key: string;
    deuna_env?: string;
    env?: string;
    checkout_js_url?: string;
    /** Merchant order id (TYS order_number or bill_*) */
    order_id?: string;
};

const DEFAULT_JS = "https://cdn.deuna.io/web-sdk/v1.6/index.js";

let loading: Promise<void> | null = null;

export function loadDeunaSdk(src?: string): Promise<void> {
    const url = src || DEFAULT_JS;
    if (typeof window !== "undefined" && window.DeunaSDK) {
        return Promise.resolve();
    }
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
            `script[data-deuna-sdk="1"]`,
        );
        if (existing) {
            // Script tag exists — if already loaded resolve immediately, otherwise wait.
            if (window.DeunaSDK) {
                resolve();
                return;
            }
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () => {
                loading = null; // allow retry on next call
                reject(new Error("No se pudo cargar DEUNA Web SDK"));
            });
            return;
        }
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.crossOrigin = "anonymous";
        script.dataset.deunaSdk = "1";
        script.onload = () => resolve();
        script.onerror = () => {
            loading = null; // allow retry on next call
            reject(new Error("No se pudo cargar DEUNA Web SDK"));
        };
        document.head.appendChild(script);
    });
    return loading;
}

export function isPaidDeunaResult(data: Record<string, unknown> | null | undefined): boolean {
    const order = (data?.order as Record<string, unknown>) || data || {};
    const status = String(order.status || data?.status || "").toLowerCase();
    const payment = (order.payment as Record<string, unknown>) || {};
    const payData = (payment.data as Record<string, unknown>) || {};
    const payStatus = String(payData.status || "").toLowerCase();
    const paid = new Set([
        "succeeded",
        "success",
        "completed",
        "paid",
        "processed",
        "authorized",
        "captured",
        "approved",
    ]);
    return paid.has(status) || paid.has(payStatus);
}

export async function startDeunaCheckout(
    config: DeunaCheckoutConfig,
    {
        onSuccess,
        onError,
        onClosed,
    }: {
        onSuccess: (data: Record<string, unknown>) => void;
        onError?: (err: unknown) => void;
        onClosed?: (action: string) => void;
    },
): Promise<void> {
    await loadDeunaSdk(config.checkout_js_url);
    const sdk = window.DeunaSDK;
    if (!sdk?.initialize || !sdk?.initPaymentWidget) {
        throw new Error("DeunaSDK no está disponible");
    }

    const env =
        config.deuna_env ||
        config.env ||
        "sandbox";

    await sdk.initialize({
        publicApiKey: config.public_api_key,
        env: env === "production" || env === "prod" || env === "live" ? "production" : "sandbox",
    });

    await sdk.initPaymentWidget({
        orderToken: config.order_token,
        language: "es",
        callbacks: {
            onSuccess: async (data: Record<string, unknown>) => {
                try {
                    await sdk.close();
                } catch {
                    /* ignore */
                }
                onSuccess(data || {});
            },
            onError: (error: unknown) => {
                onError?.(error);
            },
            onClosed: (action: string) => {
                onClosed?.(action);
            },
        },
    });
}
