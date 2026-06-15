import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Plus,
    Pencil,
    Trash2,
    CalendarRange,
    Loader2,
    AlertCircle,
    MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import { isoToLocalInput, localInputToIso } from "@/lib/events";

interface EventFunction {
    id: string;
    name: string;
    description?: string;
    starts_at?: string;
    ends_at?: string;
    venue_name?: string;
    venue_address?: string;
    venue_city?: string;
    capacity?: number;
    sort_order: number;
    status: string;
    tickets_sold?: number;
}

interface Props {
    eventId: string | null;
}

const BLANK = {
    name: "",
    description: "",
    starts_at: "",
    ends_at: "",
    venue_name: "",
    venue_address: "",
    venue_city: "",
    venue_country: "",
    capacity: "" as string | number,
    sort_order: 0,
};

function fmtDate(iso?: string): string {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("es", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

export default function EventFunctionsPanel({ eventId }: Props) {
    const [functions, setFunctions] = useState<EventFunction[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<EventFunction | null>(null);
    const [form, setForm] = useState<typeof BLANK>({ ...BLANK });
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const load = async () => {
        if (!eventId) return;
        setLoading(true);
        try {
            const r = await api.get(`/events/me/${eventId}/functions`);
            setFunctions(r.data || []);
        } catch {
            toast.error("No se pudieron cargar las funciones");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [eventId]);

    const openCreate = () => {
        setEditing(null);
        setForm({ ...BLANK });
        setOpen(true);
    };

    const openEdit = (fn: EventFunction) => {
        setEditing(fn);
        setForm({
            name: fn.name,
            description: fn.description || "",
            starts_at: fn.starts_at ? isoToLocalInput(fn.starts_at) : "",
            ends_at: fn.ends_at ? isoToLocalInput(fn.ends_at) : "",
            venue_name: fn.venue_name || "",
            venue_address: fn.venue_address || "",
            venue_city: fn.venue_city || "",
            venue_country: "",
            capacity: fn.capacity ?? "",
            sort_order: fn.sort_order,
        });
        setOpen(true);
    };

    const upd = (key: string, val: unknown) =>
        setForm((prev) => ({ ...prev, [key]: val }));

    const handleSave = async () => {
        if (!eventId) return;
        if (!form.name.trim()) {
            toast.error("El nombre de la función es requerido");
            return;
        }
        setSaving(true);
        const payload = {
            ...form,
            starts_at: form.starts_at ? localInputToIso(form.starts_at as string) : null,
            ends_at: form.ends_at ? localInputToIso(form.ends_at as string) : null,
            capacity: form.capacity !== "" ? Number(form.capacity) : null,
            venue_name: form.venue_name || null,
            venue_address: form.venue_address || null,
            venue_city: form.venue_city || null,
            venue_country: form.venue_country || null,
        };
        try {
            if (editing) {
                await api.put(`/events/me/${eventId}/functions/${editing.id}`, payload);
                toast.success("Función actualizada");
            } else {
                await api.post(`/events/me/${eventId}/functions`, payload);
                toast.success("Función creada");
            }
            setOpen(false);
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al guardar");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (fn: EventFunction) => {
        if (!eventId) return;
        if ((fn.tickets_sold ?? 0) > 0) {
            toast.error("No se puede eliminar: ya hay tickets vendidos para esta función.");
            return;
        }
        if (!confirm(`¿Eliminar la función "${fn.name}"?`)) return;
        setDeleting(fn.id);
        try {
            await api.delete(`/events/me/${eventId}/functions/${fn.id}`);
            toast.success("Función eliminada");
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al eliminar");
        } finally {
            setDeleting(null);
        }
    };

    if (!eventId) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground p-6 rounded-xl border">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="text-sm">
                    Guarda primero la información general del evento para gestionar las funciones.
                </span>
            </div>
        );
    }

    return (
        <div className="space-y-4" data-testid="section-functions">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold">Funciones del evento</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Agrega múltiples fechas o funciones. Cada una puede tener su propio venue,
                        horario y aforo.
                    </p>
                </div>
                <Button size="sm" onClick={openCreate} data-testid="add-function">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Agregar función
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : functions.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                    <CalendarRange className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Aún no hay funciones.</p>
                    <p className="text-xs mt-1">
                        Si el evento tiene una sola fecha, no necesitas agregar funciones.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {functions.map((fn) => (
                        <FunctionRow
                            key={fn.id}
                            fn={fn}
                            onEdit={() => openEdit(fn)}
                            onDelete={() => handleDelete(fn)}
                            deleting={deleting === fn.id}
                        />
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? "Editar función" : "Nueva función"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* Name */}
                        <div className="space-y-1.5">
                            <Label>Nombre *</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => upd("name", e.target.value)}
                                placeholder="Función 1 — Sábado 14 de junio"
                                data-testid="fn-name"
                            />
                        </div>

                        {/* Description */}
                        <div className="space-y-1.5">
                            <Label>Descripción</Label>
                            <Textarea
                                value={form.description}
                                onChange={(e) => upd("description", e.target.value)}
                                rows={2}
                                placeholder="Detalles adicionales de esta función…"
                            />
                        </div>

                        {/* Date range */}
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Inicio</Label>
                                <Input
                                    type="datetime-local"
                                    value={form.starts_at as string}
                                    onChange={(e) => upd("starts_at", e.target.value)}
                                    data-testid="fn-starts"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Fin</Label>
                                <Input
                                    type="datetime-local"
                                    value={form.ends_at as string}
                                    onChange={(e) => upd("ends_at", e.target.value)}
                                    data-testid="fn-ends"
                                />
                            </div>
                        </div>

                        {/* Venue */}
                        <div className="space-y-3 rounded-lg border p-4">
                            <p className="text-sm font-medium">Lugar de esta función</p>
                            <p className="text-xs text-muted-foreground -mt-2">
                                Opcional. Si es diferente al venue principal del evento.
                            </p>
                            <div className="space-y-1.5">
                                <Label>Nombre del lugar</Label>
                                <Input
                                    value={form.venue_name}
                                    onChange={(e) => upd("venue_name", e.target.value)}
                                    placeholder="Teatro Sucre"
                                />
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Dirección</Label>
                                    <Input
                                        value={form.venue_address}
                                        onChange={(e) => upd("venue_address", e.target.value)}
                                        placeholder="Calle Manabí N8-131"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Ciudad</Label>
                                    <Input
                                        value={form.venue_city}
                                        onChange={(e) => upd("venue_city", e.target.value)}
                                        placeholder="Quito"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Capacity */}
                        <div className="space-y-1.5">
                            <Label>Aforo de esta función</Label>
                            <Input
                                type="number"
                                min="1"
                                value={form.capacity}
                                onChange={(e) => upd("capacity", e.target.value)}
                                placeholder="Usa el aforo del evento"
                            />
                        </div>

                        {/* Sort */}
                        <div className="space-y-1.5">
                            <Label>Orden de aparición</Label>
                            <Input
                                type="number"
                                min="0"
                                value={form.sort_order}
                                onChange={(e) =>
                                    upd("sort_order", parseInt(e.target.value || "0", 10))
                                }
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} disabled={saving} data-testid="fn-save">
                            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            {editing ? "Guardar cambios" : "Crear función"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function FunctionRow({
    fn,
    onEdit,
    onDelete,
    deleting,
}: {
    fn: EventFunction;
    onEdit: () => void;
    onDelete: () => void;
    deleting: boolean;
}) {
    const statusColor =
        fn.status === "active"
            ? "default"
            : fn.status === "cancelled"
              ? "destructive"
              : "secondary";

    return (
        <div className="flex items-center gap-3 rounded-lg border p-3 bg-card">
            <CalendarRange className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{fn.name}</span>
                    <Badge variant={statusColor as any} className="text-xs capitalize">
                        {fn.status}
                    </Badge>
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                        {fmtDate(fn.starts_at)}
                        {fn.ends_at ? ` → ${fmtDate(fn.ends_at)}` : ""}
                    </span>
                    {fn.venue_name && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                            <MapPin className="h-3 w-3" />
                            {fn.venue_name}
                            {fn.venue_city ? `, ${fn.venue_city}` : ""}
                        </span>
                    )}
                    {fn.capacity && (
                        <span className="text-xs text-muted-foreground">
                            Cap. {fn.capacity}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={onEdit}
                    data-testid={`fn-edit-${fn.id}`}
                >
                    <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={onDelete}
                    disabled={deleting}
                    data-testid={`fn-delete-${fn.id}`}
                >
                    {deleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                    )}
                </Button>
            </div>
        </div>
    );
}
