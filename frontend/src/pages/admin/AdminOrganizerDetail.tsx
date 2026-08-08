import { useCallback, useEffect, useState } from "react";
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
import api, { formatApiError } from "@/lib/api";
import {
    ArrowLeft,
    CheckCircle2,
    XCircle,
    Pause,
    MessageCircle,
    Download,
    Eye,
    FileText,
    Loader2,
    Save,
} from "lucide-react";

const STATUS_STYLE = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    suspended: "bg-zinc-200 text-zinc-700",
};

function isPreviewableMime(mime) {
    if (!mime) return false;
    return mime === "application/pdf" || mime.startsWith("image/");
}

export default function AdminOrganizerDetail() {
    const { id } = useParams();
    const [org, setOrg] = useState(null);
    const [docs, setDocs] = useState([]);
    const [countries, setCountries] = useState([]);
    const [plans, setPlans] = useState([]);
    const [edit, setEdit] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [comment, setComment] = useState("");
    const [acting, setActing] = useState(false);
    const [preview, setPreview] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [orgR, docsR, countriesR, plansR] = await Promise.all([
                api.get(`/admin/organizers/${id}`),
                api.get(`/organizers/${id}/documents`),
                api.get("/admin/settings/registration-countries"),
                api.get("/plans"),
            ]);
            setOrg(orgR.data);
            setDocs(docsR.data || []);
            setCountries(countriesR.data || []);
            setPlans(plansR.data || []);
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
        setActing(true);
        try {
            const body = requireComment ? { comment } : { comment: comment || undefined };
            await api.post(`/admin/organizers/${id}/${action}`, body);
            toast.success(`Organizador ${action} OK`);
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
            const payload = {
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
                error:
                    formatApiError(err?.response?.data?.detail) ||
                    "No se pudo cargar la vista previa",
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
            toast.error(
                formatApiError(err?.response?.data?.detail) || "No se pudo descargar",
            );
        }
    };

    if (loading && !org) {
        return <p className="text-sm text-muted-foreground">Cargando…</p>;
    }
    if (!org) {
        return <p className="text-sm text-destructive">Organizador no encontrado</p>;
    }

    return (
        <div data-testid="admin-org-detail" className="space-y-6">
            <div className="flex items-center justify-between">
                <Button asChild variant="ghost" size="sm" data-testid="back-to-list">
                    <Link to="/admin/organizadores">
                        <ArrowLeft className="h-4 w-4 mr-1" />
                        Volver
                    </Link>
                </Button>
                <Badge
                    data-testid="org-detail-status"
                    className={STATUS_STYLE[org.status] || ""}
                >
                    {org.status}
                </Badge>
            </div>

            <header className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">
                    {org.company_name}
                </h1>
                <p className="text-sm text-muted-foreground">
                    {org.email} ·{" "}
                    <span className="font-mono">{org.slug}</span> · plan:{" "}
                    {org.plan_code || "—"} · sub: {org.subscription_status}
                    {org.signup_plan_code ? ` · intención: ${org.signup_plan_code}` : ""}
                </p>
            </header>

            <Card className="border-border/70">
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">Datos editables</CardTitle>
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
                    <div className="space-y-1.5">
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
                            onChange={(e) => setEdit((f) => ({ ...f, phone: e.target.value }))}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>RUC / Cédula</Label>
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
                                        {c.name} ({c.code})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Plan asignado</Label>
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
                        <Label>Estado suscripción</Label>
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
                                {["none", "trialing", "active", "past_due", "canceled"].map(
                                    (s) => (
                                        <SelectItem key={s} value={s}>
                                            {s}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>PEP</Label>
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
                            <Label>Detalle PEP</Label>
                            <Textarea
                                value={edit.pep_details}
                                onChange={(e) =>
                                    setEdit((f) => ({ ...f, pep_details: e.target.value }))
                                }
                            />
                        </div>
                    )}
                    <Field
                        label="Creado"
                        value={new Date(org.created_at).toLocaleString("es-EC")}
                    />
                    {org.approved_at && (
                        <Field
                            label="Aprobado"
                            value={`${new Date(org.approved_at).toLocaleString("es-EC")} por ${org.approved_by || "—"}`}
                        />
                    )}
                    {org.uafe_declaration && (
                        <div className="sm:col-span-2 text-xs text-muted-foreground">
                            <div className="uppercase tracking-wider mb-1">UAFE</div>
                            <pre className="bg-muted/40 rounded p-2 overflow-auto">
                                {JSON.stringify(org.uafe_declaration, null, 2)}
                            </pre>
                        </div>
                    )}
                    {org.org_references?.length > 0 && (
                        <div className="sm:col-span-2 text-xs text-muted-foreground">
                            <div className="uppercase tracking-wider mb-1">Referencias</div>
                            <pre className="bg-muted/40 rounded p-2 overflow-auto">
                                {JSON.stringify(org.org_references, null, 2)}
                            </pre>
                        </div>
                    )}
                    {org.social_links && (
                        <div className="sm:col-span-2 text-xs text-muted-foreground">
                            <div className="uppercase tracking-wider mb-1">Redes</div>
                            <pre className="bg-muted/40 rounded p-2 overflow-auto">
                                {JSON.stringify(org.social_links, null, 2)}
                            </pre>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        Documentos ({docs.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {docs.length === 0 ? (
                        <p className="text-sm text-muted-foreground" data-testid="org-docs-empty">
                            Sin documentos cargados.
                        </p>
                    ) : (
                        docs.map((d) => (
                            <div
                                key={d.id}
                                data-testid={`admin-doc-${d.id}`}
                                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/70"
                            >
                                <div className="text-sm min-w-0">
                                    <div className="font-medium truncate">
                                        {d.original_filename || "(sin nombre)"}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {d.doc_type} · {d.mime_type} · {(d.size_bytes / 1024).toFixed(1)} KB
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {isPreviewableMime(d.mime_type) && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => openPreview(d)}
                                            data-testid={`admin-doc-preview-${d.id}`}
                                        >
                                            <Eye className="h-4 w-4 mr-1" />
                                            Previsualizar
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => downloadDoc(d)}
                                        data-testid={`admin-doc-download-${d.id}`}
                                    >
                                        <Download className="h-4 w-4 mr-1" />
                                        Descargar
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <MessageCircle className="h-5 w-5 text-primary" />
                        Historial de comentarios ({org.admin_comments?.length || 0})
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

            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <CardTitle className="text-lg">Acciones</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Comentario (obligatorio para rechazar/suspender)"
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
        </div>
    );
}

function Field({ label, value }) {
    return (
        <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
            </div>
            <div className="text-sm font-medium break-all">{value || "—"}</div>
        </div>
    );
}
