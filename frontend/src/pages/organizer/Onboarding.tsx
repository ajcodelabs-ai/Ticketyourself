import { useCallback, useEffect, useState } from "react";
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
    ArrowRight,
} from "lucide-react";

const DOC_TYPES = [
    { value: "ruc", label: "RUC" },
    { value: "id_card", label: "Cédula" },
    { value: "operating_permit", label: "Permiso de funcionamiento" },
    { value: "other", label: "Otro" },
];

export default function Onboarding() {
    const { organizer, refreshOrganizer } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [step, setStep] = useState(1);
    const [docs, setDocs] = useState([]);
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [docType, setDocType] = useState("ruc");
    const [uploading, setUploading] = useState(false);
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
            const [docsResp, plansResp] = await Promise.all([
                api.get("/organizers/me/documents"),
                api.get("/plans"),
            ]);
            setDocs(docsResp.data || []);
            setPlans(plansResp.data || []);
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Redirect away when no longer pending or once they have a plan.
    useEffect(() => {
        if (!organizer) return;
        if (organizer.status !== "pending" || organizer.subscription_status !== "none") {
            navigate("/app/dashboard", { replace: true });
        }
    }, [organizer, navigate]);

    const uploadDoc = async (file) => {
        if (!file) return;
        // eslint-disable-next-line no-console
        console.log("[onboarding] upload start", {
            name: file.name,
            type: file.type,
            size: file.size,
            doc_type: docType,
        });
        // Client-side guards (mirror backend) so we fail fast with a clear toast.
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
            const resp = await api.post("/organizers/me/documents", fd, {
                timeout: 60000,
            });
            // eslint-disable-next-line no-console
            console.log("[onboarding] upload OK", resp.status, resp.data?.id);
            toast.success("Documento subido correctamente");
            await fetchAll();
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[onboarding] upload FAILED", {
                status: err?.response?.status,
                data: err?.response?.data,
                message: err?.message,
            });
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
        // eslint-disable-next-line no-console
        console.log("[onboarding] file selected via input", file?.name, file?.type);
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

    const hasRuc = docs.some((d) => d.doc_type === "ruc");
    const hasId = docs.some((d) => d.doc_type === "id_card");
    const docsReady = hasRuc || hasId;

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
                    Completá estos 2 pasos para activar tu cuenta.
                </p>
            </header>

            <Stepper step={step} onChange={setStep} docsReady={docsReady} />

            {loading && <p className="text-muted-foreground text-sm">Cargando…</p>}

            {step === 1 && !loading && (
                <Card className="border-border/70 tys-soft-shadow">
                    <CardHeader>
                        <CardTitle className="text-lg">Paso 1 — Documentos</CardTitle>
                        <CardDescription>
                            Subí RUC, cédula y cualquier permiso adicional. PDF/JPG/PNG, hasta 10MB.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid sm:grid-cols-[1fr_2fr] gap-3 items-end">
                            <div className="space-y-1">
                                <Label htmlFor="doc-type">Tipo de documento</Label>
                                <Select value={docType} onValueChange={setDocType}>
                                    <SelectTrigger id="doc-type" data-testid="doc-type-select">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {DOC_TYPES.map((t) => (
                                            <SelectItem
                                                key={t.value}
                                                value={t.value}
                                                data-testid={`doc-type-option-${t.value}`}
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
                                            <div className="text-sm font-medium">
                                                {d.original_filename}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {d.doc_type} ·{" "}
                                                {(d.size_bytes / 1024).toFixed(1)} KB
                                            </div>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        data-testid={`delete-doc-${d.id}`}
                                        onClick={() => deleteDoc(d.id)}
                                    >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-end">
                            <Button
                                onClick={() => setStep(2)}
                                disabled={!docsReady}
                                data-testid="onboarding-next-btn"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                Continuar a plan
                                <ArrowRight className="h-4 w-4 ml-2" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {step === 2 && !loading && (
                <Card className="border-border/70 tys-soft-shadow">
                    <CardHeader>
                        <CardTitle className="text-lg">Paso 2 — Elegir plan</CardTitle>
                        <CardDescription>
                            {signupPlanCode ? (
                                <>
                                    Al registrarte elegiste el plan{" "}
                                    <strong>{plans.find((p) => p.code === signupPlanCode)?.name || signupPlanCode}</strong>.
                                    Confirmá el pago con Stripe para activar tu cuenta.
                                </>
                            ) : (
                                <>Vas a Stripe Checkout. Al volver actualizamos tu suscripción automáticamente.</>
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

function Stepper({ step, onChange, docsReady }) {
    const items = [
        { id: 1, label: "Documentos" },
        { id: 2, label: "Plan" },
    ];
    return (
        <ol data-testid="onboarding-stepper" className="flex items-center gap-3">
            {items.map((it, idx) => {
                const completed = it.id === 1 ? docsReady : false;
                const isCurrent = it.id === step;
                return (
                    <li key={it.id} className="flex items-center gap-3">
                        <button
                            type="button"
                            data-testid={`step-${it.id}`}
                            onClick={() => onChange(it.id)}
                            className={`h-8 w-8 rounded-full grid place-items-center text-xs font-medium transition-colors ${
                                isCurrent
                                    ? "bg-primary text-primary-foreground"
                                    : completed
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-muted text-foreground/60"
                            }`}
                        >
                            {completed && !isCurrent ? <CheckCircle2 className="h-4 w-4" /> : it.id}
                        </button>
                        <span
                            className={`text-sm ${
                                isCurrent
                                    ? "font-medium text-foreground"
                                    : "text-muted-foreground"
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
