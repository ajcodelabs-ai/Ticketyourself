import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import api, { formatApiError, formatBlobApiError } from "@/lib/api";
import { PAYMENT_METHOD_META } from "@/lib/orders";
import {
    onboardingPayCta,
    planChargeLabel,
    resolveOnboardingPlan,
} from "@/lib/onboardingPlan";
import {
    billingSuccessPath,
    saveBillingCheckout,
} from "@/lib/billingCheckout";
import {
    Upload,
    CheckCircle2,
    FileText,
    Trash2,
    Loader2,
    Clock,
    XCircle,
    ShieldAlert,
    RotateCcw,
    Eye,
    Download,
} from "lucide-react";

const DOC_STATE = {
    missing: { icon: Clock, iconClass: "text-muted-foreground", badgeVariant: "outline", label: "Pendiente" },
    pending: { icon: Clock, iconClass: "text-muted-foreground", badgeVariant: "outline", label: "En revisión" },
    approved: { icon: CheckCircle2, iconClass: "text-emerald-600", badgeVariant: "default", label: "Aprobado" },
    rejected: { icon: XCircle, iconClass: "text-destructive", badgeVariant: "destructive", label: "Rechazado" },
    needs_correction: {
        icon: RotateCcw,
        iconClass: "text-amber-600",
        badgeVariant: "outline",
        label: "Requiere corrección",
    },
};

function isPreviewableMime(mime) {
    if (!mime) return false;
    return mime === "application/pdf" || mime.startsWith("image/");
}

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
    const [showAllPlans, setShowAllPlans] = useState(false);
    const [planPaymentMethod] = useState("nuvei");
    const [payingPlan, setPayingPlan] = useState(false);
    const [pendingIntent, setPendingIntent] = useState(null);
    const [preview, setPreview] = useState(null);

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
                if (data?.id) {
                    setPendingIntent(data);
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

    useEffect(() => {
        return () => {
            if (preview?.url) URL.revokeObjectURL(preview.url);
        };
    }, [preview?.url]);

    const requiredDocTypes = organizer ? requiredDocs[organizer.org_type] || [] : [];
    const requiredDocsSatisfied = useMemo(() => {
        if (!organizer) return false;
        // docs is sorted newest-first, so the first match per doc_type is
        // the current one — a rejected/needs_correction doc doesn't satisfy
        // the requirement unless a fresher upload superseded it.
        return requiredDocTypes.every((rt) => {
            const latest = docs.find((d) => d.doc_type === rt);
            return !!latest && latest.status !== "rejected" && latest.status !== "needs_correction";
        });
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

    const openPreview = async (doc) => {
        if (preview?.url) URL.revokeObjectURL(preview.url);
        setPreview({ doc, url: null, loading: true, error: null });
        try {
            const { data } = await api.get(`/organizers/me/documents/${doc.id}/download`, {
                responseType: "blob",
            });
            const blob = data instanceof Blob ? data : new Blob([data], { type: doc.mime_type });
            setPreview({ doc, url: URL.createObjectURL(blob), loading: false, error: null });
        } catch (err) {
            setPreview({
                doc,
                url: null,
                loading: false,
                error: await formatBlobApiError(err, "No se pudo cargar la vista previa"),
            });
        }
    };

    const closePreview = () => {
        if (preview?.url) URL.revokeObjectURL(preview.url);
        setPreview(null);
    };

    const downloadDoc = async (doc) => {
        try {
            const { data } = await api.get(`/organizers/me/documents/${doc.id}/download`, {
                responseType: "blob",
            });
            const blob = data instanceof Blob ? data : new Blob([data]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = doc.original_filename || "documento";
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(await formatBlobApiError(err, "No se pudo descargar"));
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
            const sessionId = data?.session_id;
            const nextIntentId = data?.intent_id;
            if (!sessionId && !nextIntentId) {
                toast.error("No se pudo iniciar el checkout");
                return;
            }
            if (sessionId) saveBillingCheckout(sessionId, data);
            navigate(billingSuccessPath({ sessionId, intentId: nextIntentId }));
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setPayingPlan(false);
        }
    };

    const { code: chosenPlanCode, plan: chosenPlan } = useMemo(
        () =>
            resolveOnboardingPlan({
                signupPlanCode: organizer?.signup_plan_code,
                localPlanCode: signupPlanCode,
                plans,
            }),
        [organizer?.signup_plan_code, signupPlanCode, plans],
    );
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
                            requiredDocTypes={requiredDocTypes}
                            docType={docType}
                            setDocType={setDocType}
                            uploading={uploading}
                            pendingFile={pendingFile}
                            onFileChange={onFileChange}
                            onConfirm={confirmUpload}
                            onCancel={cancelPendingFile}
                            docs={docs}
                            onDelete={deleteDoc}
                            onPreview={openPreview}
                            onDownload={downloadDoc}
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
                            avisamos por correo. Mientras tanto podés configurar escenarios, eventos y
                            tu página; la publicación queda bloqueada hasta la aprobación. Si
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
                            requiredDocTypes={requiredDocTypes}
                            docType={docType}
                            setDocType={setDocType}
                            uploading={uploading}
                            pendingFile={pendingFile}
                            onFileChange={onFileChange}
                            onConfirm={confirmUpload}
                            onCancel={cancelPendingFile}
                            docs={docs}
                            onDelete={deleteDoc}
                            onPreview={openPreview}
                            onDownload={downloadDoc}
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
                            requiredDocTypes={requiredDocTypes}
                            docType={docType}
                            setDocType={setDocType}
                            uploading={uploading}
                            pendingFile={pendingFile}
                            onFileChange={onFileChange}
                            onConfirm={confirmUpload}
                            onCancel={cancelPendingFile}
                            docs={docs}
                            onDelete={deleteDoc}
                            onPreview={openPreview}
                            onDownload={downloadDoc}
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
                            {pendingIntent ? (
                                <>Hay un pago de plan en proceso. Podés ver el estado o iniciar uno nuevo.</>
                            ) : chosenPlan ? (
                                <>
                                    Al registrarte elegiste el plan{" "}
                                    <strong>{chosenPlan.name}</strong>. Confirmá el pago
                                    para activarlo.
                                </>
                            ) : (
                                <>Elegí un plan y la forma de pago para activar tu cuenta.</>
                            )}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {pendingIntent && (
                            <div
                                className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2"
                                data-testid="onboarding-pending-payment"
                            >
                                <p className="text-sm font-medium text-amber-950">
                                    Tenés un pago de{" "}
                                    {pendingIntent.plan_name || pendingIntent.plan_code} en
                                    proceso.
                                </p>
                                <Button asChild size="sm" data-testid="onboarding-view-pending-payment">
                                    <Link
                                        to={billingSuccessPath({
                                            sessionId: pendingIntent.session_id,
                                            intentId: pendingIntent.id,
                                        })}
                                    >
                                        Ver estado del pago
                                    </Link>
                                </Button>
                            </div>
                        )}
                        {chosenPlan && !showAllPlans ? (
                            <div
                                className="space-y-4"
                                data-testid="onboarding-chosen-plan"
                            >
                                <div className="max-w-md">
                                    <PlanCard
                                        plan={chosenPlan}
                                        selected
                                        onSelect={() => !payingPlan && choosePlan(chosenPlan.code)}
                                        ctaLabel={onboardingPayCta(chosenPlan, payingPlan)}
                                    />
                                </div>
                                <p
                                    className="text-sm text-muted-foreground"
                                    data-testid="onboarding-pay-amount"
                                >
                                    Vas a pagar{" "}
                                    <strong className="text-foreground">
                                        {planChargeLabel(chosenPlan)}
                                    </strong>{" "}
                                    con {PAYMENT_METHOD_META[planPaymentMethod]?.label || "Nuvei"}{" "}
                                    (Paymentez Checkout).
                                </p>
                                <button
                                    type="button"
                                    className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                                    data-testid="onboarding-change-plan"
                                    onClick={() => setShowAllPlans(true)}
                                >
                                    ¿No es este plan? Elegir otro
                                </button>
                            </div>
                        ) : (
                            <>
                                <p className="text-sm text-muted-foreground" data-testid="plan-payment-methods">
                                    El cobro del plan se hace con Nuvei (Paymentez Checkout).
                                </p>

                                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 pt-2">
                                    {plans.map((p) => (
                                        <PlanCard
                                            key={p.id}
                                            plan={p}
                                            selected={p.code === chosenPlanCode}
                                            onSelect={() => !payingPlan && choosePlan(p.code)}
                                            ctaLabel={
                                                payingPlan
                                                    ? "Procesando…"
                                                    : p.code === chosenPlanCode
                                                      ? onboardingPayCta(p, false)
                                                      : `Pagar · ${PAYMENT_METHOD_META[planPaymentMethod]?.label || planPaymentMethod}`
                                            }
                                        />
                                    ))}
                                </div>
                                {chosenPlan && (
                                    <button
                                        type="button"
                                        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                                        onClick={() => setShowAllPlans(false)}
                                    >
                                        Volver al plan que elegiste
                                    </button>
                                )}
                            </>
                        )}

                        <DemoShortcut
                            planCode={chosenPlanCode}
                            onActivated={() => navigate("/app/dashboard")}
                        />
                    </CardContent>
                </Card>
            )}

            <Dialog open={!!preview} onOpenChange={(open) => !open && closePreview()}>
                <DialogContent
                    className="max-w-4xl w-[95vw] h-[85vh] flex flex-col"
                    data-testid="doc-preview-dialog"
                >
                    <DialogHeader>
                        <DialogTitle className="truncate pr-8">
                            {preview?.doc?.original_filename || "Documento"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 rounded-md border bg-muted/30 overflow-hidden">
                        {preview?.loading && (
                            <div className="h-full grid place-items-center text-sm text-muted-foreground gap-2">
                                <Loader2 className="h-6 w-6 animate-spin" />
                                Cargando vista previa…
                            </div>
                        )}
                        {preview?.error && (
                            <div className="h-full grid place-items-center text-sm text-destructive p-6 text-center">
                                {preview.error}
                            </div>
                        )}
                        {preview?.url && preview?.doc?.mime_type?.startsWith("image/") && (
                            <img
                                src={preview.url}
                                alt={preview.doc.original_filename || "Documento"}
                                className="max-h-full max-w-full mx-auto object-contain p-2"
                            />
                        )}
                        {preview?.url && preview?.doc?.mime_type === "application/pdf" && (
                            <iframe
                                title={preview.doc.original_filename || "PDF"}
                                src={preview.url}
                                className="w-full h-full border-0"
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function DocumentsUploader({
    docTypes,
    requiredDocTypes = [],
    docType,
    setDocType,
    uploading,
    pendingFile,
    onFileChange,
    onConfirm,
    onCancel,
    docs,
    onDelete,
    onPreview,
    onDownload,
}) {
    return (
        <div className="space-y-5">
            {requiredDocTypes.length > 0 && (
                <div className="space-y-1.5" data-testid="required-docs-checklist">
                    <Label className="text-xs text-muted-foreground">
                        Documentos requeridos
                    </Label>
                    <div className="space-y-1.5">
                        {requiredDocTypes.map((rt) => {
                            // docs is sorted newest-first, so the first match is the
                            // current one for this doc_type.
                            const latest = docs.find((d) => d.doc_type === rt);
                            const label = docTypes.find((t) => t.code === rt)?.label || rt;
                            const state = DOC_STATE[latest?.status] || DOC_STATE.missing;
                            const Icon = state.icon;
                            return (
                                <div key={rt} data-testid={`required-doc-${rt}`} className="space-y-1">
                                    <div className="flex items-center gap-2 text-sm">
                                        <Icon className={`h-4 w-4 shrink-0 ${state.iconClass}`} />
                                        <span className={latest ? "" : "text-muted-foreground"}>
                                            {label}
                                        </span>
                                        <Badge
                                            variant={state.badgeVariant}
                                            className="ml-auto text-[10px] font-normal"
                                        >
                                            {state.label}
                                        </Badge>
                                    </div>
                                    {latest?.review_comment &&
                                        (latest.status === "rejected" ||
                                            latest.status === "needs_correction") && (
                                            <p
                                                data-testid={`required-doc-${rt}-comment`}
                                                className="text-xs text-destructive pl-6"
                                            >
                                                {latest.review_comment}
                                            </p>
                                        )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
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
                {docs.map((d) => {
                    const canView = !d.is_demo && isPreviewableMime(d.mime_type);
                    const canDownload = !d.is_demo;
                    return (
                    <div
                        key={d.id}
                        data-testid={`doc-row-${d.id}`}
                        className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border/70 bg-card"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-md bg-secondary grid place-items-center text-primary shrink-0">
                                <FileText className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                {canView ? (
                                    <button
                                        type="button"
                                        className="text-sm font-medium truncate max-w-full text-left hover:underline"
                                        onClick={() => onPreview(d)}
                                    >
                                        {d.original_filename}
                                    </button>
                                ) : (
                                    <div className="text-sm font-medium truncate">
                                        {d.original_filename}
                                    </div>
                                )}
                                <div className="text-xs text-muted-foreground">
                                    {d.doc_type} · {(d.size_bytes / 1024).toFixed(1)} KB
                                    {d.is_demo ? " · ejemplo" : ""}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center shrink-0">
                            {canView && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Ver"
                                    data-testid={`preview-doc-${d.id}`}
                                    onClick={() => onPreview(d)}
                                >
                                    <Eye className="h-4 w-4" />
                                </Button>
                            )}
                            {canDownload && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Descargar"
                                    data-testid={`download-doc-${d.id}`}
                                    onClick={() => onDownload(d)}
                                >
                                    <Download className="h-4 w-4" />
                                </Button>
                            )}
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                title="Eliminar"
                                data-testid={`delete-doc-${d.id}`}
                                onClick={() => onDelete(d.id)}
                            >
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </div>
                    </div>
                    );
                })}
            </div>
        </div>
    );
}

function DemoShortcut({ onActivated, planCode }) {
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
            await api.post("/_dev/demo-activate", {
                plan_code: planCode || "profesional",
            });
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
                Activa tu cuenta como aprobada con plan Profesional, sin tocar Nuvei ni
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
