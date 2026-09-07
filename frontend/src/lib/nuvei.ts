/**
 * Nuvei Ecuador (Paymentez) Checkout v3.
 * Backend POST init_reference → browser PaymentCheckout.modal.open({ reference }).
 * Checkout v2 (init_checkout + payment_checkout_stable.js) is deprecated.
 */

declare global {
    interface Window {
        PaymentCheckout?: {
            modal: new (opts: Record<string, unknown>) => PaymentCheckoutModal;
        };
        jQuery?: unknown;
    }
}

type PaymentCheckoutModal = {
    open: (opts: Record<string, unknown>) => void;
    close: () => void;
};

export type NuveiCheckoutConfig = {
    checkout_mode?: "client" | "linktopay" | "reference" | string;
    reference?: string;
    session_token?: string;
    nuvei_env?: string;
    env?: string;
    checkout_js_url?: string;
    checkout_url?: string;
    payment_url?: string;
    client_app_code?: string;
    client_app_key?: string;
    client_unique_id?: string;
    amount?: string | number;
    currency?: string;
    user_id?: string;
    user_email?: string;
    user_phone?: string;
    user_first_name?: string;
    user_last_name?: string;
    order_description?: string;
    order_vat?: string | number;
    order_installments_type?: number;
};

/** SDK 3.x: `open({ reference })` after `POST /v2/transaction/init_reference/`. */
export const CHECKOUT_JS_REFERENCE =
    "https://cdn.paymentez.com/ccapi/sdk/payment_checkout_3.0.0.min.js";
const JQUERY_JS = "https://code.jquery.com/jquery-3.5.0.min.js";

const checkoutLoadingByUrl = new Map<string, Promise<void>>();

export function nuveiPaymentUrl(config: NuveiCheckoutConfig | null | undefined): string {
    if (!config) return "";
    return String(config.payment_url || "").trim();
}

function envMode(config: NuveiCheckoutConfig): "stg" | "prod" {
    const raw = String(config.nuvei_env || config.env || "stg").toLowerCase();
    if (raw === "prod" || raw === "live" || raw === "production") return "prod";
    return "stg";
}

function loadScript(src: string, marker: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
            `script[data-tys-script="${marker}"]`,
        );
        if (existing?.dataset.loaded === "1") {
            resolve();
            return;
        }
        if (existing) {
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () =>
                reject(new Error(`No se pudo cargar ${marker}`)),
            );
            return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.charset = "UTF-8";
        script.dataset.tysScript = marker;
        script.onload = () => {
            script.dataset.loaded = "1";
            resolve();
        };
        script.onerror = () => reject(new Error(`No se pudo cargar ${marker}`));
        document.head.appendChild(script);
    });
}

function checkoutScriptMarker(src: string): string {
    return `paymentez-${src.split("/").pop() || "checkout"}`;
}

function ensurePaymentezOverlayCss(): void {
    const id = "tys-paymentez-overlay-z";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    // Paymentez usa z-index:1000 e inserta el nodo como primer hijo de body.
    // El Dialog de Radix (z-50 + portal al final de body) lo tapaba.
    style.textContent = `
      .payment-checkout-modal {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483000 !important;
      }
    `;
    document.head.appendChild(style);
}

export async function loadNuveiCheckoutJs(src?: string): Promise<void> {
    const url = src || CHECKOUT_JS_REFERENCE;
    const pending = checkoutLoadingByUrl.get(url);
    if (pending) return pending;
    const loading = (async () => {
        if (!window.jQuery) {
            await loadScript(JQUERY_JS, "jquery");
        }
        await loadScript(url, checkoutScriptMarker(url));
        ensurePaymentezOverlayCss();
        if (!window.PaymentCheckout?.modal) {
            throw new Error(
                "PaymentCheckout no está disponible tras cargar el SDK de Nuvei",
            );
        }
    })();
    checkoutLoadingByUrl.set(url, loading);
    try {
        await loading;
    } catch (e) {
        checkoutLoadingByUrl.delete(url);
        throw e;
    }
}

type CheckoutHandlers = {
    onResponse: (response: Record<string, unknown>) => void;
    onError?: (message: string) => void;
    onOpen?: () => void;
    onClose?: () => void;
};

function attachModalHandlers(
    config: NuveiCheckoutConfig,
    extraCtor: Record<string, unknown>,
    { onResponse, onError, onOpen, onClose }: CheckoutHandlers,
) {
    const ModalCtor = window.PaymentCheckout!.modal;
    return new ModalCtor({
        env_mode: envMode(config),
        locale: "es",
        onOpen: () => onOpen?.(),
        onClose: () => onClose?.(),
        onResponse: (response: Record<string, unknown>) => {
            if (response?.error) {
                const err = response.error as Record<string, unknown>;
                onError?.(
                    String(
                        err.description ||
                            err.type ||
                            err.help ||
                            "Error en checkout Nuvei",
                    ),
                );
                return;
            }
            onResponse(response);
        },
        ...extraCtor,
    });
}

export async function openNuveiReferenceCheckout(
    config: NuveiCheckoutConfig,
    handlers: CheckoutHandlers,
): Promise<{ open: () => void; close: () => void }> {
    const reference = String(config.reference || config.session_token || "").trim();
    if (!reference) {
        throw new Error("Falta reference de Nuvei (init_reference)");
    }
    await loadNuveiCheckoutJs(config.checkout_js_url || CHECKOUT_JS_REFERENCE);
    const modal = attachModalHandlers(config, {}, handlers);
    return {
        open: () => modal.open({ reference }),
        close: () => modal.close(),
    };
}

export function nuveiCheckoutFromApi(
    data: Record<string, unknown> | null | undefined,
): NuveiCheckoutConfig | null {
    if (!data || data.status !== "nuvei_checkout") return null;
    const mode = String(data.checkout_mode || "");
    const hasGateway = Boolean(
        data.reference || data.session_token || data.payment_url,
    );
    if (!hasGateway) return null;
    return {
        reference: String(data.reference || data.session_token || ""),
        session_token: String(data.session_token || data.reference || ""),
        checkout_mode: mode || undefined,
        nuvei_env: data.nuvei_env as string | undefined,
        checkout_js_url: data.checkout_js_url as string | undefined,
        checkout_url: data.checkout_url as string | undefined,
        payment_url: String(data.payment_url || ""),
        client_app_code: data.client_app_code as string | undefined,
        client_app_key: data.client_app_key as string | undefined,
        client_unique_id: String(
            data.client_unique_id || data.order_number || data.session_id || "",
        ),
        amount: data.amount as string | number | undefined,
        currency: data.currency as string | undefined,
        user_id: data.user_id as string | undefined,
        user_email: data.user_email as string | undefined,
        user_phone: data.user_phone as string | undefined,
        user_first_name: data.user_first_name as string | undefined,
        user_last_name: data.user_last_name as string | undefined,
        order_description: data.order_description as string | undefined,
        order_vat: data.order_vat as string | number | undefined,
        order_installments_type: data.order_installments_type as number | undefined,
    };
}

export function isApprovedNuveiResult(
    result: Record<string, unknown> | null | undefined,
): boolean {
    if (!result || result.error) return false;
    const txn = (result.transaction || result) as Record<string, unknown>;
    const status = String(txn.status || result.status || "").toLowerCase();
    const detailRaw = txn.status_detail ?? result.status_detail;
    const detail =
        detailRaw === undefined || detailRaw === null || detailRaw === ""
            ? null
            : Number(detailRaw);
    // Nuvei Ecuador: approved iff status success|1 AND status_detail 3.
    if (!["success", "1"].includes(status)) return false;
    return detail === 3;
}

export function extractNuveiTransactionId(
    result: Record<string, unknown> | null | undefined,
): string | null {
    if (!result) return null;
    const txn = (result.transaction || result) as Record<string, unknown>;
    const id = txn.id || result.transaction_id;
    return id != null ? String(id) : null;
}
