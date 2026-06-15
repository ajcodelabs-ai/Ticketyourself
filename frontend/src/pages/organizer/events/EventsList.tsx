/**
 * /eventos — organizer's events list with status filters + search + create CTA.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useEventsList } from "@/hooks/queries/useEvents";
import {
    EVENT_STATUS_META,
    formatEventDate,
    formatPriceLabel,
    eventPublicPath,
} from "@/lib/events";
import { Plus, Search, Calendar, Edit3, ExternalLink, Loader2 } from "lucide-react";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400";

export default function EventsList() {
    const [statusFilter, setStatusFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const navigate = useNavigate();

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(t);
    }, [search]);

    const { data: items = [], isLoading } = useEventsList({
        status: statusFilter,
        search: debouncedSearch,
    });

    const empty = !isLoading && items.length === 0;

    return (
        <div className="space-y-5" data-testid="events-list-page">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Eventos</h1>
                    <p className="text-sm text-muted-foreground">
                        Crear, editar y publicar tus eventos.
                    </p>
                </div>
                <Button
                    onClick={() => navigate("/app/eventos/nuevo")}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    data-testid="events-new-btn"
                >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Crear evento
                </Button>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-44" data-testid="events-status-filter">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="draft">Borradores</SelectItem>
                        <SelectItem value="published">Publicados</SelectItem>
                        <SelectItem value="cancelled">Cancelados</SelectItem>
                        <SelectItem value="ended">Finalizados</SelectItem>
                    </SelectContent>
                </Select>
                <div className="relative flex-1 min-w-[240px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por título…"
                        className="pl-9"
                        data-testid="events-search-input"
                    />
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : empty ? (
                <Card className="border-dashed" data-testid="events-empty">
                    <CardContent className="py-12 text-center space-y-3">
                        <Calendar className="h-10 w-10 mx-auto text-muted-foreground" />
                        <h3 className="text-lg font-semibold">
                            Aún no tenés eventos
                        </h3>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto">
                            Creá tu primer evento — definí fecha, lugar, precio y poster.
                            Cuando esté listo, publicalo y aparecerá en tu microsite público.
                        </p>
                        <Button
                            onClick={() => navigate("/app/eventos/nuevo")}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                            data-testid="events-empty-cta"
                        >
                            <Plus className="h-4 w-4 mr-1.5" />
                            Crear primer evento
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((e) => {
                        const status = EVENT_STATUS_META[e.status] || EVENT_STATUS_META.draft;
                        return (
                            <Card
                                key={e.id}
                                data-testid={`event-row-${e.slug}`}
                                className="overflow-hidden border-border/70"
                            >
                                <div className="aspect-[5/3] relative overflow-hidden bg-muted">
                                    <img
                                        src={
                                            e.poster_url
                                                ? `${import.meta.env.VITE_BACKEND_URL || ""}${e.poster_url}`
                                                : FALLBACK_IMG
                                        }
                                        alt={e.title}
                                        className="w-full h-full object-cover"
                                        onError={(ev) => {
                                            ev.currentTarget.src = FALLBACK_IMG;
                                        }}
                                    />
                                    <Badge
                                        className={`absolute top-2 left-2 ${status.className}`}
                                    >
                                        {status.label}
                                    </Badge>
                                </div>
                                <CardContent className="pt-4 space-y-2">
                                    <h3 className="font-semibold leading-tight line-clamp-2">
                                        {e.title}
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        {formatEventDate(e.starts_at, e.timezone)}
                                    </p>
                                    <p className="text-xs flex items-center justify-between text-muted-foreground">
                                        <span>{formatPriceLabel(e)}</span>
                                        <span>
                                            {e.tickets_sold || 0}
                                            {e.capacity ? ` / ${e.capacity}` : ""} tickets
                                        </span>
                                    </p>
                                    <div className="flex gap-2 pt-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            asChild
                                            className="flex-1"
                                        >
                                            <Link
                                                to={`/app/eventos/${e.id}`}
                                                data-testid={`event-detail-link-${e.slug}`}
                                            >
                                                <Edit3 className="h-3.5 w-3.5 mr-1" />
                                                Gestionar
                                            </Link>
                                        </Button>
                                        {e.status === "published" && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                asChild
                                            >
                                                <Link
                                                    to={eventPublicPath(e.tenant_slug, e.slug)}
                                                    target="_blank"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </Link>
                                            </Button>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
