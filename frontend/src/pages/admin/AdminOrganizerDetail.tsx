import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import api, { formatApiError, formatBlobApiError } from "@/lib/api";
import { legalIdFieldLabel } from "@/lib/registerValidation";
import {
    ORG_STATUS_STYLE,
    SUBSCRIPTION_STATUS_LABEL,
    accountActionLabel,
    contractStatusLabel,
    fileSizeLabel,
    mimeShortLabel,
    orgStatusLabel,
    orgTypeLabel,
    planDisplayName,
    plainTextFromHtml,
    referenceRows,
    socialLinkRows,
    subscriptionStatusLabel,
    uafeRows,
    verificationFeeLabel,
    yesNo,
} from "@/lib/organizerAdminLabels";
import {
    documentReviewEnabled,
    groupDocumentsByType,
    previousVersionLabel,
} from "@/lib/organizerDocuments";
import {
    approveConfirmMessage,
    needsApproveConfirm,
    verificanteRiskMeta,
    VERIFICANTE_STATUS,
} from "@/lib/verificante";
import { cn } from "@/lib/utils";
import {
    ArrowLeft,
    CheckCircle2,
    ExternalLink,
    XCircle,
    Pause,
    MessageCircle,
    Download,
    Eye,
    FileText,
    Loader2,
    RefreshCw,
    RotateCcw,
    Save,
    ShieldCheck,
    Users,
} from "lucide-react";

const DOC_STATUS_META = {
    pending: { label: "En revisión", variant: "outline" },
    approved: { label: "Aprobado", variant: "default" },
    rejected: { label: "Rechazado", variant: "destructive" },
    needs_correction: { label: "Requiere corrección", variant: "outline" },
};

const SUBSCRIPTION_OPTIONS = Object.keys(SUBSCRIPTION_STATUS_LABEL);

function isPreviewableMime(mime) {
    if (!mime) return false;
    return mime === "application/pdf" || mime.startsWith("image/");
}

function uploadedLabel(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });
}

function DocFileRow({
    d,
    typeLabel,
    showActions,
    canReview,
    reviewing,
    compact,
    onPreview,
    onDownload,
    onApprove,
    onRequestCorrection,
    onReject,
}) {
    const canView = !d.is_demo && isPreviewableMime(d.mime_type);
    const canDownload = !d.is_demo;
    const size = fileSizeLabel(d.size_bytes);
    const kind = mimeShortLabel(d.mime_type);
    const when = uploadedLabel(d.uploaded_at);
    const lockedHint = canReview ? undefined : "Este archivo ya fue revisado";
    return (
        <div
            data-testid={`admin-doc-${d.id}`}
            className={
                compact
                    ? "space-y-2"
                    : "flex flex-col gap-2"
            }
        >
            <div className="flex items-center justify-between gap-3">
                <div className="text-sm min-w-0">
                    {typeLabel ? (
                        <div className="font-medium truncate">{typeLabel}</div>
                    ) : null}
                    <div className="text-xs text-muted-foreground truncate">
                        {d.original_filename || "(sin nombre)"}
                        {kind ? ` · ${kind}` : ""}
                        {size ? ` · ${size}` : ""}
                        {when ? ` · ${when}` : ""}
                        {d.is_demo ? " · ejemplo (sin archivo)" : ""}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Badge
                        variant={DOC_STATUS_META[d.status]?.variant || "outline"}
                        data-testid={`admin-doc-status-${d.id}`}
                    >
                        {DOC_STATUS_META[d.status]?.label || d.status}
                    </Badge>
                    {canView && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onPreview(d)}
                            data-testid={`admin-doc-preview-${d.id}`}
                        >
                            <Eye className="h-4 w-4 mr-1" />
                            Ver
                        </Button>
                    )}
                    {canDownload && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onDownload(d)}
                            data-testid={`admin-doc-download-${d.id}`}
                        >
                            <Download className="h-4 w-4 mr-1" />
                            Descargar
                        </Button>
                    )}
                </div>
            </div>
            {d.review_comment &&
                (d.status === "rejected" || d.status === "needs_correction") && (
                    <p className="text-xs text-destructive">Motivo: {d.review_comment}</p>
                )}
            {showActions && (
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant={d.status === "approved" ? "default" : "outline"}
                        disabled={reviewing || !canReview}
                        title={lockedHint}
                        onClick={() => onApprove(d)}
                        data-testid={`admin-doc-approve-${d.id}`}
                    >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Aprobar
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={reviewing || !canReview}
                        title={lockedHint}
                        onClick={() => onRequestCorrection(d)}
                        data-testid={`admin-doc-request-correction-${d.id}`}
                    >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Pedir corrección
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={reviewing || !canReview}
                        title={lockedHint}
                        onClick={() => onReject(d)}
                        data-testid={`admin-doc-reject-${d.id}`}
                    >
                        <XCircle className="h-4 w-4 mr-1" />
                        Rechazar
                    </Button>
                </div>
            )}
        </div>
    );
}

export default function AdminOrganizerDetail() {
    const { id } = useParams();
    const [org, setOrg] = useState(null);
    const [docs, setDocs] = useState([]);
    const [docTypes, setDocTypes] = useState([]);
    const [countries, setCountries] = useState([]);
    const [plans, setPlans] = useState([]);
    const [edit, setEdit] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [comment, setComment] = useState("");
    const [acting, setActing] = useState(false);
    const [preview, setPreview] = useState(null);
    const [billingIntents, setBillingIntents] = useState([]);
    const [confirmingPay, setConfirmingPay] = useState(false);
    const [refreshingVf, setRefreshingVf] = useState(false);
    const [reviewDialog, setReviewDialog] = useState(null);
    const [reviewComment, setReviewComment] = useState("");
    const [reviewing, setReviewing] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [orgR, docsR, countriesR, plansR, intentsR, typesR] = await Promise.all([
                api.get(`/admin/organizers/${id}`),
                api.get(`/organizers/${id}/documents`),
                api.get("/admin/settings/registration-countries"),
                api.get("/plans"),
                api.get(`/admin/organizers/${id}/billing-intents`).catch(() => ({ data: [] })),
                api.get("/admin/settings/document-types").catch(() => ({ data: [] })),
            ]);
            setOrg(orgR.data);
            setDocs(docsR.data || []);
            setCountries(countriesR.data || []);
            setPlans(plansR.data || []);
            setBillingIntents(intentsR.data || []);
            setDocTypes(typesR.data || []);
            setEdit({
                company_name: orgR.data.company_name || "",
                phone: orgR.data.phone || "",
                legal_id: orgR.data.legal_id || "",
                country_code: orgR.data.country_code || "EC",
                org_type: orgR.data.org_type || "company",
                is_pep: Boolean(orgR.data.is_pep),
                pep_details: orgR.data.pep_details || "",
                plan_code: orgR.data.plan_code || "",
                subscription_status: orgR.data.subscription_status || "none",
                signup_plan_code: orgR.data.signup_plan_code || "",
            });
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        return () => {
            if (preview?.url) URL.revokeObjectURL(preview.url);
        };
    }, [preview?.url]);

    const act = async (action, requireComment) => {
        if (requireComment && comment.trim().length < 2) {
            toast.error("El comentario es obligatorio para esta acción");
            return;
        }
        if (action === "approve" && needsApproveConfirm(org?.verificante)) {
            const ok = window.confirm(approveConfirmMessage(org.verificante));
            if (!ok) return;
        }
        setActing(true);
        try {
            const body = requireComment ? { comment } : { comment: comment || undefined };
            await api.post(`/admin/organizers/${id}/${action}`, body);
            const done = accountActionLabel(action);
            toast.success(
                action === "comment" ? "Comentario guardado" : `Organizador ${done}`,
            );
            setComment("");
            await load();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setActing(false);
        }
    };

    const saveEdit = async () => {
        setSaving(true);
        try {
            const payload: Record<string, any> = {
                company_name: edit.company_name,
                phone: edit.phone,
                legal_id: edit.legal_id,
                country_code: edit.country_code,
                org_type: edit.org_type,
                is_pep: edit.is_pep,
                pep_details: edit.pep_details || null,
                subscription_status: edit.subscription_status,
            };
            if (edit.plan_code) payload.plan_code = edit.plan_code;
            const { data } = await api.patch(`/admin/organizers/${id}`, payload);
            setOrg(data);
            toast.success("Organizador actualizado");
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSaving(false);
        }
    };

    const confirmGatewayPayment = async (intentId) => {
        setConfirmingPay(true);
        try {
            const { data } = await api.post(
                `/admin/organizers/${id}/confirm-plan-payment`,
                {
                    intent_id: intentId,
                    comment: "Pago Nuvei/DeUna confirmado por admin",
                },
            );
            setOrg(data);
            toast.success("Pago confirmado — plan activado");
            await load();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setConfirmingPay(false);
        }
    };

    const openPreview = async (doc) => {
        if (preview?.url) URL.revokeObjectURL(preview.url);
        setPreview({ doc, url: null, loading: true, error: null });
        try {
            const { data } = await api.get(
                `/organizers/${id}/documents/${doc.id}/download`,
                { responseType: "blob" },
            );
            const blob = data instanceof Blob ? data : new Blob([data], { type: doc.mime_type });
            const url = URL.createObjectURL(blob);
            setPreview({ doc, url, loading: false, error: null });
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
            const { data } = await api.get(
                `/organizers/${id}/documents/${doc.id}/download`,
                { responseType: "blob" },
            );
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

    const reviewDoc = async (doc, status, reviewNote?: string) => {
        setReviewing(true);
        try {
            const { data } = await api.patch(
                `/organizers/${id}/documents/${doc.id}/review`,
                { status, comment: reviewNote },
            );
            setDocs((prev) => prev.map((d) => (d.id === doc.id ? data : d)));
            toast.success("Documento actualizado");
            setReviewDialog(null);
            setReviewComment("");
        } catch (err) {
            toast.error(await formatBlobApiError(err, "No se pudo actualizar el documento"));
        } finally {
            setReviewing(false);
        }
    };

    const selectedCountry = countries.find((c) => c.code === edit.country_code) || null;
    const legalLabel = legalIdFieldLabel(edit.org_type, selectedCountry);
    const uafe = useMemo(() => uafeRows(org?.uafe_declaration), [org?.uafe_declaration]);
    const refs = useMemo(() => referenceRows(org?.org_references), [org?.org_references]);
    const socials = useMemo(() => socialLinkRows(org?.social_links), [org?.social_links]);
    const docTypeLabel = (code) =>
        docTypes.find((t) => t.code === code)?.label || code;
    const docGroups = useMemo(() => groupDocumentsByType(docs), [docs]);
    const pendingDocs = docGroups.filter((g) => g.current?.status === "pending").length;

    if (loading && !org) {
        return <p className="text-sm text-muted-foreground">Cargando…</p>;
    }
    if (!org) {
        return <p className="text-sm text-destructive">Organizador no encontrado</p>;
    }

    const countryName =
        countries.find((c) => c.code === org.country_code)?.name || org.country || org.country_code;
    const assignedPlanName = planDisplayName(org.plan_code, plans);
    const signupPlanName = planDisplayName(org.signup_plan_code, plans);
    const planHeroValue = assignedPlanName
        ? signupPlanName && signupPlanName !== assignedPlanName
            ? `${assignedPlanName} · eligió ${signupPlanName}`
            : assignedPlanName
        : signupPlanName || "Sin plan";
    const planHeroLabel = assignedPlanName ? "Plan en la cuenta" : "Plan elegido";

    return (
        <div data-testid="admin-org-detail" className="space-y-8">
            <Button asChild variant="ghost" size="sm" className="-ml-2" data-testid="back-to-list">
                <Link to="/admin/organizadores">
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Organizadores
                </Link>
            </Button>

            <div className="overflow-hidden rounded-2xl border border-border/70 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                <div className="flex items-start justify-between gap-4 border-b border-orange-100 bg-gradient-to-r from-orange-50/90 to-white px-5 py-5">
                    <div className="space-y-2 min-w-0">
                        <Badge
                            variant="secondary"
                            className="text-orange-700 bg-orange-50 border-orange-100"
                        >
                            Super admin
                        </Badge>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                            {org.company_name}
                        </h1>
                        <p className="text-sm text-muted-foreground break-all">
                            {org.email}
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span className="font-mono">/{org.slug}</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge
                                data-testid="org-detail-status"
                                className={ORG_STATUS_STYLE[org.status] || ""}
                            >
                                <span className="sr-only">{org.status}</span>
                                {orgStatusLabel(org.status)}
                            </Badge>
                            <Badge variant="outline">{orgTypeLabel(org.org_type)}</Badge>
                            <Badge variant="outline">{countryName}</Badge>
                            {org.is_pep && (
                                <Badge className="bg-amber-100 text-amber-900">PEP</Badge>
                            )}
                        </div>
                    </div>
                    <div
                        className="grid h-14 w-14 shrink-0 place-items-center rounded-sm border-2 border-orange-600/45 bg-white font-mono text-sm font-bold tracking-[0.22em] text-orange-800 -rotate-6 shadow-sm"
                        aria-hidden
                    >
                        {org.country_code || "—"}
                    </div>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 px-5 py-4 text-sm">
                    <Fact
                        label={legalLabel}
                        value={org.legal_id}
                        mono
                    />
                    <Fact
                        label={planHeroLabel}
                        value={planHeroValue}
                    />
                    <Fact
                        label="Suscripción"
                        value={subscriptionStatusLabel(org.subscription_status)}
                    />
                    <Fact
                        label="Alta"
                        value={new Date(org.created_at).toLocaleString("es-EC")}
                    />
                </div>
            </div>

            <Card className="border-border/70 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                <CardHeader>
                    <CardTitle className="text-lg">Decisión de la cuenta</CardTitle>
                    <p className="text-sm text-muted-foreground font-normal">
                        Aprobar no depende de Verificante: es una señal. El comentario es
                        obligatorio para rechazar o suspender.
                    </p>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Comentario (obligatorio para rechazar o suspender)"
                        data-testid="admin-comment-input"
                        rows={3}
                    />
                    <div className="flex flex-wrap gap-2">
                        <Button
                            onClick={() => act("approve", false)}
                            disabled={acting}
                            data-testid="admin-approve-btn"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Aprobar
                        </Button>
                        <Button
                            onClick={() => act("reject", true)}
                            disabled={acting}
                            data-testid="admin-reject-btn"
                            variant="destructive"
                        >
                            <XCircle className="h-4 w-4 mr-1" />
                            Rechazar
                        </Button>
                        <Button
                            onClick={() => act("suspend", true)}
                            disabled={acting}
                            data-testid="admin-suspend-btn"
                            variant="outline"
                        >
                            <Pause className="h-4 w-4 mr-1" />
                            Suspender
                        </Button>
                        <Button
                            onClick={() => act("comment", true)}
                            disabled={acting}
                            data-testid="admin-comment-btn"
                            variant="ghost"
                        >
                            <MessageCircle className="h-4 w-4 mr-1" />
                            Sólo comentar
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {(org.verificante ||
                (org.org_type === "individual" && org.country_code === "EC")) && (
                <Card className="border-border/70" data-testid="admin-verificante-card">
                    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                        <div>
                            <CardTitle className="text-lg inline-flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-orange-600" />
                                Identidad (Verificante)
                            </CardTitle>
                            <p className="text-sm text-muted-foreground font-normal mt-1">
                                Riesgo bajo favorece; no aprueba la cuenta.
                            </p>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={refreshingVf}
                            onClick={async () => {
                                setRefreshingVf(true);
                                try {
                                    await api.post(
                                        `/admin/organizers/${id}/refresh-verificante`,
                                    );
                                    toast.success("Verificante actualizado");
                                    await load();
                                } catch (err) {
                                    toast.error(
                                        formatApiError(err?.response?.data?.detail) ||
                                            err.message,
                                    );
                                } finally {
                                    setRefreshingVf(false);
                                }
                            }}
                            data-testid="admin-verificante-refresh"
                        >
                            {refreshingVf ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                            )}
                            Actualizar
                        </Button>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        {!org.verificante ? (
                            <p className="text-muted-foreground">
                                Todavía no hay consulta. Podés dispararla con «Actualizar».
                            </p>
                        ) : org.verificante.status === "skipped" ? (
                            <p className="text-muted-foreground">
                                No se consultó Verificante
                                {org.verificante.error
                                    ? ` (${org.verificante.error})`
                                    : ""}
                                . La aprobación sigue siendo tuya.
                            </p>
                        ) : (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                        className={
                                            verificanteRiskMeta(org.verificante.risk_level)
                                                .className
                                        }
                                        data-testid="admin-verificante-risk"
                                    >
                                        {
                                            verificanteRiskMeta(org.verificante.risk_level)
                                                .label
                                        }
                                    </Badge>
                                    {org.verificante.status && (
                                        <Badge
                                            className={
                                                (
                                                    VERIFICANTE_STATUS[
                                                        org.verificante.status
                                                    ] || VERIFICANTE_STATUS.pending
                                                ).className
                                            }
                                        >
                                            {
                                                (
                                                    VERIFICANTE_STATUS[
                                                        org.verificante.status
                                                    ] || VERIFICANTE_STATUS.pending
                                                ).label
                                            }
                                        </Badge>
                                    )}
                                    {org.verificante.mock && (
                                        <Badge className="bg-amber-100 text-amber-800">
                                            Prueba
                                        </Badge>
                                    )}
                                </div>
                                {org.verificante.person_names && (
                                    <p>
                                        Nombre en registro civil:{" "}
                                        <span className="font-medium">
                                            {org.verificante.person_names}
                                        </span>
                                    </p>
                                )}
                                {org.verificante.identification && (
                                    <p className="font-mono text-xs text-muted-foreground">
                                        Cédula {org.verificante.identification}
                                    </p>
                                )}
                                {plainTextFromHtml(org.verificante.summary) ? (
                                    <p className="text-muted-foreground">
                                        {plainTextFromHtml(org.verificante.summary)}
                                    </p>
                                ) : null}
                                {org.verificante.error &&
                                    org.verificante.status === "failed" && (
                                        <p className="text-red-700">
                                            {org.verificante.error}
                                        </p>
                                    )}
                                {org.verificante.pdf_url && (
                                    <Button asChild variant="outline" size="sm">
                                        <a
                                            href={org.verificante.pdf_url}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            <FileText className="h-3.5 w-3.5 mr-1" />
                                            Informe PDF
                                        </a>
                                    </Button>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            <div className="grid lg:grid-cols-2 gap-6 items-start">
                <Card className="border-border/70 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="text-lg">Datos de la cuenta</CardTitle>
                            <p className="text-sm text-muted-foreground font-normal mt-1">
                                Nombre, documento, plan y si es persona políticamente expuesta.
                            </p>
                        </div>
                        <Button
                            size="sm"
                            onClick={saveEdit}
                            disabled={saving}
                            data-testid="admin-org-save-btn"
                        >
                            {saving ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-1" />
                            )}
                            Guardar
                        </Button>
                    </CardHeader>
                    <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Nombre</Label>
                            <Input
                                value={edit.company_name}
                                onChange={(e) =>
                                    setEdit((f) => ({ ...f, company_name: e.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Teléfono</Label>
                            <Input
                                value={edit.phone}
                                onChange={(e) =>
                                    setEdit((f) => ({ ...f, phone: e.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>{legalLabel}</Label>
                            <Input
                                value={edit.legal_id}
                                onChange={(e) =>
                                    setEdit((f) => ({ ...f, legal_id: e.target.value }))
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Tipo</Label>
                            <Select
                                value={edit.org_type}
                                onValueChange={(v) => setEdit((f) => ({ ...f, org_type: v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="individual">Persona natural</SelectItem>
                                    <SelectItem value="company">Empresa</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>País</Label>
                            <Select
                                value={edit.country_code}
                                onValueChange={(v) =>
                                    setEdit((f) => ({ ...f, country_code: v }))
                                }
                            >
                                <SelectTrigger data-testid="admin-org-country">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {countries.map((c) => (
                                        <SelectItem key={c.code} value={c.code}>
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5 sm:col-span-2 rounded-lg border border-border/60 bg-slate-50/60 px-3 py-2.5">
                            <p className="text-xs uppercase tracking-wider text-muted-foreground">
                                Plan elegido al registrarse
                            </p>
                            <p
                                className="font-medium"
                                data-testid="admin-org-signup-plan"
                            >
                                {signupPlanName || "No eligió un plan"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Lo eligió en el registro. No se activa solo: queda vigente
                                cuando paga o cuando se lo asignás abajo.
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Plan asignado en la cuenta</Label>
                            <Select
                                value={edit.plan_code || "__none__"}
                                onValueChange={(v) =>
                                    setEdit((f) => ({
                                        ...f,
                                        plan_code: v === "__none__" ? "" : v,
                                    }))
                                }
                            >
                                <SelectTrigger data-testid="admin-org-plan">
                                    <SelectValue placeholder="Sin plan" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">Sin plan</SelectItem>
                                    {plans.map((p) => (
                                        <SelectItem key={p.code} value={p.code}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Estado de la suscripción</Label>
                            <Select
                                value={edit.subscription_status}
                                onValueChange={(v) =>
                                    setEdit((f) => ({ ...f, subscription_status: v }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {SUBSCRIPTION_OPTIONS.map((s) => (
                                        <SelectItem key={s} value={s}>
                                            {SUBSCRIPTION_STATUS_LABEL[s]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>¿Es persona políticamente expuesta (PEP)?</Label>
                            <Select
                                value={edit.is_pep ? "yes" : "no"}
                                onValueChange={(v) =>
                                    setEdit((f) => ({ ...f, is_pep: v === "yes" }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="no">No</SelectItem>
                                    <SelectItem value="yes">Sí</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {edit.is_pep && (
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label>Cargo, institución y periodo</Label>
                                <Textarea
                                    value={edit.pep_details}
                                    onChange={(e) =>
                                        setEdit((f) => ({ ...f, pep_details: e.target.value }))
                                    }
                                    placeholder="Detalle declarado por el organizador"
                                />
                            </div>
                        )}
                        {org.approved_at && (
                            <p className="sm:col-span-2 text-xs text-muted-foreground">
                                Aprobado el{" "}
                                {new Date(org.approved_at).toLocaleString("es-EC")}
                                {org.approved_by ? ` por ${org.approved_by}` : ""}.
                            </p>
                        )}
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card className="border-border/70" data-testid="admin-org-compliance">
                        <CardHeader>
                            <CardTitle className="text-lg">Declaraciones</CardTitle>
                            <p className="text-sm text-muted-foreground font-normal">
                                Lo que el organizador declaró al registrarse. No se edita
                                desde acá.
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-5 text-sm">
                            <div>
                                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                                    PEP
                                </p>
                                <p className="mt-1 font-medium">
                                    {yesNo(Boolean(org.is_pep))}
                                    {org.is_pep && org.pep_details
                                        ? ` · ${org.pep_details}`
                                        : ""}
                                </p>
                            </div>

                            {uafe.length > 0 ? (
                                <div className="space-y-2" data-testid="admin-org-uafe">
                                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                                        UAFE / origen de fondos
                                    </p>
                                    <ul className="space-y-2">
                                        {uafe.map((row) => (
                                            <li
                                                key={row.key}
                                                className="flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2"
                                            >
                                                {row.kind === "bool" ? (
                                                    row.ok ? (
                                                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                                                    ) : (
                                                        <XCircle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                                                    )
                                                ) : (
                                                    <FileText className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
                                                )}
                                                <div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {row.label}
                                                    </div>
                                                    <div className="font-medium">{row.value}</div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : (
                                <p className="text-muted-foreground text-xs">
                                    Sin declaración UAFE.
                                </p>
                            )}

                            {refs.length > 0 ? (
                                <div className="space-y-2" data-testid="admin-org-references">
                                    <p className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
                                        <Users className="h-3.5 w-3.5" />
                                        Referencias
                                    </p>
                                    <div className="overflow-hidden rounded-lg border border-border/60">
                                        <table className="w-full text-sm">
                                            <thead className="bg-slate-50 text-xs text-muted-foreground">
                                                <tr>
                                                    <th className="text-left font-medium px-3 py-2">
                                                        Nombre
                                                    </th>
                                                    <th className="text-left font-medium px-3 py-2">
                                                        Teléfono
                                                    </th>
                                                    <th className="text-left font-medium px-3 py-2">
                                                        Relación
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {refs.map((r) => (
                                                    <tr key={r.key} className="border-t border-border/60">
                                                        <td className="px-3 py-2 font-medium">
                                                            {r.name}
                                                        </td>
                                                        <td className="px-3 py-2 font-mono text-xs">
                                                            {r.phone}
                                                        </td>
                                                        <td className="px-3 py-2 text-muted-foreground">
                                                            {r.relation || "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-muted-foreground text-xs">
                                    Sin referencias.
                                </p>
                            )}

                            {socials.length > 0 ? (
                                <div className="space-y-2" data-testid="admin-org-social">
                                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                                        Redes
                                    </p>
                                    <ul className="space-y-1.5">
                                        {socials.map((s) => (
                                            <li key={s.key} className="flex items-center gap-2">
                                                <span className="text-muted-foreground w-24 shrink-0">
                                                    {s.label}
                                                </span>
                                                {s.href ? (
                                                    <a
                                                        href={s.href}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="font-medium text-orange-800 hover:underline inline-flex items-center gap-1 truncate"
                                                    >
                                                        {s.value}
                                                        <ExternalLink className="h-3 w-3 shrink-0" />
                                                    </a>
                                                ) : (
                                                    <span className="font-medium truncate">
                                                        {s.value}
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}

                            {org.legal_address ? (
                                <div>
                                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                                        Dirección
                                    </p>
                                    <p className="mt-1">{org.legal_address}</p>
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {billingIntents.some((i) => i.status === "pending_gateway") && (
                <Card className="border-sky-200 bg-sky-50/40" data-testid="admin-gateway-payments">
                    <CardHeader>
                        <CardTitle className="text-lg">
                            Pagos de plan pendientes (Nuvei / DeUna)
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {billingIntents
                            .filter((i) => i.status === "pending_gateway")
                            .map((intent) => (
                                <div
                                    key={intent.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-200 bg-white p-3"
                                >
                                    <div className="text-sm">
                                        <div className="font-medium capitalize">
                                            {intent.payment_method} · plan {intent.plan_code}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {new Date(intent.created_at).toLocaleString("es-EC")} ·{" "}
                                            {intent.session_id}
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        disabled={confirmingPay}
                                        onClick={() => confirmGatewayPayment(intent.id)}
                                        data-testid={`admin-confirm-pay-${intent.id}`}
                                    >
                                        {confirmingPay && (
                                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        )}
                                        Confirmar pago y activar
                                    </Button>
                                </div>
                            ))}
                    </CardContent>
                </Card>
            )}

            <Card className="border-border/70" data-testid="admin-publish-gates">
                <CardHeader>
                    <CardTitle className="text-lg">Para poder publicar eventos</CardTitle>
                    <p className="text-sm text-muted-foreground font-normal">
                        Plan activo, cargo de verificación y contrato. Podés marcarlos a
                        mano si el pago o la firma ocurrieron fuera de TYS.
                    </p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div className="grid sm:grid-cols-3 gap-3">
                        <GateFact
                            label="Suscripción"
                            value={subscriptionStatusLabel(org.subscription_status)}
                            ok={["active", "trialing"].includes(org.subscription_status)}
                        />
                        <GateFact
                            label="Cargo de verificación"
                            value={`${verificationFeeLabel(org.verification_fee_status)}${
                                org.verification_fee_cents != null
                                    ? ` · $${(org.verification_fee_cents / 100).toFixed(2)}`
                                    : ""
                            }`}
                            ok={
                                org.verification_fee_status === "paid" ||
                                org.verification_fee_status === "waived"
                            }
                        />
                        <GateFact
                            label="Contrato"
                            value={contractStatusLabel(org.contract_status)}
                            ok={org.contract_status === "signed"}
                        />
                    </div>
                    {org.contract_external_id ? (
                        <p className="text-xs font-mono text-muted-foreground truncate">
                            OneShot {org.contract_external_id}
                        </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        {org.verification_fee_status === "pending" && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                    try {
                                        await api.post(
                                            `/admin/organizers/${id}/mark-verification-paid`,
                                        );
                                        toast.success("Verificación marcada como pagada");
                                        load();
                                    } catch (err) {
                                        toast.error(
                                            formatApiError(err?.response?.data?.detail) ||
                                                err.message,
                                        );
                                    }
                                }}
                            >
                                Marcar verificación pagada
                            </Button>
                        )}
                        {org.contract_status !== "signed" && (
                            <>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                        try {
                                            await api.post(
                                                `/admin/organizers/${id}/mark-contract-signed`,
                                            );
                                            toast.success("Contrato marcado como firmado");
                                            load();
                                        } catch (err) {
                                            toast.error(
                                                formatApiError(err?.response?.data?.detail) ||
                                                    err.message,
                                            );
                                        }
                                    }}
                                >
                                    Marcar contrato firmado
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={async () => {
                                        try {
                                            await api.post(
                                                `/admin/organizers/${id}/resend-contract`,
                                            );
                                            toast.success("Contrato reenviado / regenerado");
                                            load();
                                        } catch (err) {
                                            toast.error(
                                                formatApiError(err?.response?.data?.detail) ||
                                                    err.message,
                                            );
                                        }
                                    }}
                                >
                                    Reenviar contrato OneShot
                                </Button>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <FileText className="h-5 w-5 text-orange-600" />
                        Documentos
                        <span className="text-sm font-normal text-muted-foreground">
                            ({docs.length}
                            {pendingDocs > 0 ? ` · ${pendingDocs} en revisión` : ""})
                        </span>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground font-normal">
                        El archivo más reciente de cada tipo es el vigente. Si pediste
                        corrección, la nueva subida queda agrupada con el pedido.
                    </p>
                </CardHeader>
                <CardContent className="space-y-3">
                    {docs.length === 0 ? (
                        <p className="text-sm text-muted-foreground" data-testid="org-docs-empty">
                            Todavía no cargó documentos.
                        </p>
                    ) : (
                        docGroups.map((group) => {
                            const current = group.current;
                            const canReview = documentReviewEnabled(current?.status);
                            return (
                                <div
                                    key={group.docType}
                                    data-testid={`admin-doc-group-${group.docType}`}
                                    className={
                                        group.isCorrectionUpload
                                            ? "rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-3"
                                            : "rounded-lg border border-border/70 p-3 space-y-3"
                                    }
                                >
                                    {group.isCorrectionUpload && (
                                        <p
                                            className="text-xs font-medium text-amber-900"
                                            data-testid={`admin-doc-correction-banner-${group.docType}`}
                                        >
                                            El organizador subió este archivo en respuesta al
                                            pedido de corrección. Revisá este, no el de abajo.
                                        </p>
                                    )}
                                    <DocFileRow
                                        d={current}
                                        typeLabel={docTypeLabel(current.doc_type)}
                                        showActions
                                        canReview={canReview}
                                        reviewing={reviewing}
                                        onPreview={openPreview}
                                        onDownload={downloadDoc}
                                        onApprove={(doc) => reviewDoc(doc, "approved")}
                                        onRequestCorrection={(doc) =>
                                            setReviewDialog({
                                                doc,
                                                status: "needs_correction",
                                            })
                                        }
                                        onReject={(doc) =>
                                            setReviewDialog({ doc, status: "rejected" })
                                        }
                                    />
                                    {group.previous.length > 0 && (
                                        <div className="space-y-3 border-l-2 border-amber-300 pl-3 ml-1">
                                            {group.previous.map((prev) => (
                                                <div
                                                    key={prev.id}
                                                    className="space-y-1"
                                                    data-testid={`admin-doc-previous-${prev.id}`}
                                                >
                                                    <p className="text-xs font-medium text-muted-foreground">
                                                        {previousVersionLabel(prev.status)}
                                                    </p>
                                                    <DocFileRow
                                                        d={prev}
                                                        compact
                                                        showActions={false}
                                                        canReview={false}
                                                        reviewing={reviewing}
                                                        onPreview={openPreview}
                                                        onDownload={downloadDoc}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </CardContent>
            </Card>

            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <MessageCircle className="h-5 w-5 text-orange-600" />
                        Historial
                        <span className="text-sm font-normal text-muted-foreground">
                            ({org.admin_comments?.length || 0})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(org.admin_comments || []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sin comentarios.</p>
                    ) : (
                        org.admin_comments
                            .slice()
                            .reverse()
                            .map((c) => (
                                <div
                                    key={c.id}
                                    data-testid={`admin-comment-${c.id}`}
                                    className="p-3 rounded-lg border border-border/60 text-sm space-y-1"
                                >
                                    <div className="text-xs text-muted-foreground">
                                        {c.admin_email || c.admin_id} ·{" "}
                                        {new Date(c.created_at).toLocaleString("es-EC")}
                                    </div>
                                    <div>{c.comment}</div>
                                </div>
                            ))
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!preview} onOpenChange={(open) => !open && closePreview()}>
                <DialogContent
                    className="max-w-4xl w-[95vw] h-[85vh] flex flex-col"
                    data-testid="admin-doc-preview-dialog"
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

            <Dialog
                open={!!reviewDialog}
                onOpenChange={(open) => {
                    if (!open) {
                        setReviewDialog(null);
                        setReviewComment("");
                    }
                }}
            >
                <DialogContent data-testid="admin-doc-review-dialog">
                    <DialogHeader>
                        <DialogTitle>
                            {reviewDialog?.status === "rejected"
                                ? "Rechazar documento"
                                : "Pedir corrección"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="review-comment">Motivo (obligatorio)</Label>
                        <Textarea
                            id="review-comment"
                            data-testid="admin-doc-review-comment"
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder="Explicá al organizador qué debe corregir o por qué se rechaza"
                            rows={4}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                setReviewDialog(null);
                                setReviewComment("");
                            }}
                            disabled={reviewing}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={reviewing || !reviewComment.trim()}
                            onClick={() =>
                                reviewDoc(
                                    reviewDialog.doc,
                                    reviewDialog.status,
                                    reviewComment.trim(),
                                )
                            }
                            data-testid="admin-doc-review-confirm"
                        >
                            {reviewing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            Confirmar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Fact({ label, value, mono = false }) {
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
            </div>
            <div className={cn("mt-0.5 font-medium break-all", mono && "font-mono text-xs")}>
                {value || "—"}
            </div>
        </div>
    );
}

function GateFact({ label, value, ok }) {
    return (
        <div
            className={cn(
                "rounded-lg border px-3 py-2",
                ok ? "border-emerald-200 bg-emerald-50/50" : "border-border/70",
            )}
        >
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
            </div>
            <div className="mt-0.5 font-medium">{value || "—"}</div>
        </div>
    );
}
