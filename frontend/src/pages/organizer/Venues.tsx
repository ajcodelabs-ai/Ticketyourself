/**
 * /app/venues — list + create dialog for organizer venues.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
    Plus, Search, MapPin, Copy, Trash2, Archive, ExternalLink, Pencil, LayoutTemplate, Info, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import VenueTemplateThumb from "@/components/venues/VenueTemplateThumb";
import { PlanGateHint } from "@/components/plans/PlanGate";

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
    const [createMode, setCreateMode] = useState("template"); // template | blank | name-from-template
    const [newName, setNewName] = useState("");
    const [newType, setNewType] = useState("theater");
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(true);
    const [usingTemplate, setUsingTemplate] = useState(null);
    const [pendingTemplate, setPendingTemplate] = useState(null);
    const [previewTpl, setPreviewTpl] = useState(null);

    const reload = async () => {
        setLoading(true);
        try {
            const data = await venuesApi.list();
            setItems(data.items);
            setMaxV(data.max_venues);
            setActiveCount(data.active_count);
        } catch {
            toast.error("No pudimos cargar tus escenarios.");
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
    const limitReason = !canCreate
        ? `Llegaste al límite de ${maxV} escenario(s) de tu plan. Archivá uno para crear otro.`
        : null;

    const editorUrl = (venueId, extraParams = {}) => {
        const base = `/app/venues/${venueId}/editor`;
        const params = new URLSearchParams(extraParams);
        if (returnTo) params.set("return_to", returnTo);
        const qs = params.toString();
        return qs ? `${base}?${qs}` : base;
    };

    const handleCreate = async () => {
        if (!newName.trim()) return;
        try {
            const v = await venuesApi.create({ name: newName, type: newType });
            toast.success("Escenario creado");
            navigate(editorUrl(v.id, { blank: "1" }));
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error al crear escenario");
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
        setPendingTemplate(null);
    };

    const promptTemplateName = (tpl) => {
        if (!canCreate) {
            toast.error(`Tu plan permite hasta ${maxV} escenario(s). Archivá uno para usar una plantilla.`);
            return;
        }
        setPendingTemplate(tpl);
        setNewName(`${tpl.name} (copia)`);
        setCreateMode("name-from-template");
        setShowNew(true);
    };

    const handleDuplicate = async (v) => {
        try {
            await venuesApi.duplicate(v.id);
            toast.success("Escenario duplicado");
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error al duplicar");
        }
    };

    const handleArchive = async (v) => {
        try {
            await venuesApi.archive(v.id);
            toast.success("Escenario archivado");
            reload();
        } catch {
            toast.error("No se pudo archivar");
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        try {
            await venuesApi.remove(confirmDelete.id);
            toast.success("Escenario eliminado");
            setConfirmDelete(null);
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo eliminar");
            setConfirmDelete(null);
        }
    };

    const handleUseTemplate = async () => {
        if (!pendingTemplate || !newName.trim()) return;
        if (!canCreate) {
            toast.error(`Tu plan permite hasta ${maxV} escenario(s). Archivá uno para usar una plantilla.`);
            return;
        }
        setUsingTemplate(pendingTemplate.id);
        try {
            const v = await venuesApi.fromTemplate(pendingTemplate.id, {
                name: newName.trim(),
            });
            toast.success("Escenario creado desde plantilla");
            closeCreateDialog();
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
                    <h1 className="text-2xl font-bold">Escenarios</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Mapas (solo la forma) para tus eventos.
                        {" · "}
                        <strong className="text-foreground" data-testid="venues-quota">
                            {activeCount} de {maxV === -1 ? "∞" : maxV}
                        </strong>
                        {" activos"}
                    </p>
                </div>
                <Button
                    onClick={() => openCreateDialog("template")}
                    disabled={!canCreate}
                    data-testid="venues-create-btn"
                    title={!canCreate ? `Llegaste al límite de ${maxV} escenarios de tu plan` : ""}
                >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Nuevo escenario
                </Button>
            </header>

            {!canCreate && (
                <PlanGateHint feature="max_venues">
                    Llegaste al límite de {maxV} escenario(s) de tu plan. Archivá uno o mejorá el plan para crear más.
                </PlanGateHint>
            )}

            {returnTo && (
                <div className="rounded-xl border bg-card p-4 flex items-start gap-3 text-sm">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-muted-foreground">
                        Estás creando un escenario para tu evento. Elegí una plantilla o empezá en blanco,
                        diseñá el mapa y <strong className="text-foreground">publicá</strong> —
                        te llevamos de vuelta al evento.
                    </p>
                </div>
            )}

            {(templatesLoading || templates.length > 0) && (
                <section className="space-y-3" data-testid="venue-templates-section">
                    <div>
                        <h2 className="text-sm font-medium flex items-center gap-2">
                            <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
                            1. Plantillas de la plataforma
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Empezá con un layout prediseñado y personalizalo.
                        </p>
                    </div>
                    {!canCreate && (
                        <div data-testid="venue-templates-limit-reason">
                            <PlanGateHint feature="max_venues">{limitReason}</PlanGateHint>
                        </div>
                    )}
                    {templatesLoading ? (
                        <p className="text-sm text-muted-foreground">Cargando plantillas…</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {templates.map((tpl) => (
                                <div key={tpl.id} className="rounded-xl border bg-card p-4 space-y-3">
                                    <VenueTemplateThumb template={tpl} height={130} />
                                    <div className="flex items-start gap-3">
                                        <div className="h-10 w-10 rounded-lg bg-secondary text-muted-foreground grid place-items-center shrink-0">
                                            <LayoutTemplate className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-medium truncate text-sm">{tpl.name}</h3>
                                            <p className="text-xs text-muted-foreground">
                                                {typeLabel(tpl.type)} · {tpl.capacity_calculated || 0} asientos
                                            </p>
                                        </div>
                                    </div>
                                    {tpl.description && (
                                        <p className="text-xs text-muted-foreground line-clamp-2">{tpl.description}</p>
                                    )}
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="flex-none"
                                            onClick={() => setPreviewTpl(tpl)}
                                            data-testid={`preview-tpl-${tpl.slug}`}
                                            title="Previsualizar plantilla"
                                        >
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="flex-1"
                                            disabled={!canCreate || usingTemplate === tpl.id}
                                            onClick={() => promptTemplateName(tpl)}
                                            data-testid={`use-template-${tpl.slug}`}
                                        >
                                            {usingTemplate === tpl.id ? "Creando…" : "Usar plantilla"}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            <section className="space-y-3">
                <div>
                    <h2 className="text-sm font-medium">2. Tus escenarios</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Abrí el diseñador para editar la forma del mapa.
                    </p>
                </div>

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
                    <div className="rounded-xl border border-dashed bg-card py-14 text-center space-y-3">
                        <MapPin className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                            {items.length === 0
                                ? "Todavía no tenés escenarios. Usá una plantilla o creá uno nuevo para vincularlo a un evento."
                                : "Sin escenarios que coincidan con los filtros."}
                        </p>
                        {items.length === 0 && (
                            <Button onClick={() => openCreateDialog("template")} disabled={!canCreate}>
                                <Plus className="h-4 w-4 mr-1.5" />
                                Nuevo escenario
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filtered.map((v) => (
                            <div
                                key={v.id}
                                className="rounded-xl border bg-card overflow-hidden"
                                data-testid={`venue-card-${v.slug}`}
                            >
                                <div className="h-28 bg-secondary/50 flex items-center justify-center text-muted-foreground relative border-b">
                                    <MapPin className="h-10 w-10 opacity-40" />
                                    <Badge
                                        variant="secondary"
                                        className="absolute top-2 right-2 capitalize text-[10px] font-normal"
                                    >
                                        {STATUS_LABEL[v.status] || v.status}
                                    </Badge>
                                </div>
                                <div className="p-4 space-y-3">
                                    <div>
                                        <h3 className="font-medium truncate">{v.name}</h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {typeLabel(v.type)}
                                            {" · "}
                                            {v.capacity_calculated} cap.
                                            {" · "}
                                            {v.events_count > 0
                                                ? `${v.events_count} evento${v.events_count > 1 ? "s" : ""}`
                                                : "Sin eventos"}
                                        </p>
                                    </div>
                                    <div className="flex gap-1.5 flex-wrap">
                                        <Button
                                            asChild
                                            size="sm"
                                            data-testid={`venue-edit-${v.slug}`}
                                        >
                                            <Link to={`/app/venues/${v.id}/editor`}>
                                                <Pencil className="h-3.5 w-3.5 mr-1" />
                                                Diseñar
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
                                            title="Duplicar"
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                        {v.status !== "archived" && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleArchive(v)}
                                                title="Archivar"
                                            >
                                                <Archive className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setConfirmDelete(v)}
                                            className="text-red-600 hover:bg-red-50"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <Dialog open={showNew} onOpenChange={(o) => !o && closeCreateDialog()}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Nuevo escenario</DialogTitle>
                    </DialogHeader>

                    {createMode === "template" ? (
                        <>
                            <VenueTemplatePicker
                                templates={templates}
                                loading={templatesLoading}
                                usingId={usingTemplate}
                                disabled={!canCreate}
                                disabledReason={limitReason}
                                onUseTemplate={(tpl) => promptTemplateName(tpl)}
                                onStartBlank={() => setCreateMode("blank")}
                            />
                            <DialogFooter>
                                <Button variant="ghost" onClick={closeCreateDialog}>Cancelar</Button>
                            </DialogFooter>
                        </>
                    ) : createMode === "name-from-template" ? (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Vas a clonar la plantilla{" "}
                                <strong className="text-foreground">
                                    {pendingTemplate?.name}
                                </strong>
                                . Elegí un nombre propio para tu escenario (la plantilla de la
                                plataforma no se modifica).
                            </p>
                            <div className="space-y-1.5">
                                <Label>Nombre del escenario *</Label>
                                <Input
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="Mi teatro principal"
                                    autoFocus
                                    data-testid="venue-template-name"
                                />
                            </div>
                            <DialogFooter className="sm:justify-between gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setPendingTemplate(null);
                                        setCreateMode("template");
                                    }}
                                >
                                    ← Volver
                                </Button>
                                <div className="flex gap-2">
                                    <Button variant="ghost" onClick={closeCreateDialog}>
                                        Cancelar
                                    </Button>
                                    <Button
                                        onClick={handleUseTemplate}
                                        disabled={!newName.trim() || !!usingTemplate}
                                        data-testid="venue-template-submit"
                                    >
                                        {usingTemplate ? "Creando…" : "Crear y diseñar"}
                                    </Button>
                                </div>
                            </DialogFooter>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-xs text-muted-foreground">
                                Canvas vacío para diseñar a mano. Ideal si ya conocés el editor.
                            </p>
                            <div className="rounded-xl border bg-card p-4 space-y-3">
                                <div className="space-y-1.5">
                                    <Label>Nombre *</Label>
                                    <Input
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        placeholder="Teatro Nacional Sucre"
                                        autoFocus
                                        data-testid="venue-new-name"
                                    />
                                </div>
                                <div className="space-y-1.5">
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
                            </div>
                            <DialogFooter className="sm:justify-between gap-2">
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
                                        Crear y diseñar
                                    </Button>
                                </div>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Template preview dialog */}
            <Dialog open={!!previewTpl} onOpenChange={(open) => { if (!open) setPreviewTpl(null); }}>
                <DialogContent className="max-w-3xl w-[95vw]" data-testid="venue-tpl-preview-dialog">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <LayoutTemplate className="h-5 w-5 text-muted-foreground" />
                            {previewTpl?.name || "Plantilla"}
                        </DialogTitle>
                    </DialogHeader>
                    {previewTpl && (
                        <div className="space-y-4">
                            <VenueTemplateThumb template={previewTpl} height={380} />
                            <div className="text-sm text-muted-foreground space-y-1">
                                <p>
                                    <span className="font-medium text-foreground">Tipo:</span>{" "}
                                    {typeLabel(previewTpl.type)}
                                </p>
                                <p>
                                    <span className="font-medium text-foreground">Capacidad:</span>{" "}
                                    {previewTpl.capacity_calculated || 0} asientos
                                </p>
                                {previewTpl.description && (
                                    <p>
                                        <span className="font-medium text-foreground">Descripción:</span>{" "}
                                        {previewTpl.description}
                                    </p>
                                )}
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" onClick={() => setPreviewTpl(null)}>
                                    Cerrar
                                </Button>
                                <Button
                                    disabled={!canCreate}
                                    onClick={() => {
                                        setPreviewTpl(null);
                                        promptTemplateName(previewTpl);
                                    }}
                                    data-testid="venue-tpl-preview-use"
                                >
                                    Usar esta plantilla
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={!!confirmDelete}
                onOpenChange={(o) => !o && setConfirmDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar escenario?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. Si el escenario está vinculado a
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
