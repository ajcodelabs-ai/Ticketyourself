/**
 * Nuvei Ecuador (Paymentez):
 * - reference mode: PaymentCheckout.modal (SERVER init_reference)
 * - tokenize mode: PaymentGateway + /nuvei/charge (CLIENT; SERVER → 401)
 *
 * CDN scripts expose classes in classic-script scope; we bridge to window for ESM.
 */

declare global {
    interface Window {
        PaymentGateway?: new (
            env: string,
            appCode: string,
            appKey: string,
        ) => PaymentGatewayInstance;
        __TYS_PaymentGateway?: new (
            env: string,
            appCode: string,
            appKey: string,
        ) => PaymentGatewayInstance;
        PaymentCheckout?: {
            // Must be called with `new` (constructor); bare call → this.init is not a function
            modal: new (opts: Record<string, unknown>) => PaymentCheckoutModal;
        };
        jQuery?: unknown;
    }
}

type PaymentGatewayInstance = {
    generate_tokenize: (
        data: Record<string, unknown>,
        selector: string,
        onSuccess: (response: Record<string, unknown>) => void,
        onIncomplete: (message: string) => void,
    ) => void;
    tokenize: () => void;
};

type PaymentCheckoutModal = {
    open: (opts: { reference: string }) => void;
    close: () => void;
};

export type NuveiCheckoutConfig = {
    checkout_mode?: "tokenize" | "reference" | "client" | string;
    reference?: string;
    session_token?: string;
    nuvei_env?: string;
    env?: string;
    checkout_js_url?: string;
    checkout_url?: string;
    client_unique_id?: string;
    client_app_code?: string;
    client_app_key?: string;
    amount?: string | number;
    currency?: string;
    user_id?: string;
    user_email?: string;
    user_phone?: string;
    order_description?: string;
    order_vat?: string | number;
    order_installments_type?: number;
    merchant_id?: string;
    merchant_site_id?: string;
};

const TOKENIZE_JS =
    "https://cdn.paymentez.com/ccapi/sdk/payment_sdk_stable.min.js";
const CHECKOUT_JS =
    "https://cdn.paymentez.com/ccapi/sdk/payment_checkout_3.0.0.min.js";
const JQUERY_JS = "https://code.jquery.com/jquery-3.5.0.min.js";

let tokenizeLoading: Promise<void> | null = null;
let checkoutLoading: Promise<void> | null = null;

function envMode(config: NuveiCheckoutConfig): "stg" | "prod" {
    const raw = String(config.nuvei_env || config.env || "stg").toLowerCase();
    if (raw === "prod" || raw === "live" || raw === "production") return "prod";
    return "stg";
}

function resolvePaymentGateway() {
    return window.__TYS_PaymentGateway || window.PaymentGateway;
}

function bridgePaymentGatewayFromClassicScope(): void {
    if (resolvePaymentGateway()) return;
    const bridge = document.createElement("script");
    bridge.textContent =
        "window.__TYS_PaymentGateway = typeof PaymentGateway !== 'undefined' ? PaymentGateway : undefined;" +
        "window.PaymentGateway = window.__TYS_PaymentGateway;";
    document.head.appendChild(bridge);
    bridge.remove();
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

export async function loadNuveiTokenizeJs(src?: string): Promise<void> {
    if (resolvePaymentGateway()) return;
    if (tokenizeLoading) return tokenizeLoading;
    tokenizeLoading = (async () => {
        await loadScript(src || TOKENIZE_JS, "paymentez-tokenize");
        bridgePaymentGatewayFromClassicScope();
        if (!resolvePaymentGateway()) {
            throw new Error(
                "PaymentGateway no está disponible tras cargar el SDK de Nuvei",
            );
        }
    })();
    try {
        await tokenizeLoading;
    } catch (e) {
        tokenizeLoading = null;
        throw e;
    }
}

export async function loadNuveiCheckoutJs(src?: string): Promise<void> {
    if (window.PaymentCheckout?.modal) return;
    if (checkoutLoading) return checkoutLoading;
    checkoutLoading = (async () => {
        if (!window.jQuery) {
            await loadScript(JQUERY_JS, "jquery");
        }
        await loadScript(src || CHECKOUT_JS, "paymentez-checkout");
        if (!window.PaymentCheckout?.modal) {
            throw new Error(
                "PaymentCheckout no está disponible tras cargar el SDK de Nuvei",
            );
        }
    })();
    try {
        await checkoutLoading;
    } catch (e) {
        checkoutLoading = null;
        throw e;
    }
}

export function extractCardToken(
    response: Record<string, unknown> | null | undefined,
): string | null {
    if (!response || response.error) return null;
    const card = (response.card || response) as Record<string, unknown>;
    const token = card.token;
    return token != null ? String(token) : null;
}

/** SERVER flow: open PaymentCheckout.modal with init_reference. */
export async function openNuveiReferenceCheckout(
    config: NuveiCheckoutConfig,
    {
        onResponse,
        onError,
    }: {
        onResponse: (response: Record<string, unknown>) => void;
        onError?: (message: string) => void;
    },
): Promise<{ open: () => void; close: () => void }> {
    const reference = String(config.reference || config.session_token || "").trim();
    if (!reference) {
        throw new Error("Falta reference de Nuvei (init_reference)");
    }
    await loadNuveiCheckoutJs(config.checkout_js_url);

    // Docs: `new PaymentCheckout.modal({ ... })` — without `new`, this.init breaks.
    const ModalCtor = window.PaymentCheckout!.modal;
    const modal = new ModalCtor({
        env_mode: envMode(config),
        onOpen: () => {},
        onClose: () => {},
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
    });

    return {
        open: () => modal.open({ reference }),
        close: () => modal.close(),
    };
}

export async function mountNuveiTokenizeForm(
    config: NuveiCheckoutConfig,
    {
        containerSelector,
        onToken,
        onError,
    }: {
        containerSelector: string;
        onToken: (token: string, raw: Record<string, unknown>) => void;
        onError?: (message: string) => void;
    },
): Promise<{ tokenize: () => void }> {
    if (!config.client_app_code || !config.client_app_key) {
        throw new Error(
            "Faltan credenciales CLIENT de Nuvei para tokenize (SERVER da 401).",
        );
    }
    await loadNuveiTokenizeJs(config.checkout_js_url);

    const Gateway = resolvePaymentGateway();
    if (!Gateway) {
        throw new Error("PaymentGateway no está disponible");
    }

    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const el = document.querySelector(containerSelector);
    if (!el) {
        throw new Error(`Contenedor ${containerSelector} no encontrado`);
    }

    const pg = new Gateway(
        envMode(config),
        config.client_app_code,
        config.client_app_key,
    );

    const tokenizeData = {
        locale: "es",
        user: {
            id: String(config.user_id || config.user_email || config.client_unique_id),
            email: config.user_email || "noreply@ticketyourself.com",
        },
        configuration: {
            default_country: "ECU",
        },
    };

    pg.generate_tokenize(
        tokenizeData,
        containerSelector,
        (response) => {
            const token = extractCardToken(response);
            if (!token) {
                const err = response?.error as Record<string, unknown> | undefined;
                onError?.(
                    String(
                        err?.description ||
                            err?.type ||
                            err?.help ||
                            "No se pudo tokenizar la tarjeta",
                    ),
                );
                return;
            }
            onToken(token, response);
        },
        (message) => {
            onError?.(message || "Completá los datos de la tarjeta");
        },
    );

    return {
        tokenize: () => {
            try {
                pg.tokenize();
            } catch (e: any) {
                onError?.(e?.message || String(e) || "Error al tokenizar");
                throw e;
            }
        },
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
    if (!["success", "1", "approved", "ok"].includes(status)) return false;
    if (detail === null || Number.isNaN(detail)) return true;
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
