export const EINVOICE_STATUS = {
    PENDING: { label: "Pendiente", className: "bg-amber-100 text-amber-800" },
    ENVIADO: { label: "Enviada al SRI", className: "bg-sky-100 text-sky-800" },
    RECIBIDO: { label: "Recibida por el SRI", className: "bg-sky-100 text-sky-800" },
    AUTORIZADO: { label: "Autorizada", className: "bg-emerald-100 text-emerald-800" },
    "NO AUTORIZADO": { label: "No autorizada", className: "bg-red-100 text-red-800" },
    DEVUELTO: { label: "Devuelta", className: "bg-red-100 text-red-800" },
    ERROR: { label: "Error", className: "bg-red-100 text-red-800" },
};

export const DOCUMENT_TYPES = [
    { value: "cedula", label: "Cédula" },
    { value: "ruc", label: "RUC" },
    { value: "pasaporte", label: "Pasaporte" },
    { value: "exterior", label: "Identificación del exterior" },
    { value: "consumidor_final", label: "Consumidor final" },
];

export function documentTypeFieldLabel(type: string): string {
    if (type === "consumidor_final") return "Documento";
    return DOCUMENT_TYPES.find((t) => t.value === type)?.label || "Cédula";
}

/** SRI IVA included in the ticket price. Default Ecuador 2024+ is 15%. */
export const IVA_PERCENT_OPTIONS = [
    { value: 15, label: "15% — gravado (vigente Ecuador)" },
    { value: 5, label: "5%" },
    { value: 0, label: "0% — tarifa 0 / exento" },
];

export function invoiceStatusMeta(estado) {
    return EINVOICE_STATUS[estado] || { label: estado || "—", className: "bg-slate-100 text-slate-700" };
}

export function formatEinvoiceError(raw) {
    if (!raw) return "";
    const text = String(raw);
    try {
        const parsed = JSON.parse(text);
        const first = parsed?.errors?.[0];
        const details = first?.details || first?.message;
        if (details) return formatEinvoiceError(details);
    } catch {
        /* not JSON */
    }
    if (/punto de emisi[oó]n no existe/i.test(text)) {
        return (
            "Dátil no tiene creado ese punto de emisión en la sesión de pruebas. " +
            "En app.datil.co activá Datos de prueba, andá a Mi negocio → Establecimientos " +
            "y creá el establecimiento 001 con punto de emisión 001."
        );
    }
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}
