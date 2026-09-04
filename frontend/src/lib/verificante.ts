export const VERIFICANTE_RISK = {
    low: { label: "Riesgo bajo", className: "bg-emerald-100 text-emerald-800" },
    medium: { label: "Riesgo medio", className: "bg-amber-100 text-amber-800" },
    high: { label: "Riesgo alto", className: "bg-red-100 text-red-800" },
};

export const VERIFICANTE_STATUS = {
    pending: { label: "Pendiente", className: "bg-amber-100 text-amber-800" },
    completed: { label: "Completado", className: "bg-slate-100 text-slate-700" },
    failed: { label: "Error", className: "bg-red-100 text-red-800" },
    skipped: { label: "No consultado", className: "bg-slate-100 text-slate-600" },
};

export function verificanteRiskMeta(level) {
    const key = String(level || "").trim().toLowerCase();
    return (
        VERIFICANTE_RISK[key] || {
            label: key ? `Riesgo ${key}` : "Sin calificación",
            className: "bg-slate-100 text-slate-700",
        }
    );
}

export function isVerificanteLow(check) {
    return String(check?.risk_level || "").trim().toLowerCase() === "low";
}

export function needsApproveConfirm(check) {
    if (!check || check.applicable === false) return false;
    const status = String(check.status || "").trim().toLowerCase();
    const risk = String(check.risk_level || "").trim();
    if (!status && !risk) return false;
    if (status === "skipped") return false;
    if (status === "completed" && isVerificanteLow(check)) return false;
    return true;
}

export function approveConfirmMessage(check) {
    const status = String(check?.status || "").trim().toLowerCase();
    if (status === "pending") {
        return "La verificación de Verificante sigue pendiente. ¿Aprobar la cuenta de todos modos?";
    }
    if (status === "failed") {
        return "Verificante no pudo completar la consulta. ¿Aprobar la cuenta de todos modos?";
    }
    const meta = verificanteRiskMeta(check?.risk_level);
    return (
        `Verificante marcó ${meta.label.toLowerCase()}. ` +
        "La última palabra es tuya: ¿aprobar la cuenta igual?"
    );
}
