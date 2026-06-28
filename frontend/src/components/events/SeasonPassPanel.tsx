import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Ticket, Loader2, AlertCircle } from "lucide-react";
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

interface SeasonPass {
    id: string;
    name: string;
    description?: string;
    price_cents: number;
    currency: string;
    credits_total: number;
    max_passes?: number | null;
    passes_sold: number;
    redemption_starts_at?: string;
    redemption_ends_at?: string;
    status: string;
}

interface Props {
    eventId: string | null;
    hasVenue?: boolean;
}

const BLANK = {
    name: "",
    description: "",
    price_dollars: "",
    credits_total: "10",
    max_passes: "" as string | number,
    redemption_starts_at: "",
    redemption_ends_at: "",
};

function priceDollars(cents: number): string {
    return (cents / 100).toFixed(2);
}

export default function SeasonPassPanel({ eventId, hasVenue = false }: Props) {
    const [passes, setPasses] = useState<SeasonPass[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<SeasonPass | null>(null);
    const [form, setForm] = useState<typeof BLANK>({ ...BLANK });
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const load = async () => {
        if (!eventId) return;
        setLoading(true);
        try {
            const r = await api.get(`/events/me/${eventId}/season-passes`);
            setPasses(r.data || []);
        } catch {
            toast.error("No se pudieron cargar los abonos");
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

    const openEdit = (p: SeasonPass) => {
        setEditing(p);
        setForm({
            name: p.name,
            description: p.description || "",
            price_dollars: priceDollars(p.price_cents),
            credits_total: String(p.credits_total),
            max_passes: p.max_passes ?? "",
            redemption_starts_at: p.redemption_starts_at ? isoToLocalInput(p.redemption_starts_at) : "",
            redemption_ends_at: p.redemption_ends_at ? isoToLocalInput(p.redemption_ends_at) : "",
        });
        setOpen(true);
    };

    const upd = (key: string, val: unknown) => setForm((prev) => ({ ...prev, [key]: val }));

    const handleSave = async () => {
        if (!eventId) return;
        if (!form.name.trim()) {
            toast.error("El nombre del abono es requerido");
            return;
        }
        if (!form.credits_total || parseInt(form.credits_total, 10) < 1) {
            toast.error("La cantidad de créditos debe ser al menos 1");
            return;
        }
        setSaving(true);
        const payload = {
            name: form.name,
            description: form.description || null,
            price_cents: Math.round(parseFloat(form.price_dollars || "0") * 100),
            credits_total: parseInt(form.credits_total, 10),
            max_passes: form.max_passes !== "" ? Number(form.max_passes) : null,
            redemption_starts_at: form.redemption_starts_at
                ? localInputToIso(form.redemption_starts_at as string) : null,
            redemption_ends_at: form.redemption_ends_at
                ? localInputToIso(form.redemption_ends_at as string) : null,
        };
        try {
            if (editing) {
                await api.put(`/events/me/${eventId}/season-passes/${editing.id}`, payload);
                toast.success("Abono actualizado");
            } else {
                await api.post(`/events/me/${eventId}/season-passes`, payload);
                toast.success("Abono creado");
            }
            setOpen(false);
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al guardar");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (p: SeasonPass) => {
        if (!eventId) return;
        if (p.passes_sold > 0) {
            toast.error("No se puede eliminar: ya hay abonos vendidos.");
            return;
        }
        if (!confirm(`¿Eliminar el abono "${p.name}"?`)) return;
        setDeleting(p.id);
        try {
            await api.delete(`/events/me/${eventId}/season-passes/${p.id}`);
            toast.success("Abono eliminado");
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
                    Guarda primero la información general del evento para configurar el abono.
                </span>
            </div>
        );
    }

    return (
        <div className="space-y-4" data-testid="section-season-passes">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold">Abono de Temporada</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        El comprador paga una vez por varios créditos y elige más adelante a
                        cuáles funciones de este evento asistir — no bloquea aforo hasta que
                        redime cada crédito.
                    </p>
                </div>
                <Button size="sm" onClick={openCreate} data-testid="add-season-pass" disabled={hasVenue}>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Agregar abono
                </Button>
            </div>

            {hasVenue && (
                <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    El abono de temporada solo está disponible para eventos de admisión
                    general (sin venue con asientos numerados).
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : passes.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                    <Ticket className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Aún no hay abonos configurados.</p>
                    <p className="text-xs mt-1">
                        Creá uno si querés ofrecer un paquete de créditos para varias funciones.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {passes.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3 bg-card">
                            <Ticket className="h-5 w-5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-sm">{p.name}</span>
                                    <Badge variant={p.status === "active" ? "default" : "secondary"} className="text-xs capitalize">
                                        {p.status}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-muted-foreground">
                                    <span>{priceDollars(p.price_cents)} {p.currency}</span>
                                    <span>{p.credits_total} créditos</span>
                                    <span data-testid={`pass-sold-${p.id}`}>
                                        {p.passes_sold}{p.max_passes ? `/${p.max_passes}` : ""} vendidos
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(p)} data-testid={`pass-edit-${p.id}`}>
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                    size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => handleDelete(p)} disabled={deleting === p.id} data-testid={`pass-delete-${p.id}`}
                                >
                                    {deleting === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editing ? "Editar abono" : "Nuevo abono"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label>Nombre *</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => upd("name", e.target.value)}
                                placeholder="Abono de Temporada 2026"
                                data-testid="pass-name"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Descripción</Label>
                            <Textarea
                                value={form.description}
                                onChange={(e) => upd("description", e.target.value)}
                                rows={2}
                                placeholder="Acceso a 10 funciones a elección durante toda la temporada…"
                            />
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Precio (USD)</Label>
                                <Input
                                    type="number" min="0" step="0.01"
                                    value={form.price_dollars}
                                    onChange={(e) => upd("price_dollars", e.target.value)}
                                    placeholder="0.00"
                                    data-testid="pass-price"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Créditos incluidos *</Label>
                                <Input
                                    type="number" min="1"
                                    value={form.credits_total}
                                    onChange={(e) => upd("credits_total", e.target.value)}
                                    data-testid="pass-credits"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Cupo de abonos a la venta</Label>
                            <Input
                                type="number" min="1"
                                value={form.max_passes}
                                onChange={(e) => upd("max_passes", e.target.value)}
                                placeholder="Sin límite"
                                data-testid="pass-max"
                            />
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Redención desde</Label>
                                <Input
                                    type="datetime-local"
                                    value={form.redemption_starts_at as string}
                                    onChange={(e) => upd("redemption_starts_at", e.target.value)}
                                    data-testid="pass-redeem-start"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Redención hasta</Label>
                                <Input
                                    type="datetime-local"
                                    value={form.redemption_ends_at as string}
                                    onChange={(e) => upd("redemption_ends_at", e.target.value)}
                                    data-testid="pass-redeem-end"
                                />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Dejá las fechas de redención vacías para permitir redimir en
                            cualquier momento mientras el abono esté activo.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} disabled={saving} data-testid="pass-save">
                            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            {editing ? "Guardar cambios" : "Crear abono"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
