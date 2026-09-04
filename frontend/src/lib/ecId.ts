/**
 * Ecuador cédula / RUC checksum (SRI / Registro Civil).
 *
 * Cédula: módulo 10, coeficientes 2-1-2-1-2-1-2-1-2.
 * RUC natural: cédula + establecimiento ≠ 000.
 * RUC privado (3er dígito 9): módulo 11, salvo secuencial ≥ 1_000_000.
 * RUC público (3er dígito 6): módulo 11, coeficientes 3-2-7-6-5-4-3-2.
 *
 * El 3er dígito de persona natural admite 0–6 (ciudades grandes).
 * Provincia 30 = registrados en el exterior.
 */

const MODULO_10 = [2, 1, 2, 1, 2, 1, 2, 1, 2];
const MODULO_11_PRIVATE = [4, 3, 2, 7, 6, 5, 4, 3, 2];
const MODULO_11_PUBLIC = [3, 2, 7, 6, 5, 4, 3, 2];
const FOREIGN_RESIDENT_PROVINCE = 30;

export function digitsOnly(value: string): string {
    return String(value || "").replace(/\D/g, "");
}

function validProvince(code: number): boolean {
    return (code >= 1 && code <= 24) || code === FOREIGN_RESIDENT_PROVINCE;
}

function modulo10(firstNine: string, check: number): boolean {
    let total = 0;
    for (let i = 0; i < 9; i += 1) {
        const product = Number(firstNine[i]) * MODULO_10[i];
        total += product >= 10 ? product - 9 : product;
    }
    const expected = (10 - (total % 10)) % 10;
    return expected === check;
}

function modulo11(initial: string, check: number, coefficients: number[]): boolean {
    let total = 0;
    for (let i = 0; i < coefficients.length; i += 1) {
        total += Number(initial[i]) * coefficients[i];
    }
    const remainder = total % 11;
    const expected = remainder === 0 ? 0 : 11 - remainder;
    return expected === check;
}

export function isValidEcCedula(value: string): boolean {
    const number = digitsOnly(value);
    if (number.length !== 10) return false;
    const province = Number(number.slice(0, 2));
    if (!validProvince(province)) return false;
    const third = Number(number[2]);
    if (province !== FOREIGN_RESIDENT_PROVINCE && third > 6) return false;
    return modulo10(number.slice(0, 9), Number(number[9]));
}

function hasExtendedPrivateSequential(number: string): boolean {
    if (number[3] === "0") return false;
    return Number(number.slice(3, 10)) >= 1_000_000;
}

function validNaturalRuc(number: string): boolean {
    if (Number(number[2]) > 6) return false;
    if (Number(number.slice(10, 13)) < 1) return false;
    return isValidEcCedula(number.slice(0, 10));
}

function validPrivateRuc(number: string): boolean {
    if (number[2] !== "9") return false;
    if (Number(number.slice(10, 13)) < 1) return false;
    if (!validProvince(Number(number.slice(0, 2)))) return false;
    if (hasExtendedPrivateSequential(number)) return true;
    return modulo11(number.slice(0, 9), Number(number[9]), MODULO_11_PRIVATE);
}

function validPublicRuc(number: string): boolean {
    if (number[2] !== "6") return false;
    if (Number(number.slice(9, 13)) < 1) return false;
    if (!validProvince(Number(number.slice(0, 2)))) return false;
    return modulo11(number.slice(0, 8), Number(number[8]), MODULO_11_PUBLIC);
}

export function isValidEcRuc(value: string): boolean {
    const number = digitsOnly(value);
    if (number.length !== 13) return false;
    if (!validProvince(Number(number.slice(0, 2)))) return false;
    const third = Number(number[2]);
    if (third <= 6 && validNaturalRuc(number)) return true;
    if (third === 6) return validPublicRuc(number);
    if (third === 9) return validPrivateRuc(number);
    return false;
}

function normDocumentType(documentType: string): string {
    return String(documentType || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
}

export function isCedulaDocumentType(documentType: string): boolean {
    const kind = normDocumentType(documentType);
    return kind === "cedula" || kind === "05";
}

export function resolveLawDocumentId(
    lawDocumentId: string,
    documentType: string,
    documentId: string,
): string {
    const explicit = String(lawDocumentId || "").trim();
    if (explicit) return explicit;
    if (isCedulaDocumentType(documentType)) return String(documentId || "").trim();
    return "";
}

export function buyerDocumentError(documentType: string, documentId: string): string | null {
    const kind = normDocumentType(documentType);
    const number = digitsOnly(documentId);
    if (kind === "cedula" || kind === "05") {
        if (number.length !== 10) {
            return "Cédula inválida. Debe tener exactamente 10 dígitos.";
        }
        if (!isValidEcCedula(documentId)) {
            return (
                "Cédula inválida. Los 10 dígitos no pasan el dígito verificador " +
                "del Registro Civil (no es una cédula ecuatoriana válida)."
            );
        }
        return null;
    }
    if (kind === "ruc" || kind === "04") {
        if (number.length !== 13) {
            return "RUC inválido. Debe tener exactamente 13 dígitos.";
        }
        if (!isValidEcRuc(documentId)) {
            return (
                "RUC inválido. Revisá el dígito verificador y el establecimiento. " +
                "Persona natural: cédula ecuatoriana válida + 001."
            );
        }
        return null;
    }
    return null;
}

export function lawDocumentError(
    category: string,
    lawDocumentId: string,
    documentType: string,
    documentId: string,
): string | null {
    const cat = String(category || "").trim().toLowerCase();
    if (cat !== "senior" && cat !== "disability") return null;
    const doc = resolveLawDocumentId(lawDocumentId, documentType, documentId);
    if (cat === "senior") {
        if (!doc) {
            return "Para el descuento de tercera edad indicá una cédula ecuatoriana en el documento de verificación.";
        }
        if (!isValidEcCedula(doc)) {
            return (
                "Para tercera edad el documento de verificación debe ser una cédula ecuatoriana válida. " +
                "Un pasaporte o ID del exterior no aplica."
            );
        }
        return null;
    }
    if (!doc) {
        return "Para el descuento por discapacidad indicá el número de carné CONADIS o cédula.";
    }
    if (isCedulaDocumentType(documentType) && digitsOnly(doc).length === 10 && !isValidEcCedula(doc)) {
        return "El documento de verificación no es una cédula ecuatoriana válida.";
    }
    return null;
}
