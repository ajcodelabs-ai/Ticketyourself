import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ShareModal from "@/components/microsite/ShareModal";
import { useAuth } from "@/contexts/AuthContext";
import { PUBLIC_DOMAIN, publicMicrositeHost, previewMicrositePath } from "@/lib/config";
import {
    AlertTriangle,
    CheckCircle2,
    Clock,
    CreditCard,
    Globe,
    MessageCircle,
    Shield,
    Sparkles,
    Edit3,
    Share2,
    ExternalLink,
} from "lucide-react";

const SUB_STATUS_LABEL = {
    none: "sin plan",
    active: "activa",
    trialing: "en trial",
    past_due: "pago atrasado",
    canceled: "cancelada",
};

export default function Dashboard() {
    const { organizer } = useAuth();
    const navigate = useNavigate();
    const [shareOpen, setShareOpen] = useState(false);

    useEffect(() => {
        if (!organizer) return;
        // Need to finish onboarding? (pending + no plan yet)
        if (organizer.status === "pending" && organizer.subscription_status === "none") {
            navigate("/onboarding", { replace: true });
        }
    }, [organizer, navigate]);

    const micrositePublicUrl = useMemo(() => {
        if (!organizer?.slug) return "";
        return `${window.location.origin}${previewMicrositePath(organizer.slug)}`;
    }, [organizer?.slug]);

    if (!organizer) {
        return (
            <div className="text-sm text-muted-foreground" data-testid="dashboard-no-org">
                Cargando datos del organizador…
            </div>
        );
    }

    return (
        <div data-testid="dashboard-page" className="space-y-8">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Dashboard
                </Badge>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                    Hola, <span className="text-primary">{organizer.company_name}</span>
                </h1>
            </header>

            <StatusCard organizer={organizer} />

            <section className="grid md:grid-cols-3 gap-4" data-testid="dashboard-quick">
                <QuickCard
                    icon={<CreditCard className="h-5 w-5" />}
                    title="Plan"
                    value={organizer.plan_code || "—"}
                    sub={`Estado: ${SUB_STATUS_LABEL[organizer.subscription_status] || organizer.subscription_status}`}
                    testid="card-plan"
                />
                <QuickCard
                    icon={<Globe className="h-5 w-5" />}
                    title="Tu microsite"
                    value={publicMicrositeHost(organizer.slug)}
                    sub="Activo cuando aprobemos tu cuenta"
                    testid="card-slug"
                />
                <QuickCard
                    icon={<Shield className="h-5 w-5" />}
                    title="Estado de cuenta"
                    value={organizer.status}
                    sub="Comentarios del equipo abajo"
                    testid="card-status"
                />
            </section>

            {organizer.status === "approved" ? (
                <Card className="border-border/70" data-testid="dash-microsite-card">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Globe className="h-5 w-5 text-primary" />
                            Tu microsite
                        </CardTitle>
                        <CardDescription>
                            Publicado en{" "}
                            <code
                                className="bg-secondary px-1.5 py-0.5 rounded font-mono text-foreground"
                                data-testid="dash-microsite-host"
                            >
                                {publicMicrositeHost(organizer.slug)}
                            </code>
                            <span className="ml-2 text-xs">
                                <Badge variant="outline" className="text-xs">
                                    Próximamente en producción
                                </Badge>
                            </span>
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        <Button
                            asChild
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            data-testid="dash-microsite-edit-btn"
                        >
                            <Link to="/microsite/editor">
                                <Edit3 className="h-4 w-4 mr-1.5" />
                                Editar microsite
                            </Link>
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setShareOpen(true)}
                            data-testid="dash-microsite-share-btn"
                        >
                            <Share2 className="h-4 w-4 mr-1.5" />
                            Compartir
                        </Button>
                        <Button
                            variant="outline"
                            asChild
                            data-testid="dash-microsite-view-btn"
                        >
                            <Link to={previewMicrositePath(organizer.slug)} target="_blank">
                                <ExternalLink className="h-4 w-4 mr-1.5" />
                                Ver público
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <section className="grid md:grid-cols-3 gap-4">
                    <FuturePlaceholder
                        icon={<Sparkles className="h-5 w-5" />}
                        title="Crear evento"
                        desc="Disponible cuando tu cuenta esté aprobada."
                        testid="dash-future-event"
                    />
                    <FuturePlaceholder
                        icon={<Globe className="h-5 w-5" />}
                        title="Editar microsite"
                        desc="Disponible cuando tu cuenta esté aprobada."
                        testid="dash-future-site"
                    />
                    <FuturePlaceholder
                        icon={<MessageCircle className="h-5 w-5" />}
                        title="Reportes"
                        desc="Disponible cuando vendas tu primer ticket."
                        testid="dash-future-reports"
                    />
                </section>
            )}

            {organizer.admin_comments?.length > 0 && (
                <Card data-testid="comments-card" className="border-border/70">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <MessageCircle className="h-5 w-5 text-primary" />
                            Comentarios del equipo
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {organizer.admin_comments
                            .slice()
                            .reverse()
                            .map((c) => (
                                <div
                                    key={c.id}
                                    data-testid={`comment-${c.id}`}
                                    className="rounded-lg border border-border/70 p-3 text-sm space-y-1"
                                >
                                    <div className="text-xs text-muted-foreground">
                                        {c.admin_email || c.admin_id}
                                    </div>
                                    <div>{c.comment}</div>
                                </div>
                            ))}
                    </CardContent>
                </Card>
            )}

            <p className="text-xs text-muted-foreground">
                <Link to="/configuracion" className="text-primary hover:underline">
                    Editá tu perfil
                </Link>{" "}
                · El slug es inmutable.
            </p>

            <ShareModal
                open={shareOpen}
                onOpenChange={setShareOpen}
                url={micrositePublicUrl}
                companyName={organizer.company_name}
                heroSubtitle=""
            />
        </div>
    );
}

function StatusCard({ organizer }) {
    if (organizer.status === "approved") {
        return (
            <Card data-testid="status-approved" className="border-emerald-200 bg-emerald-50/50">
                <CardHeader className="flex flex-row items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                        <CardTitle className="text-lg text-emerald-900">
                            Tu cuenta está aprobada
                        </CardTitle>
                        <CardDescription className="text-emerald-800">
                            Tu microsite estará disponible en{" "}
                            <code
                                className="bg-emerald-100 px-1.5 py-0.5 rounded font-mono"
                                data-testid="approved-public-host"
                            >
                                {publicMicrositeHost(organizer.slug)}
                            </code>
                        </CardDescription>
                        <p className="text-xs text-emerald-700/80">
                            Próximamente disponible en producción. Mientras tanto, accedé desde el preview en{" "}
                            <Link
                                to={previewMicrositePath(organizer.slug)}
                                className="underline font-medium"
                                data-testid="approved-preview-link"
                            >
                                /o/{organizer.slug}
                            </Link>
                            .
                        </p>
                    </div>
                </CardHeader>
            </Card>
        );
    }
    if (organizer.status === "rejected") {
        return (
            <Card data-testid="status-rejected" className="border-red-200 bg-red-50/50">
                <CardHeader className="flex flex-row items-start gap-3">
                    <AlertTriangle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
                    <div className="space-y-2">
                        <CardTitle className="text-lg text-red-900">
                            Tu cuenta fue rechazada
                        </CardTitle>
                        <CardDescription className="text-red-800">
                            <strong>Motivo:</strong>{" "}
                            <span data-testid="reject-reason">
                                {organizer.rejection_reason || "Sin detalle"}
                            </span>
                        </CardDescription>
                        <Button asChild variant="outline" size="sm" data-testid="reject-fix-btn">
                            <Link to="/onboarding">Editar documentos</Link>
                        </Button>
                    </div>
                </CardHeader>
            </Card>
        );
    }
    if (organizer.status === "suspended") {
        return (
            <Card data-testid="status-suspended" className="border-amber-200 bg-amber-50/50">
                <CardHeader className="flex flex-row items-start gap-3">
                    <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <CardTitle className="text-lg text-amber-900">
                            Tu cuenta está suspendida
                        </CardTitle>
                        <CardDescription className="text-amber-800">
                            Contactá a soporte para reactivarla. Revisá los comentarios del equipo abajo.
                        </CardDescription>
                    </div>
                </CardHeader>
            </Card>
        );
    }
    return (
        <Card data-testid="status-pending" className="border-amber-200 bg-amber-50/50">
            <CardHeader className="flex flex-row items-start gap-3">
                <Clock className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                <div>
                    <CardTitle className="text-lg text-amber-900">
                        En revisión por el equipo TYS
                    </CardTitle>
                    <CardDescription className="text-amber-800">
                        Documentos y suscripción recibidos. Te aprobamos pronto.
                    </CardDescription>
                </div>
            </CardHeader>
        </Card>
    );
}

function QuickCard({ icon, title, value, sub, testid }) {
    return (
        <Card className="border-border/70" data-testid={testid}>
            <CardContent className="pt-6 space-y-2">
                <div className="h-10 w-10 rounded-lg bg-secondary text-primary grid place-items-center">
                    {icon}
                </div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {title}
                </div>
                <div className="text-xl font-semibold capitalize break-all">{value}</div>
                <div className="text-xs text-muted-foreground">{sub}</div>
            </CardContent>
        </Card>
    );
}

function FuturePlaceholder({ icon, title, desc, testid }) {
    return (
        <Card className="border-dashed border-border/70 bg-muted/30" data-testid={testid}>
            <CardContent className="pt-6 space-y-2 opacity-70">
                <div className="h-10 w-10 rounded-lg bg-background grid place-items-center text-muted-foreground">
                    {icon}
                </div>
                <div className="font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
            </CardContent>
        </Card>
    );
}
