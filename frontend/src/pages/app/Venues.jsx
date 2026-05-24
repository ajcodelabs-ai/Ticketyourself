/**
 * /app/venues — list page (rewrite of placeholder).
 * Shows venues for the current organizer, with type + status + capacity.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, MapPin, Copy, Trash2, Archive, ExternalLink, Pencil } from "lucide-react";
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

export default function Venues() {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [maxV, setMaxV] = useState(5);
    const [activeCount, setActiveCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("all");
    const [typeFilter, setTypeFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [showNew, setShowNew] = useState(false);
    const [newName, setNewName] = useState("");
    const [newType, setNewType] = useState("theater");
    const [confirmDelete, setConfirmDelete] = useState(null);

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

    const filtered = items.filter((v) => {
        if (statusFilter !== "all" && v.status !== statusFilter) return false;
        if (typeFilter !== "all" && v.type !== typeFilter) return false;
        if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const canCreate = maxV === -1 || activeCount < maxV;

    const handleCreate = async () => {
        if (!newName.trim()) return;
        try {
            const v = await venuesApi.create({ name: newName, type: newType });
            toast.success("Venue creado");
            navigate(`/app/venues/${v.id}/editor`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error al crear venue");
        }
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

    return (
        <div className="space-y-6" data-testid="venues-list-page">
            <header className="flex flex-wrap items-end gap-3 justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Venues</h1>
                    <p className="text-sm text-muted-foreground">
                        Diseñá la disposición de tus espacios — escenarios, zonas, asientos numerados.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground" data-testid="venues-quota">
                        {activeCount} de {maxV === -1 ? "ilimitado" : maxV} venues
                    </span>
                    <Button
                        onClick={() => setShowNew(true)}
                        disabled={!canCreate}
                        data-testid="venues-create-btn"
                        title={!canCreate ? `Llegaste al límite de ${maxV} venues de tu plan` : ""}
                    >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Crear venue
                    </Button>
                </div>
            </header>

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
                                ? "Aún no tenés venues. Creá tu primero para asociarlo a tus eventos."
                                : "Sin venues que coincidan con los filtros."}
                        </p>
                        {items.length === 0 && (
                            <Button onClick={() => setShowNew(true)} disabled={!canCreate}>
                                <Plus className="h-4 w-4 mr-1.5" />
                                Crear mi primer venue
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

            {/* Create dialog */}
            <Dialog open={showNew} onOpenChange={setShowNew}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Crear venue</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
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
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowNew(false)}>Cancelar</Button>
                        <Button
                            onClick={handleCreate}
                            disabled={!newName.trim()}
                            data-testid="venue-new-submit"
                        >
                            Crear y abrir editor
                        </Button>
                    </DialogFooter>
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
