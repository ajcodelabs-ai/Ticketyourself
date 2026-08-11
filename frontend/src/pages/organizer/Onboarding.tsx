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
import { PAYMENT_METHOD_META, PLAN_PAYMENT_METHODS } from "@/lib/orders";
import NuveiCheckoutPanel from "@/components/orders/NuveiCheckoutPanel";
import type { NuveiCheckoutConfig } from "@/lib/nuvei";
import DeunaCheckoutPanel from "@/components/orders/DeunaCheckoutPanel";
import type { DeunaCheckoutConfig } from "@/lib/deuna";
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
    const [requiredDocs, setRequiredDocs] = useState({
        individual: [],
        company: [],
        country_code: null,
    });
    const [loading, setLoading] = useState(true);
    const [docType, setDocType] = useState("");
    const [uploading, setUploading] = useState(false);
    const [pendingFile, setPendingFile] = useState(null);
    const [resubmitting, setResubmitting] = useState(false);
    const [signupPlanCode, setSignupPlanCode] = useState(null);
    const [planPaymentMethod, setPlanPaymentMethod] = useState("stripe");
    const [payingPlan, setPayingPlan] = useState(false);
    const [gatewayPending, setGatewayPending] = useState(null);
    const [nuveiCheckout, setNuveiCheckout] = useState<NuveiCheckoutConfig | null>(null);
    const [deunaCheckout, setDeunaCheckout] = useState<DeunaCheckoutConfig | null>(null);

    useEffect(() => {
        const saved = localStorage.getItem(SIGNUP_PLAN_KEY);
        if (saved) setSignupPlanCode(saved);
    }, []);

    useEffect(() => {
        if (organizer?.status !== "approved" || organizer?.subscription_status !== "none") {
            return;
        }
        (async () => {
            try {
                const { data } = await api.get("/billing/me/pending-intent");
                if (data?.status === "pending_gateway") {
                    setGatewayPending(data);
                }
            } catch {
                /* ignore */
            }
        })();
    }, [organizer?.status, organizer?.subscription_status]);

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
                country_code: requiredResp.data?.country_code || organizer?.country_code,
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

    const validateFile = (file) => {
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
            return false;
        }
        if (file.size > 10 * 1024 * 1024) {
            toast.error("El archivo supera los 10MB.");
            return false;
        }
        return true;
    };

    // Selecting a file only stages it — the actual upload happens when the
    // organizer confirms with the "Enviar" button, so nothing goes to
    // review by accident.
    const onFileChange = (e) => {
        const file = e.target.files?.[0];
        // Reset input so selecting the same file twice still triggers onChange.
        e.target.value = "";
        if (!file || !validateFile(file)) return;
        setPendingFile(file);
    };

    const cancelPendingFile = () => setPendingFile(null);

    const confirmUpload = async () => {
        if (!pendingFile) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("doc_type", docType);
            fd.append("file", pendingFile);
            // Do NOT set Content-Type manually — axios auto-generates it with the
            // multipart boundary. The interceptor strips any stale Content-Type.
            await api.post("/organizers/me/documents", fd, { timeout: 60000 });
            toast.success("Documento enviado a revisión");
            setPendingFile(null);
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
        setPayingPlan(true);
        try {
            const { data } = await api.post("/billing/checkout-session", {
                plan_code,
                origin_url: window.location.origin,
                payment_method: planPaymentMethod,
            });
            localStorage.removeItem(SIGNUP_PLAN_KEY);
            if (data?.status === "pending_gateway") {
                setGatewayPending({
                    ...data,
                    plan_code: data.plan_code || plan_code,
                    payment_method: data.payment_method || planPaymentMethod,
                });
                toast.success(data.message || "Solicitud de pago registrada");
                return;
            }
            if (data?.status === "nuvei_checkout" && data.session_token) {
                setNuveiCheckout({
                    session_token: data.session_token,
                    merchant_id: data.merchant_id,
                    merchant_site_id: data.merchant_site_id,
                    nuvei_env: data.nuvei_env,
                    checkout_js_url: data.checkout_js_url,
                    client_unique_id: data.client_unique_id || data.session_id,
                });
                return;
            }
            if (data?.status === "deuna_checkout" && data.order_token) {
                setDeunaCheckout({
                    order_token: data.order_token,
                    public_api_key: data.public_api_key,
                    deuna_env: data.deuna_env,
                    checkout_js_url: data.checkout_js_url,
                    order_id: data.client_unique_id || data.session_id,
                });
                return;
            }
            if (data?.checkout_url) {
                window.location.href = data.checkout_url;
            } else {
                toast.error("No se pudo iniciar el checkout");
            }
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setPayingPlan(false);
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
                            pendingFile={pendingFile}
                            onFileChange={onFileChange}
                            onConfirm={confirmUpload}
                            onCancel={cancelPendingFile}
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
                            <Clock className="h-5 w-5" /> Documentos recibidos — podés seguir
                        </CardTitle>
                        <CardDescription>
                            El equipo TYS revisará tu cuenta (normalmente en 48 h laborables) y te
                            avisamos por correo. Mientras tanto podés configurar venues, eventos y
                            el microsite; la publicación queda bloqueada hasta la aprobación. Si
                            tenés dudas, escribinos a{" "}
                            <a
                                href="mailto:soporte@ticketyourself.com"
                                className="text-primary underline underline-offset-2"
                            >
                                soporte@ticketyourself.com
                            </a>
                            .
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                onClick={() => navigate("/app/dashboard")}
                                data-testid="onboarding-continue-dashboard"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                Ir al panel y empezar a configurar
                            </Button>
                        </div>
                        <DocumentsUploader
                            docTypes={docTypes}
                            docType={docType}
                            setDocType={setDocType}
                            uploading={uploading}
                            pendingFile={pendingFile}
                            onFileChange={onFileChange}
                            onConfirm={confirmUpload}
                            onCancel={cancelPendingFile}
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
                            pendingFile={pendingFile}
                            onFileChange={onFileChange}
                            onConfirm={confirmUpload}
                            onCancel={cancelPendingFile}
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
                            {gatewayPending ? (
                                <>Tu pago está pendiente de confirmación. Cuando TYS lo valide, tu plan se activa solo.</>
                            ) : signupPlanCode ? (
                                <>
                                    Al registrarte elegiste el plan{" "}
                                    <strong>{plans.find((p) => p.code === signupPlanCode)?.name || signupPlanCode}</strong>.
                                    Elegí cómo pagar para activar tu cuenta.
                                </>
                            ) : (
                                <>Elegí un plan y la forma de pago para activar tu cuenta.</>
                            )}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {nuveiCheckout ? (
                            <div data-testid="onboarding-nuvei-checkout">
                                <NuveiCheckoutPanel
                                    config={nuveiCheckout}
                                    onPaid={async () => {
                                        setNuveiCheckout(null);
                                        toast.success("Pago confirmado. Activando tu plan…");
                                        await refreshOrganizer();
                                        navigate("/app");
                                    }}
                                    onCancel={() => setNuveiCheckout(null)}
                                />
                            </div>
                        ) : deunaCheckout ? (
                            <div data-testid="onboarding-deuna-checkout">
                                <DeunaCheckoutPanel
                                    config={deunaCheckout}
                                    onPaid={async () => {
                                        setDeunaCheckout(null);
                                        toast.success("Pago confirmado. Activando tu plan…");
                                        await refreshOrganizer();
                                        navigate("/app");
                                    }}
                                    onCancel={() => setDeunaCheckout(null)}
                                />
                            </div>
                        ) : gatewayPending ? (
                            <div
                                className="rounded-lg border border-sky-200 bg-sky-50/60 p-4 space-y-2"
                                data-testid="onboarding-gateway-pending"
                            >
                                <p className="text-sm font-medium text-sky-900">
                                    Pago con{" "}
                                    {PAYMENT_METHOD_META[gatewayPending.payment_method]?.label ||
                                        gatewayPending.payment_method}{" "}
                                    en revisión
                                </p>
                                <p className="text-sm text-sky-900/80">
                                    Plan:{" "}
                                    <strong>
                                        {plans.find((p) => p.code === gatewayPending.plan_code)?.name ||
                                            gatewayPending.plan_code}
                                    </strong>
                                    . El equipo TYS confirmará el cobro y activará tu suscripción.
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setGatewayPending(null)}
                                >
                                    Elegir otro método / plan
                                </Button>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2" data-testid="plan-payment-methods">
                                    <Label>Forma de pago</Label>
                                    <div className="grid sm:grid-cols-3 gap-3">
                                        {PLAN_PAYMENT_METHODS.map((code) => {
                                            const meta = PAYMENT_METHOD_META[code];
                                            const selected = planPaymentMethod === code;
                                            return (
                                                <button
                                                    key={code}
                                                    type="button"
                                                    data-testid={`plan-pay-${code}`}
                                                    onClick={() => setPlanPaymentMethod(code)}
                                                    className={`text-left rounded-lg border p-3 transition ${
                                                        selected
                                                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                            : "border-border/70 hover:border-primary/40"
                                                    }`}
                                                >
                                                    <div className="text-sm font-medium">
                                                        {meta.icon} {meta.label}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground mt-1">
                                                        {meta.description}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 pt-2">
                                    {plans.map((p) => (
                                        <PlanCard
                                            key={p.id}
                                            plan={p}
                                            selected={p.code === signupPlanCode}
                                            onSelect={() => !payingPlan && choosePlan(p.code)}
                                            ctaLabel={
                                                payingPlan
                                                    ? "Procesando…"
                                                    : p.code === signupPlanCode
                                                      ? `Pagar con ${PAYMENT_METHOD_META[planPaymentMethod]?.label || planPaymentMethod}`
                                                      : `Pagar · ${PAYMENT_METHOD_META[planPaymentMethod]?.label || planPaymentMethod}`
                                            }
                                        />
                                    ))}
                                </div>
                            </>
                        )}

                        <DemoShortcut onActivated={() => navigate("/app/dashboard")} />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function DocumentsUploader({
    docTypes,
    docType,
    setDocType,
    uploading,
    pendingFile,
    onFileChange,
    onConfirm,
    onCancel,
    docs,
    onDelete,
}) {
    return (
        <div className="space-y-5">
            <div className="grid sm:grid-cols-[1fr_2fr] gap-3 items-end">
                <div className="space-y-1">
                    <Label htmlFor="doc-type">Tipo de documento</Label>
                    <Select value={docType} onValueChange={setDocType} disabled={!!pendingFile}>
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
                {pendingFile ? (
                    <div
                        data-testid="doc-pending-file"
                        className="flex items-center justify-between gap-3 rounded-xl border-2 border-primary/50 bg-primary/5 px-4 py-4"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <FileText className="h-5 w-5 text-primary shrink-0" />
                            <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{pendingFile.name}</div>
                                <div className="text-xs text-muted-foreground">
                                    {(pendingFile.size / 1024).toFixed(1)} KB
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={onCancel}
                                disabled={uploading}
                                data-testid="doc-cancel-btn"
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={onConfirm}
                                disabled={uploading}
                                data-testid="doc-submit-btn"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                {uploading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                                Enviar
                            </Button>
                        </div>
                    </div>
                ) : (
                    <label
                        htmlFor="file-input"
                        data-testid="doc-dropzone"
                        className="flex items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 cursor-pointer transition-colors text-center border-border/70 hover:border-primary hover:bg-primary/5"
                    >
                        <Upload className="h-5 w-5 text-primary" />
                        <span className="text-sm">
                            <strong className="text-primary">
                                Haz clic para elegir un archivo
                            </strong>{" "}
                            <span className="text-muted-foreground">
                                — PDF, JPG, PNG, WEBP o HEIC (máx 10MB)
                            </span>
                        </span>
                        <input
                            id="file-input"
                            name="file"
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
                            onChange={onFileChange}
                            data-testid="doc-file-input"
                            className="sr-only"
                        />
                    </label>
                )}
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
    const { refreshOrganizer } = useAuth();
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
            // Must await, and must throw on failure: RequireActiveOrganizer
            // (routes/layouts.tsx) reads organizer.subscription_status
            // straight from AuthContext on the very next render. If this
            // silently swallowed a transient failure (its default behavior),
            // we'd show a success toast and navigate anyway while the guard
            // still sees the stale "none" and bounces back here — the exact
            // "shows success but never advances" bug this shortcut exists to
            // avoid, just triggered by a flaky refresh instead of a missing
            // backend commit.
            await refreshOrganizer({ throwOnError: true });
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
        { id: "review", label: "Revisión (en paralelo)" },
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
