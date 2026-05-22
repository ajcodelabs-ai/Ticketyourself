import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import {
    Upload,
    CheckCircle2,
    FileText,
    Trash2,
    Loader2,
    CreditCard,
    Check,
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
    const [step, setStep] = useState(1);
    const [docs, setDocs] = useState([]);
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [docType, setDocType] = useState("ruc");
    const [uploading, setUploading] = useState(false);

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
            navigate("/dashboard", { replace: true });
        }
    }, [organizer, navigate]);

    const uploadDoc = async (e) => {
        e.preventDefault();
        const file = e.target.elements["file"].files[0];
        if (!file) {
            toast.error("Seleccioná un archivo");
            return;
        }
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("doc_type", docType);
            fd.append("file", file);
            await api.post("/organizers/me/documents", fd, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            toast.success("Documento subido");
            e.target.reset();
            await fetchAll();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
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

    const choosePlan = async (plan_code) => {
        try {
            const { data } = await api.post("/billing/checkout-session", {
                plan_code,
                origin_url: window.location.origin,
            });
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
                        <form onSubmit={uploadDoc} className="grid sm:grid-cols-[1fr_2fr_auto] gap-3 items-end">
                            <div className="space-y-1">
                                <Label htmlFor="doc-type">Tipo</Label>
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
                            <div className="space-y-1">
                                <Label htmlFor="file-input">Archivo</Label>
                                <Input
                                    id="file-input"
                                    name="file"
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    data-testid="doc-file-input"
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={uploading}
                                data-testid="upload-doc-btn"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            >
                                {uploading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Upload className="h-4 w-4" />
                                )}
                                <span className="ml-2">Subir</span>
                            </Button>
                        </form>

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
                            Vas a Stripe Checkout. Al volver actualizamos tu suscripción automáticamente.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid md:grid-cols-2 gap-4">
                            {plans.map((p) => (
                                <div
                                    key={p.id}
                                    data-testid={`onboarding-plan-${p.code}`}
                                    className="rounded-2xl border border-border/70 p-5 space-y-3 bg-card"
                                >
                                    <div className="flex items-baseline justify-between">
                                        <h3 className="font-semibold">{p.name}</h3>
                                        <span className="text-sm text-muted-foreground">
                                            ${(p.price_cents / 100).toFixed(0)}
                                            {p.billing_period === "monthly" ? "/mes" : " único"}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {p.description}
                                    </p>
                                    <ul className="space-y-1 text-sm">
                                        {p.features.slice(0, 3).map((f) => (
                                            <li key={f} className="flex gap-2">
                                                <Check className="h-3.5 w-3.5 text-primary mt-1 shrink-0" />
                                                {f}
                                            </li>
                                        ))}
                                    </ul>
                                    <Button
                                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                                        onClick={() => choosePlan(p.code)}
                                        data-testid={`onboarding-plan-cta-${p.code}`}
                                    >
                                        <CreditCard className="h-4 w-4 mr-2" />
                                        Pagar con Stripe
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
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
