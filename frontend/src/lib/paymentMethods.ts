/**
 * Payment method catalog helpers — dual-read of enabled_codes + legacy flags.
 */

export const CATALOG_PAYMENT_CODES = ["nuvei", "transfer", "cash"] as const;
export type CatalogPaymentCode = (typeof CATALOG_PAYMENT_CODES)[number];

const RETIRED_GATEWAY_ALIASES: Record<string, string> = {
    stripe: "nuvei",
    deuna: "nuvei",
    paypal: "nuvei",
};

/** Gateways without a live charge path (none — Nuvei is the only digital checkout). */
export const GATEWAY_STUB_CODES = new Set<string>();

const CATALOG_SET = new Set<string>(CATALOG_PAYMENT_CODES);

function canonicalCode(code: string): string {
    const lowered = code.trim().toLowerCase();
    return RETIRED_GATEWAY_ALIASES[lowered] || lowered;
}

export function resolveEnabledPaymentCodes(
    pm: Record<string, any> | null | undefined,
    { includeLegacyStripe = false }: { includeLegacyStripe?: boolean } = {},
): string[] {
    void includeLegacyStripe;
    if (!pm) return ["nuvei"];
    if (Array.isArray(pm.enabled_codes)) {
        const out: string[] = [];
        for (const c of pm.enabled_codes) {
            if (typeof c !== "string") continue;
            const code = canonicalCode(c);
            if (CATALOG_SET.has(code) && !out.includes(code)) {
                out.push(code);
            }
        }
        return out;
    }
    const codes: string[] = [];
    if (pm.stripe?.enabled) codes.push("nuvei");
    if (pm.transfer?.enabled) codes.push("transfer");
    if (pm.cash?.enabled) codes.push("cash");
    return codes.length ? codes : ["nuvei"];
}

export function defaultPaymentMethods() {
    return {
        enabled_codes: ["nuvei"] as string[],
        stripe: { enabled: false },
        transfer: {
            enabled: false,
            bank_name: "",
            account_number: "",
            account_holder: "",
            instructions: "",
        },
        cash: { enabled: false, location: "", schedule: "", contact: "" },
    };
}

/** Normalize event payment_methods for the wizard form. */
export function normalizePaymentMethodsForForm(pm: Record<string, any> | null | undefined) {
    const base = defaultPaymentMethods();
    if (!pm) return base;
    const enabled_codes = resolveEnabledPaymentCodes(pm);
    return {
        enabled_codes,
        stripe: { enabled: false },
        transfer: {
            enabled: enabled_codes.includes("transfer"),
            bank_name: pm.transfer?.bank_name || "",
            account_number: pm.transfer?.account_number || "",
            account_holder: pm.transfer?.account_holder || "",
            instructions: pm.transfer?.instructions || "",
        },
        cash: {
            enabled: enabled_codes.includes("cash"),
            location: pm.cash?.location || "",
            schedule: pm.cash?.schedule || "",
            contact: pm.cash?.contact || "",
        },
    };
}

export function withEnabledCodes(
    pm: Record<string, any>,
    codes: string[],
) {
    const enabled_codes = codes
        .map(canonicalCode)
        .filter((c) => CATALOG_SET.has(c))
        .filter((c, i, arr) => arr.indexOf(c) === i);
    return {
        ...pm,
        enabled_codes,
        stripe: { enabled: false },
        transfer: {
            ...(pm.transfer || baseTransfer()),
            enabled: enabled_codes.includes("transfer"),
        },
        cash: {
            ...(pm.cash || baseCash()),
            enabled: enabled_codes.includes("cash"),
        },
    };
}

function baseTransfer() {
    return {
        enabled: false,
        bank_name: "",
        account_number: "",
        account_holder: "",
        instructions: "",
    };
}

function baseCash() {
    return { enabled: false, location: "", schedule: "", contact: "" };
}
