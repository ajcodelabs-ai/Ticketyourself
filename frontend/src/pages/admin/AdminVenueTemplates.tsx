/**
 * /admin/venue-templates — super-admin list of platform venue templates.
 * Organizers clone these via /app/venues → "Usar plantilla".
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, MapPin, Trash2, Pencil, LayoutTemplate } from "lucide-react";
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
import { adminVenueTemplatesApi, VENUE_TYPES } from "@/lib/venues";
import { formatApiError } from "@/lib/api";

function forbiddenMessage(err) {
    if (err?.response?.status === 403) {
        return "Tu sesión no tiene permisos de super admin. Cerrá sesión e ingresá con admin@ticketyourself.com.";
    }
    return formatApiError(err?.response?.data?.detail) || "Error inesperado";
}

export default function AdminVenueTemplates() {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [showNew, setShowNew] = useState(false);
    const [newName, setNewName] = useState("");
    const [newType, setNewType] = useState("theater");
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [forbidden, setForbidden] = useState(false);

    const reload = async () => {
        setLoading(true);
        try {
            const data = await adminVenueTemplatesApi.list();
            setItems(data.items || []);
            setForbidden(false);
        } catch (e) {
            if (e?.response?.status === 403) {
                setForbidden(true);
                setItems([]);
            }
            toast.error(forbiddenMessage(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { reload(); }, []);

    const filtered = items.filter((v) => {
        if (typeFilter !== "all" && v.type !== typeFilter) return false;
        if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const handleCreate = async () => {
        if (!newName.trim()) return;
        try {
            const v = await adminVenueTemplatesApi.create({ name: newName, type: newType });
            toast.success("Plantilla creada");
            navigate(`/admin/venue-templates/${v.id}/editor`);
        } catch (e) {
            toast.error(forbiddenMessage(e));
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        try {
            await adminVenueTemplatesApi.remove(confirmDelete.id);
            toast.success("Plantilla eliminada");
            setConfirmDelete(null);
            reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo eliminar");
            setConfirmDelete(null);
        }
    };

    const typeLabel = (value) => VENUE_TYPES.find((t) => t.value === value)?.label || value;

    return (
        <div className="space-y-6" data-testid="admin-venue-templates-page">
            <header className="flex flex-wrap items-end gap-3 justify-between">
                <div className="space-y-2">
                    <Badge variant="secondary" className="text-orange-700 bg-orange-100">
                        Admin · Plantillas
                    </Badge>
                    <h1 className="text-2xl font-bold">Plantillas de venues</h1>
                    <p className="text-sm text-muted-foreground max-w-2xl">
                        Diseñá layouts reutilizables que los organizadores pueden clonar al crear sus venues.
                        No cuentan contra el límite de venues del organizador hasta que las usen.
                    </p>
                </div>
                <Button
                    onClick={() => setShowNew(true)}
                    disabled={forbidden}
                    data-testid="admin-template-create-btn"
                >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Nueva plantilla
                </Button>
            </header>

            {forbidden && (
                <Card className="border-amber-200 bg-amber-50/60">
                    <CardContent className="pt-6 space-y-3 text-sm">
                        <p className="font-medium text-amber-900">
                            Estás con una cuenta de organizador, no de super admin.
                        </p>
                        <p className="text-amber-800">
                            Para crear plantillas usá{" "}
                            <span className="font-mono">admin@ticketyourself.com</span> /{" "}
                            <span className="font-mono">Admin123!</span>
                        </p>
                        <Button asChild variant="outline" size="sm">
                            <Link to="/login" state={{ from: { pathname: "/admin/venue-templates" } }}>
                                Ir a iniciar sesión
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            )}

            <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nombre"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8"
                    />
                </div>
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
                        <LayoutTemplate className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                            {items.length === 0
                                ? "Aún no hay plantillas. Creá la primera para que los organizadores la usen."
                                : "Sin plantillas que coincidan con los filtros."}
                        </p>
                        {items.length === 0 && (
                            <Button onClick={() => setShowNew(true)}>
                                <Plus className="h-4 w-4 mr-1.5" />
                                Crear plantilla
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filtered.map((v) => (
                        <Card key={v.id} className="overflow-hidden" data-testid={`admin-template-${v.slug}`}>
                            <div className="h-32 bg-gradient-to-br from-orange-50 to-slate-100 flex items-center justify-center text-slate-400 relative">
                                <LayoutTemplate className="h-12 w-12" />
                                <Badge variant="secondary" className="absolute top-2 right-2">
                                    Plantilla
                                </Badge>
                            </div>
                            <CardContent className="pt-4 space-y-2">
                                <div>
                                    <h3 className="font-semibold truncate">{v.name}</h3>
                                    <p className="text-xs text-muted-foreground">
                                        {typeLabel(v.type)} · {v.capacity_calculated || 0} asientos
                                    </p>
                                </div>
                                {v.description && (
                                    <p className="text-xs text-muted-foreground line-clamp-2">{v.description}</p>
                                )}
                                <div className="flex items-center gap-1 pt-1">
                                    <Button asChild size="sm" variant="default" className="flex-1">
                                        <Link to={`/admin/venue-templates/${v.id}/editor`}>
                                            <Pencil className="h-3.5 w-3.5 mr-1" />
                                            Editar
                                        </Link>
                                    </Button>
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

            <Dialog open={showNew} onOpenChange={setShowNew}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nueva plantilla de venue</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1">
                            <Label>Nombre</Label>
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Teatro clásico 500 asientos"
                                autoFocus
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
                        <Button onClick={handleCreate} disabled={!newName.trim()}>
                            Crear y abrir editor
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar plantilla?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Se eliminará «{confirmDelete?.name}». Los venues ya creados por organizadores no se verán afectados.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
