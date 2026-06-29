import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import api, { API_BASE, formatApiError } from "@/lib/api";
import {
    ArrowLeft,
    CheckCircle2,
    XCircle,
    Pause,
    MessageCircle,
    Download,
    FileText,
} from "lucide-react";

const STATUS_STYLE = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    suspended: "bg-zinc-200 text-zinc-700",
};

export default function AdminOrganizerDetail() {
    const { id } = useParams();
    const [org, setOrg] = useState(null);
    const [docs, setDocs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [comment, setComment] = useState("");
    const [acting, setActing] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [orgR, docsR] = await Promise.all([
                api.get(`/admin/organizers/${id}`),
                api.get(`/organizers/${id}/documents`),
            ]);
            setOrg(orgR.data);
            setDocs(docsR.data || []);
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        load();
    }, [load]);

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
                </p>
            </header>

            {/* Datos */}
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-lg">Datos</CardTitle>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
                    <Field label="Tipo" value={org.org_type} />
                    <Field label="RUC / Cédula" value={org.legal_id} />
                    <Field label="Teléfono" value={org.phone} />
                    <Field label="País" value={org.country} />
                    <Field label="Creado" value={new Date(org.created_at).toLocaleString("es-EC")} />
                    {org.approved_at && (
                        <Field
                            label="Aprobado"
                            value={`${new Date(org.approved_at).toLocaleString("es-EC")} por ${org.approved_by || "—"}`}
                        />
                    )}
                </CardContent>
            </Card>

            {/* Documents */}
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
                                className="flex items-center justify-between p-3 rounded-lg border border-border/70"
                            >
                                <div className="text-sm">
                                    <div className="font-medium">
                                        {d.original_filename || "(sin nombre)"}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {d.doc_type} · {d.mime_type} · {(d.size_bytes / 1024).toFixed(1)} KB
                                    </div>
                                </div>
                                <a
                                    href={`${API_BASE}/organizers/${org.id}/documents/${d.id}/download`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    data-testid={`admin-doc-download-${d.id}`}
                                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                                >
                                    <Download className="h-4 w-4" />
                                    Descargar
                                </a>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            {/* Comments history */}
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

            {/* Actions */}
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
