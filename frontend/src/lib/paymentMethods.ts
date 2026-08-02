/**
 * Payment method catalog helpers — dual-read of enabled_codes + legacy flags.
 */

export const CATALOG_PAYMENT_CODES = ["nuvei", "deuna", "transfer", "cash"] as const;
export type CatalogPaymentCode = (typeof CATALOG_PAYMENT_CODES)[number];

const CATALOG_SET = new Set<string>(CATALOG_PAYMENT_CODES);

export function resolveEnabledPaymentCodes(
    pm: Record<string, any> | null | undefined,
    { includeLegacyStripe = false }: { includeLegacyStripe?: boolean } = {},
): string[] {
    if (!pm) return ["nuvei"];
    if (Array.isArray(pm.enabled_codes)) {
        const out: string[] = [];
        for (const c of pm.enabled_codes) {
            if (typeof c !== "string") continue;
            const code = c.trim().toLowerCase();
            if ((CATALOG_SET.has(code) || (includeLegacyStripe && code === "stripe")) && !out.includes(code)) {
                out.push(code);
            }
        }
        return out.length ? out : ["nuvei"];
    }
    const codes: string[] = [];
    if (includeLegacyStripe && pm.stripe?.enabled) codes.push("stripe");
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

/** Normalize event payment_methods for the wizard form (stripe out of UI). */
export function normalizePaymentMethodsForForm(pm: Record<string, any> | null | undefined) {
    const base = defaultPaymentMethods();
    if (!pm) return base;
    const enabled_codes = resolveEnabledPaymentCodes(pm, { includeLegacyStripe: false });
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
    const enabled_codes = codes.filter((c) => CATALOG_SET.has(c));
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
