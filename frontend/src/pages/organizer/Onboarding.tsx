import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { PlanCard } from "@/components/PlansShowcase";
import { SIGNUP_PLAN_KEY } from "@/pages/marketing/Register";
import api, { formatApiError } from "@/lib/api";
import {
    Upload,
    CheckCircle2,
    FileText,
    Trash2,
    Loader2,
    Clock,
    XCircle,
    ShieldAlert,
} from "lucide-react";

export default function Onboarding() {
    const { organizer, refreshOrganizer } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [docs, setDocs] = useState([]);
    const [plans, setPlans] = useState([]);
    // Admin-extensible catalog (/admin/configuracion) — [{ code, label }]
    const [docTypes, setDocTypes] = useState([]);
    // Admin-configurable via /admin/configuracion — { individual: [...], company: [...] }
    const [requiredDocs, setRequiredDocs] = useState({ individual: [], company: [] });
    const [loading, setLoading] = useState(true);
    const [docType, setDocType] = useState("");
    const [uploading, setUploading] = useState(false);
    const [resubmitting, setResubmitting] = useState(false);
    const [signupPlanCode, setSignupPlanCode] = useState(null);

    useEffect(() => {
        const saved = localStorage.getItem(SIGNUP_PLAN_KEY);
        if (saved) setSignupPlanCode(saved);
    }, []);

    // Fire `link_clicked` event when an activation token is present in the URL.
    useEffect(() => {
        const at = searchParams.get("at");
        if (!at) return;
        api.post("/activation/log-event", { token: at, event_name: "link_clicked" }).catch(
            () => {
                /* token may be expired — ignore */
            },
        );
    }, [searchParams]);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [docsResp, plansResp, requiredResp, typesResp] = await Promise.all([
                api.get("/organizers/me/documents"),
                api.get("/plans"),
                api.get("/organizers/required-documents"),
                api.get("/organizers/document-types"),
            ]);
            setDocs(docsResp.data || []);
            setPlans(plansResp.data || []);
            setRequiredDocs({
                individual: requiredResp.data?.individual || [],
                company: requiredResp.data?.company || [],
            });
            const types = typesResp.data || [];
            setDocTypes(types);
            setDocType((current) => current || types[0]?.code || "");
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const requiredDocTypes = organizer ? requiredDocs[organizer.org_type] || [] : [];
    const requiredDocsSatisfied = useMemo(() => {
        if (!organizer) return false;
        return requiredDocTypes.every((rt) => docs.some((d) => d.doc_type === rt));
    }, [docs, organizer, requiredDocTypes]);

    // Onboarding is fully done only once approved AND paid — everything else
    // (pending/rejected/suspended/approved-without-payment) is handled below.
    useEffect(() => {
        if (!organizer) return;
        if (organizer.status === "approved" && organizer.subscription_status !== "none") {
            navigate("/app/dashboard", { replace: true });
        }
    }, [organizer, navigate]);

    const uploadDoc = async (file) => {
        if (!file) return;
        const okTypes = [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
        ];
        if (file.type && !okTypes.includes(file.type)) {
            toast.error(
                `Formato no soportado: ${file.type}. Aceptados: PDF, JPEG, PNG, WEBP, HEIC.`,
            );
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            toast.error("El archivo supera los 10MB.");
            return;
        }
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("doc_type", docType);
            fd.append("file", file);
            // Do NOT set Content-Type manually — axios auto-generates it with the
            // multipart boundary. The interceptor strips any stale Content-Type.
            await api.post("/organizers/me/documents", fd, { timeout: 60000 });
            toast.success("Documento subido correctamente");
            await fetchAll();
        } catch (err) {
            const status = err?.response?.status;
            const detail =
                formatApiError(err?.response?.data?.detail) ||
                err?.message ||
                "Error desconocido al subir el archivo";
            toast.error(status ? `Error ${status}: ${detail}` : detail);
        } finally {
            setUploading(false);
        }
    };

    const onFileChange = (e) => {
        const file = e.target.files?.[0];
        // Reset input so selecting the same file twice still triggers onChange.
        e.target.value = "";
        uploadDoc(file);
    };

    const deleteDoc = async (id) => {
        try {
            await api.delete(`/organizers/me/documents/${id}`);
            toast.success("Documento eliminado");
            await fetchAll();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        }
    };

    const resubmit = async () => {
        setResubmitting(true);
        try {
            await api.post("/organizers/me/resubmit");
            toast.success("Reenviado a revisión");
            await refreshOrganizer();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setResubmitting(false);
        }
    };

    const choosePlan = async (plan_code) => {
        try {
            const { data } = await api.post("/billing/checkout-session", {
                plan_code,
                origin_url: window.location.origin,
            });
            localStorage.removeItem(SIGNUP_PLAN_KEY);
            if (data?.checkout_url) {
                window.location.href = data.checkout_url;
            } else {
                toast.error("Stripe no devolvió la URL de checkout");
            }
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        }
    };

    const status = organizer?.status;
    const phase =
        status === "rejected"
            ? "rejected"
            : status === "suspended"
              ? "suspended"
              : status === "approved"
                ? "plan"
                : requiredDocsSatisfied
                  ? "review"
                  : "docs";

    return (
        <div data-testid="onboarding-page" className="space-y-8 max-w-4xl">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Onboarding
                </Badge>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                    ¡Bienvenido!
                </h1>
                <p className="text-sm text-muted-foreground">
                    Seguí estos pasos para activar tu cuenta.
                </p>
            </header>

            <ProgressStrip phase={phase} />

            {loading && <p className="text-muted-foreground text-sm">Cargando…</p>}

            {!loading && phase === "docs" && (
                <Card className="border-border/70 tys-soft-shadow" data-testid="onboarding-docs-panel">
                    <CardHeader>
                        <CardTitle className="text-lg">Documentos</CardTitle>
                        <CardDescription>
                            {requiredDocTypes.length > 0 ? (
                                <>
                                    Subí{" "}
                                    {requiredDocTypes
                                        .map((rt) => docTypes.find((t) => t.code === rt)?.label || rt)
                                        .join(" y ")}{" "}
                                    (obligatorio). Podés agregar otros documentos de respaldo.
                                </>
                            ) : (
                                "Subí los documentos que respalden tu cuenta."
                            )}{" "}
                            PDF/JPG/PNG, hasta 10MB.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DocumentsUploader
                            docTypes={docTypes}
                            docType={docType}
                            setDocType={setDocType}
                            uploading={uploading}
                            onFileChange={onFileChange}
                            docs={docs}
                            onDelete={deleteDoc}
                        />
                    </CardContent>
                </Card>
            )}

            {!loading && phase === "review" && (
                <Card className="border-amber-300 bg-amber-50/40 tys-soft-shadow" data-testid="onboarding-review-panel">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2 text-amber-900">
                            <Clock className="h-5 w-5" /> En revisión por el equipo TYS
                        </CardTitle>
                        <CardDescription>
                            Recibimos tus documentos. Te avisamos por correo en cuanto aprobemos tu
                            cuenta para que puedas pagar el plan elegido.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DocumentsUploader
                            docTypes={docTypes}
                            docType={docType}
                            setDocType={setDocType}
                            uploading={uploading}
                            onFileChange={onFileChange}
                            docs={docs}
                            onDelete={deleteDoc}
                        />
                    </CardContent>
                </Card>
            )}

            {!loading && phase === "rejected" && (
                <Card className="border-red-300 bg-red-50/40 tys-soft-shadow" data-testid="onboarding-rejected-panel">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2 text-red-900">
                            <XCircle className="h-5 w-5" /> Tu solicitud fue rechazada
                        </CardTitle>
                        <CardDescription className="text-red-900/80">
                            {organizer?.rejection_reason || "El equipo TYS rechazó tu solicitud."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <p className="text-sm text-muted-foreground">
                            Corregí o reemplazá los documentos señalados y reenviá tu solicitud.
                        </p>
                        <DocumentsUploader
                            docTypes={docTypes}
                            docType={docType}
                            setDocType={setDocType}
                            uploading={uploading}
                            onFileChange={onFileChange}
                            docs={docs}
                            onDelete={deleteDoc}
                        />
                        <div className="flex justify-end">
                            <Button
                                onClick={resubmit}
                                disabled={!requiredDocsSatisfied || resubmitting}
                                data-testid="onboarding-resubmit-btn"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                {resubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Reenviar a revisión
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {!loading && phase === "suspended" && (
                <Card className="border-red-300 bg-red-50/40 tys-soft-shadow" data-testid="onboarding-suspended-panel">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2 text-red-900">
                            <ShieldAlert className="h-5 w-5" /> Tu cuenta está suspendida
                        </CardTitle>
                        <CardDescription className="text-red-900/80">
                            Contactá a soporte para reactivarla.
                        </CardDescription>
                    </CardHeader>
                </Card>
            )}

            {!loading && phase === "plan" && (
                <Card className="border-border/70 tys-soft-shadow" data-testid="onboarding-plan-panel">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2 text-emerald-700">
                            <CheckCircle2 className="h-5 w-5" /> ¡Tu cuenta fue aprobada!
                        </CardTitle>
                        <CardDescription>
                            {signupPlanCode ? (
                                <>
                                    Al registrarte elegiste el plan{" "}
                                    <strong>{plans.find((p) => p.code === signupPlanCode)?.name || signupPlanCode}</strong>.
                                    Confirmá el pago con Stripe para activar tu cuenta.
                                </>
                            ) : (
                                <>Elegí un plan para activar tu cuenta. Vas a Stripe Checkout y al volver actualizamos tu suscripción automáticamente.</>
                            )}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 pt-2">
                            {plans.map((p) => (
                                <PlanCard
                                    key={p.id}
                                    plan={p}
                                    selected={p.code === signupPlanCode}
                                    onSelect={() => choosePlan(p.code)}
                                    ctaLabel={
                                        p.code === signupPlanCode
                                            ? "Pagar plan elegido"
                                            : "Pagar con Stripe"
                                    }
                                />
                            ))}
                        </div>

                        <DemoShortcut onActivated={() => navigate("/app/dashboard")} />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function DocumentsUploader({ docTypes, docType, setDocType, uploading, onFileChange, docs, onDelete }) {
    return (
        <div className="space-y-5">
            <div className="grid sm:grid-cols-[1fr_2fr] gap-3 items-end">
                <div className="space-y-1">
                    <Label htmlFor="doc-type">Tipo de documento</Label>
                    <Select value={docType} onValueChange={setDocType}>
                        <SelectTrigger id="doc-type" data-testid="doc-type-select">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {docTypes.map((t) => (
                                <SelectItem
                                    key={t.code}
                                    value={t.code}
                                    data-testid={`doc-type-option-${t.code}`}
                                >
                                    {t.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <label
                    htmlFor="file-input"
                    data-testid="doc-dropzone"
                    aria-disabled={uploading}
                    className={`flex items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 cursor-pointer transition-colors text-center ${
                        uploading
                            ? "border-primary bg-primary/5 cursor-wait"
                            : "border-border/70 hover:border-primary hover:bg-primary/5"
                    }`}
                >
                    {uploading ? (
                        <>
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <span className="text-sm font-medium text-primary">
                                Subiendo documento…
                            </span>
                        </>
                    ) : (
                        <>
                            <Upload className="h-5 w-5 text-primary" />
                            <span className="text-sm">
                                <strong className="text-primary">
                                    Hacé click para subir
                                </strong>{" "}
                                <span className="text-muted-foreground">
                                    — PDF, JPG, PNG, WEBP o HEIC (máx 10MB)
                                </span>
                            </span>
                        </>
                    )}
                    <input
                        id="file-input"
                        name="file"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
                        onChange={onFileChange}
                        disabled={uploading}
                        data-testid="doc-file-input"
                        className="sr-only"
                    />
                </label>
            </div>

            <div data-testid="docs-list" className="space-y-2">
                {docs.length === 0 && (
                    <p className="text-sm text-muted-foreground" data-testid="docs-empty">
                        Todavía no subiste documentos.
                    </p>
                )}
                {docs.map((d) => (
                    <div
                        key={d.id}
                        data-testid={`doc-row-${d.id}`}
                        className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card"
                    >
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-md bg-secondary grid place-items-center text-primary">
                                <FileText className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="text-sm font-medium">{d.original_filename}</div>
                                <div className="text-xs text-muted-foreground">
                                    {d.doc_type} · {(d.size_bytes / 1024).toFixed(1)} KB
                                </div>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`delete-doc-${d.id}`}
                            onClick={() => onDelete(d.id)}
                        >
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function DemoShortcut({ onActivated }) {
    const { refreshOrganizer, checkSession } = useAuth();
    const [enabled, setEnabled] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        api.get("/_dev/enabled")
            .then((r) => alive && setEnabled(!!r.data?.enabled))
            .catch(() => alive && setEnabled(false));
        return () => {
            alive = false;
        };
    }, []);

    if (!enabled) return null;

    const activate = async () => {
        setBusy(true);
        try {
            await api.post("/_dev/demo-activate", { plan_code: "profesional" });
            // Refresh AuthContext so the dashboard sees status=approved.
            await checkSession();
            await refreshOrganizer();
            toast.success(
                "Cuenta activada en modo demo · plan Profesional · sin pago real",
            );
            onActivated?.();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="mt-6 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50/60 p-4 space-y-2"
            data-testid="demo-shortcut-block"
        >
            <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                <span className="text-base">⚠️</span> Modo demo (preview)
            </p>
            <p className="text-sm text-amber-900/80">
                ¿Querés saltarte el pago y la aprobación para explorar el dashboard?
                Activa tu cuenta como aprobada con plan Profesional, sin tocar Stripe ni
                esperar a admin. Solo en este entorno de preview.
            </p>
            <Button
                onClick={activate}
                disabled={busy}
                variant="outline"
                className="bg-amber-100/80 border-amber-300 text-amber-900 hover:bg-amber-200/60"
                data-testid="demo-shortcut-btn"
            >
                {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : "⚡"}{" "}
                Simular pago + aprobación (solo demo)
            </Button>
        </div>
    );
}

function ProgressStrip({ phase }) {
    const items = [
        { id: "docs", label: "Documentos" },
        { id: "review", label: "Revisión" },
        { id: "plan", label: "Pago" },
    ];
    const order = ["docs", "review", "plan"];
    // rejected/suspended both visually sit at the "review" stage since that's
    // where the admin decision happened.
    const activeId = phase === "rejected" || phase === "suspended" ? "review" : phase;
    const activeIdx = order.indexOf(activeId);

    return (
        <ol data-testid="onboarding-progress" className="flex items-center gap-3">
            {items.map((it, idx) => {
                const isCurrent = it.id === activeId;
                const isDone = idx < activeIdx;
                return (
                    <li key={it.id} className="flex items-center gap-3">
                        <span
                            data-testid={`progress-${it.id}`}
                            className={`h-8 w-8 rounded-full grid place-items-center text-xs font-medium transition-colors ${
                                isCurrent
                                    ? "bg-primary text-primary-foreground"
                                    : isDone
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-muted text-foreground/60"
                            }`}
                        >
                            {isDone ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                        </span>
                        <span
                            className={`text-sm ${
                                isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                            }`}
                        >
                            {it.label}
                        </span>
                        {idx < items.length - 1 && (
                            <span className="text-muted-foreground/60 mx-2">·</span>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
