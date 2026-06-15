/**
 * /app/venues — list page (rewrite of placeholder).
 * Shows venues for the current organizer, with type + status + capacity.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, MapPin, Copy, Trash2, Archive, ExternalLink, Pencil, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { venuesApi, VENUE_TYPES, STATUS_LABEL } from "@/lib/venues";
import VenueTemplatePicker from "@/components/venues/VenueTemplatePicker";

export default function Venues() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const returnTo = searchParams.get("return_to");
    const [items, setItems] = useState([]);
    const [maxV, setMaxV] = useState(5);
    const [activeCount, setActiveCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("all");
    const [typeFilter, setTypeFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [showNew, setShowNew] = useState(false);
    const [createMode, setCreateMode] = useState("template"); // template | blank
    const [newName, setNewName] = useState("");
    const [newType, setNewType] = useState("theater");
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(true);
    const [usingTemplate, setUsingTemplate] = useState(null);

    const reload = async () => {
        setLoading(true);
        try {
            const data = await venuesApi.list();
            setItems(data.items);
            setMaxV(data.max_venues);
            setActiveCount(data.active_count);
        } catch (e) {
            toast.error("No pudimos cargar tus venues.");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { reload(); }, []);

    useEffect(() => {
        if (searchParams.get("create") === "1" || returnTo) {
            setCreateMode("template");
            setShowNew(true);
        }
    }, [searchParams, returnTo]);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setTemplatesLoading(true);
            try {
                const data = await venuesApi.listTemplates();
                if (mounted) setTemplates(data.items || []);
            } catch {
                if (mounted) setTemplates([]);
            } finally {
                if (mounted) setTemplatesLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, []);

    const filtered = items.filter((v) => {
        if (statusFilter !== "all" && v.status !== statusFilter) return false;
        if (typeFilter !== "all" && v.type !== typeFilter) return false;
        if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const canCreate = maxV === -1 || activeCount < maxV;

    const editorUrl = (venueId) => {
        const base = `/app/venues/${venueId}/editor`;
        return returnTo ? `${base}?return_to=${encodeURIComponent(returnTo)}` : base;
    };

    const handleCreate = async () => {
        if (!newName.trim()) return;
        try {
            const v = await venuesApi.create({ name: newName, type: newType });
            toast.success("Venue creado");
            navigate(editorUrl(v.id));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error al crear venue");
        }
    };

    const openCreateDialog = (mode = "template") => {
        setCreateMode(mode);
        setNewName("");
        setNewType("theater");
        setShowNew(true);
    };

    const closeCreateDialog = () => {
        setShowNew(false);
        setCreateMode("template");
        setNewName("");
    };

    const handleDuplicate = async (v) => {
        try {
            await venuesApi.duplicate(v.id);
            toast.success("Venue duplicado");
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error al duplicar");
        }
    };

    const handleArchive = async (v) => {
        try {
            await venuesApi.archive(v.id);
            toast.success("Venue archivado");
            reload();
        } catch (e) {
            toast.error("No se pudo archivar");
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        try {
            await venuesApi.remove(confirmDelete.id);
            toast.success("Venue eliminado");
            setConfirmDelete(null);
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo eliminar");
            setConfirmDelete(null);
        }
    };

    const handleUseTemplate = async (tpl) => {
        if (!canCreate) {
            toast.error(`Tu plan permite hasta ${maxV} venue(s). Archivá uno para usar una plantilla.`);
            return;
        }
        setUsingTemplate(tpl.id);
        try {
            const v = await venuesApi.fromTemplate(tpl.id);
            toast.success("Venue creado desde plantilla");
            navigate(editorUrl(v.id));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo usar la plantilla");
        } finally {
            setUsingTemplate(null);
        }
    };

    const typeLabel = (value) => VENUE_TYPES.find((t) => t.value === value)?.label || value;

    return (
        <div className="space-y-6" data-testid="venues-list-page">
            <header className="flex flex-wrap items-end gap-3 justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Venues</h1>
                    <p className="text-sm text-muted-foreground">
                        Elegí una plantilla y publicá — o personalizá el mapa en el editor avanzado.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground" data-testid="venues-quota">
                        {activeCount} de {maxV === -1 ? "ilimitado" : maxV} venues
                    </span>
                    <Button
                        onClick={() => openCreateDialog("template")}
                        disabled={!canCreate}
                        data-testid="venues-create-btn"
                        title={!canCreate ? `Llegaste al límite de ${maxV} venues de tu plan` : ""}
                    >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Nuevo venue
                    </Button>
                </div>
            </header>

            {returnTo && (
                <Card className="border-indigo-200 bg-indigo-50/50">
                    <CardContent className="py-3 text-sm text-indigo-900">
                        Estás creando un venue para tu evento. Elegí una plantilla, ajustá precios si
                        querés y <strong>publicá</strong> — te llevamos de vuelta al evento automáticamente.
                    </CardContent>
                </Card>
            )}

            {(templatesLoading || templates.length > 0) && (
                <section className="space-y-3" data-testid="venue-templates-section">
                    <div>
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <LayoutTemplate className="h-5 w-5 text-indigo-600" />
                            Plantillas de la plataforma
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Empezá con un layout prediseñado y personalizalo a tu gusto.
                        </p>
                    </div>
                    {templatesLoading ? (
                        <p className="text-sm text-muted-foreground">Cargando plantillas…</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {templates.map((tpl) => (
                                <Card key={tpl.id} className="border-dashed border-indigo-200 bg-indigo-50/30">
                                    <CardContent className="pt-4 space-y-3">
                                        <div className="flex items-start gap-3">
                                            <div className="h-10 w-10 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center shrink-0">
                                                <LayoutTemplate className="h-5 w-5" />
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="font-medium truncate">{tpl.name}</h3>
                                                <p className="text-xs text-muted-foreground">
                                                    {typeLabel(tpl.type)} · {tpl.capacity_calculated || 0} asientos
                                                </p>
                                            </div>
                                        </div>
                                        {tpl.description && (
                                            <p className="text-xs text-muted-foreground line-clamp-2">{tpl.description}</p>
                                        )}
                                        <Button
                                            size="sm"
                                            className="w-full"
                                            disabled={!canCreate || usingTemplate === tpl.id}
                                            onClick={() => handleUseTemplate(tpl)}
                                            data-testid={`use-template-${tpl.slug}`}
                                        >
                                            {usingTemplate === tpl.id ? "Creando…" : "Usar plantilla"}
                                        </Button>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </section>
            )}

            <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nombre"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8"
                        data-testid="venues-search"
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos los estados</SelectItem>
                        <SelectItem value="draft">Borrador</SelectItem>
                        <SelectItem value="published">Publicado</SelectItem>
                        <SelectItem value="archived">Archivado</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos los tipos</SelectItem>
                        {VENUE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {loading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : filtered.length === 0 ? (
                <Card>
                    <CardContent className="py-16 text-center space-y-3">
                        <MapPin className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                            {items.length === 0
                                ? "Elegí una plantilla arriba o creá un venue nuevo — en minutos podés vincularlo a un evento."
                                : "Sin venues que coincidan con los filtros."}
                        </p>
                        {items.length === 0 && (
                            <Button onClick={() => openCreateDialog("template")} disabled={!canCreate}>
                                <LayoutTemplate className="h-4 w-4 mr-1.5" />
                                Elegir plantilla
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filtered.map((v) => (
                        <Card key={v.id} className="overflow-hidden" data-testid={`venue-card-${v.slug}`}>
                            <div className="h-32 bg-gradient-to-br from-indigo-50 to-slate-100 flex items-center justify-center text-slate-400 relative">
                                <MapPin className="h-12 w-12" />
                                <Badge
                                    variant="secondary"
                                    className="absolute top-2 right-2 capitalize"
                                >
                                    {STATUS_LABEL[v.status] || v.status}
                                </Badge>
                            </div>
                            <CardContent className="pt-3 space-y-2">
                                <div>
                                    <h3 className="font-semibold truncate">{v.name}</h3>
                                    <p className="text-xs text-muted-foreground">
                                        {VENUE_TYPES.find((t) => t.value === v.type)?.label || v.type}
                                        {" · "}
                                        {v.capacity_calculated} cap.
                                    </p>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {v.events_count > 0
                                        ? `${v.events_count} evento${v.events_count > 1 ? "s" : ""} vinculados`
                                        : "Sin eventos vinculados"}
                                </p>
                                <div className="flex gap-1.5 flex-wrap pt-1">
                                    <Button
                                        asChild
                                        size="sm"
                                        variant="default"
                                        data-testid={`venue-edit-${v.slug}`}
                                    >
                                        <Link to={`/app/venues/${v.id}/editor`}>
                                            <Pencil className="h-3.5 w-3.5 mr-1" />
                                            Editor
                                        </Link>
                                    </Button>
                                    {v.status === "published" && (
                                        <Button asChild size="sm" variant="outline">
                                            <a
                                                href={`/o/${v.tenant_slug}/venues/${v.slug}/preview`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                                Preview
                                            </a>
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleDuplicate(v)}
                                        disabled={!canCreate}
                                    >
                                        <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                    {v.status !== "archived" && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleArchive(v)}
                                        >
                                            <Archive className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setConfirmDelete(v)}
                                        className="text-red-600 hover:bg-red-50"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Create dialog — plantilla primero */}
            <Dialog open={showNew} onOpenChange={(o) => !o && closeCreateDialog()}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {createMode === "template" ? "Nuevo venue desde plantilla" : "Venue en blanco"}
                        </DialogTitle>
                    </DialogHeader>

                    {createMode === "template" ? (
                        <VenueTemplatePicker
                            templates={templates}
                            loading={templatesLoading}
                            usingId={usingTemplate}
                            disabled={!canCreate}
                            onUseTemplate={(tpl) => {
                                closeCreateDialog();
                                handleUseTemplate(tpl);
                            }}
                            onStartBlank={() => setCreateMode("blank")}
                        />
                    ) : (
                        <div className="space-y-3 py-2">
                            <p className="text-sm text-muted-foreground">
                                Canvas vacío para diseñar a mano. Recomendado si ya conocés el editor.
                            </p>
                            <div className="space-y-1">
                                <Label>Nombre</Label>
                                <Input
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="Teatro Nacional Sucre"
                                    autoFocus
                                    data-testid="venue-new-name"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label>Tipo</Label>
                                <Select value={newType} onValueChange={setNewType}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {VENUE_TYPES.map((t) => (
                                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter className="pt-2 sm:justify-between gap-2">
                                <Button type="button" variant="ghost" onClick={() => setCreateMode("template")}>
                                    ← Volver a plantillas
                                </Button>
                                <div className="flex gap-2">
                                    <Button variant="ghost" onClick={closeCreateDialog}>Cancelar</Button>
                                    <Button
                                        onClick={() => {
                                            handleCreate();
                                            closeCreateDialog();
                                        }}
                                        disabled={!newName.trim()}
                                        data-testid="venue-new-submit"
                                    >
                                        Crear canvas vacío
                                    </Button>
                                </div>
                            </DialogFooter>
                        </div>
                    )}

                    {createMode === "template" && (
                        <DialogFooter>
                            <Button variant="ghost" onClick={closeCreateDialog}>Cancelar</Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete confirmation */}
            <AlertDialog
                open={!!confirmDelete}
                onOpenChange={(o) => !o && setConfirmDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar venue?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. Si el venue está vinculado a
                            algún evento, no podrá eliminarse.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={handleDelete}
                        >
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
