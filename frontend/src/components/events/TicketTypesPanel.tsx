import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, Loader2, AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    TooltipProvider,
} from "@/components/ui/tooltip";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import { isoToLocalInput, localInputToIso } from "@/lib/events";

interface Locality {
    id: string;
    name: string;
    price_cents?: number;
    capacity?: number;
    max_tickets_per_purchase?: number | null;
    color?: string;
}

interface TicketType {
    id: string;
    name: string;
    description?: string;
    price_cents: number;
    currency: string;
    capacity?: number;
    venue_locality_id?: string;
    color?: string;
    sort_order: number;
    active: boolean;
    sale_start?: string;
    sale_end?: string;
    max_per_buyer?: number;
    is_early_bird: boolean;
    early_bird_closes_at?: string;
    tickets_sold?: number;
    min_quantity?: number;
    exact_quantity?: number;
}

interface Props {
    eventId: string | null;
    localities?: Locality[];
    eventSaleWindow?: { sale_start: string | null; sale_end: string | null };
}

const COLORS = [
    { value: "#6366f1", label: "Índigo" },
    { value: "#0ea5e9", label: "Azul" },
    { value: "#22c55e", label: "Verde" },
    { value: "#f59e0b", label: "Ámbar" },
    { value: "#ef4444", label: "Rojo" },
    { value: "#a855f7", label: "Púrpura" },
    { value: "#ec4899", label: "Rosa" },
    { value: "#14b8a6", label: "Teal" },
];

const BLANK: Omit<TicketType, "id" | "active" | "tickets_sold"> = {
    name: "",
    description: "",
    price_cents: 0,
    currency: "usd",
    capacity: undefined,
    venue_locality_id: undefined,
    color: COLORS[0].value,
    sort_order: 0,
    sale_start: undefined,
    sale_end: undefined,
    max_per_buyer: undefined,
    is_early_bird: false,
    early_bird_closes_at: undefined,
    min_quantity: undefined,
    exact_quantity: undefined,
};

type PurchaseLimitMode = "none" | "min" | "exact";

function limitModeOf(min?: number, exact?: number): PurchaseLimitMode {
    if (exact) return "exact";
    if (min) return "min";
    return "none";
}

function priceDollars(cents: number): string {
    return (cents / 100).toFixed(2);
}

function centsFromDollars(dollars: string): number {
    const n = parseFloat(dollars);
    if (isNaN(n) || n < 0) return 0;
    return Math.round(n * 100);
}

export default function TicketTypesPanel({
    eventId,
    localities = [],
    eventSaleWindow,
}: Props) {
    const [types, setTypes] = useState<TicketType[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<TicketType | null>(null);
    const [form, setForm] = useState<typeof BLANK>({ ...BLANK });
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [priceStr, setPriceStr] = useState("0.00");
    // Snapshot of the event's sale window at the moment the dialog opened —
    // lets the inputs show the dates that actually apply (instead of being
    // blank) without freezing them as an explicit per-type override unless
    // the organizer actually edits them away from this snapshot.
    const [inheritedWindow, setInheritedWindow] = useState<{ sale_start?: string; sale_end?: string }>({});

    const load = async () => {
        if (!eventId) return;
        setLoading(true);
        try {
            const r = await api.get(`/events/me/${eventId}/ticket-types`);
            setTypes(r.data || []);
        } catch {
            toast.error("No se pudieron cargar los tipos de ticket");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [eventId]);

    const openCreate = () => {
        setEditing(null);
        const inherited = {
            sale_start: eventSaleWindow?.sale_start || undefined,
            sale_end: eventSaleWindow?.sale_end || undefined,
        };
        setInheritedWindow(inherited);
        setForm({ ...BLANK, ...inherited });
        setPriceStr("0.00");
        setOpen(true);
    };

    const openEdit = (tt: TicketType) => {
        setEditing(tt);
        // Falls back to the event's sale window, same as a brand-new ticket
        // type — an existing one that never set its own window should still
        // show the dates that actually apply to it.
        const inherited = {
            sale_start: tt.sale_start || eventSaleWindow?.sale_start || undefined,
            sale_end: tt.sale_end || eventSaleWindow?.sale_end || undefined,
        };
        setInheritedWindow(inherited);
        setForm({
            name: tt.name,
            description: tt.description || "",
            price_cents: tt.price_cents,
            currency: tt.currency,
            capacity: tt.capacity,
            venue_locality_id: tt.venue_locality_id,
            color: tt.color || COLORS[0].value,
            sort_order: tt.sort_order,
            sale_start: inherited.sale_start,
            sale_end: inherited.sale_end,
            max_per_buyer: tt.max_per_buyer,
            is_early_bird: tt.is_early_bird,
            early_bird_closes_at: tt.early_bird_closes_at,
            min_quantity: tt.min_quantity,
            exact_quantity: tt.exact_quantity,
        });
        setPriceStr(priceDollars(tt.price_cents));
        setOpen(true);
    };

    const upd = (key: string, val: unknown) =>
        setForm((prev) => ({ ...prev, [key]: val }));

    const handleSave = async () => {
        if (!eventId) return;
        if (!form.name.trim()) {
            toast.error("El nombre es requerido");
            return;
        }
        setSaving(true);
        const payload = {
            ...form,
            price_cents: centsFromDollars(priceStr),
            capacity: form.capacity || null,
            venue_locality_id: form.venue_locality_id || null,
            max_per_buyer: form.max_per_buyer || null,
            early_bird_closes_at: form.early_bird_closes_at || null,
            // Only persist as an explicit override if it was actually edited
            // away from the event's window shown when the dialog opened —
            // otherwise keep tracking the event's window dynamically (null).
            sale_start: form.sale_start === inheritedWindow.sale_start ? null : form.sale_start || null,
            sale_end: form.sale_end === inheritedWindow.sale_end ? null : form.sale_end || null,
            min_quantity: form.min_quantity || null,
            exact_quantity: form.exact_quantity || null,
        };
        try {
            if (editing) {
                await api.put(`/events/me/${eventId}/ticket-types/${editing.id}`, payload);
                toast.success("Tipo de ticket actualizado");
            } else {
                await api.post(`/events/me/${eventId}/ticket-types`, payload);
                toast.success("Tipo de ticket creado");
            }
            setOpen(false);
            await load();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Error al guardar");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (tt: TicketType) => {
        if (!eventId) return;
        if ((tt.tickets_sold ?? 0) > 0) {
            toast.error("No se puede eliminar: ya hay tickets vendidos. Desactívalo en su lugar.");
            return;
        }
        if (!confirm(`¿Eliminar tipo "${tt.name}"?`)) return;
        setDeleting(tt.id);
        try {
            await api.delete(`/events/me/${eventId}/ticket-types/${tt.id}`);
            toast.success("Tipo eliminado");
            await load();
        } catch (err: any) {
            const detail = err?.response?.data?.detail || "Error al eliminar";
            toast.error(detail);
        } finally {
            setDeleting(null);
        }
    };

    const selectedLocality = localities.find((l) => l.id === form.venue_locality_id) || null;
    const colorFromLocality = !!selectedLocality?.color && form.color === selectedLocality.color;
    const maxBuyerFromLocality =
        !!selectedLocality &&
        selectedLocality.max_tickets_per_purchase != null &&
        form.max_per_buyer === selectedLocality.max_tickets_per_purchase;

    if (!eventId) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground p-6 rounded-xl border">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="text-sm">
                    Guarda primero la información general del evento para gestionar los tipos de ticket.
                </span>
            </div>
        );
    }

    return (
        <div className="space-y-4" data-testid="section-ticket-types">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold">Tipos de ticket</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {localities.length > 0
                            ? "Opcional para este evento numerado: la venta ya está habilitada por los precios de \"Precios por localidad\". Crea tipos (VIP, Early Bird…) solo si necesitás categorías adicionales dentro de una misma localidad."
                            : "Define las categorías disponibles (VIP, General, Early Bird…) y su precio. Crea al menos una para habilitar la venta."}
                    </p>
                </div>
                <Button size="sm" onClick={openCreate} data-testid="add-ticket-type">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Agregar tipo
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : types.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                    <Tag className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Aún no hay tipos de ticket.</p>
                    <p className="text-xs mt-1">
                        {localities.length > 0
                            ? "No es obligatorio — tu evento ya vende por localidad."
                            : "Crea al menos uno para habilitar la venta."}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {types.map((tt) => (
                        <TicketTypeRow
                            key={tt.id}
                            tt={tt}
                            localities={localities}
                            onEdit={() => openEdit(tt)}
                            onDelete={() => handleDelete(tt)}
                            deleting={deleting === tt.id}
                        />
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? "Editar tipo de ticket" : "Nuevo tipo de ticket"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* Name */}
                        <div className="space-y-1.5">
                            <Label>Nombre *</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => upd("name", e.target.value)}
                                placeholder="VIP, General, Early Bird…"
                                data-testid="tt-name"
                            />
                        </div>

                        {/* Locality — first, since picking it pre-fills price, capacity,
                            color and max. per buyer below; asking it last meant those
                            fields got asked once manually and then silently overwritten. */}
                        {localities.length > 0 && (
                            <div className="space-y-1.5">
                                <Label>Localidad del venue</Label>
                                <Select
                                    value={form.venue_locality_id || "__none__"}
                                    onValueChange={(v) => {
                                        const loc = localities.find((l) => l.id === v);
                                        setForm((prev) => ({
                                            ...prev,
                                            venue_locality_id: v === "__none__" ? undefined : v,
                                            capacity: loc ? loc.capacity ?? prev.capacity : prev.capacity,
                                            max_per_buyer: loc
                                                ? loc.max_tickets_per_purchase ?? prev.max_per_buyer
                                                : prev.max_per_buyer,
                                            color: loc?.color || prev.color,
                                        }));
                                        if (loc && loc.price_cents != null) {
                                            setPriceStr(priceDollars(loc.price_cents));
                                        }
                                    }}
                                >
                                    <SelectTrigger data-testid="tt-locality">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">Sin localidad específica</SelectItem>
                                        {localities.map((l) => (
                                            <SelectItem key={l.id} value={l.id}>
                                                <span className="inline-flex items-center gap-1.5">
                                                    {l.color && (
                                                        <span
                                                            className="h-2.5 w-2.5 rounded-full shrink-0"
                                                            style={{ backgroundColor: l.color }}
                                                        />
                                                    )}
                                                    {l.name}
                                                    {l.price_cents != null
                                                        ? ` — $${priceDollars(l.price_cents)}`
                                                        : ""}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {selectedLocality ? (
                                    <p className="text-xs text-muted-foreground">
                                        Usando los valores de <strong>{selectedLocality.name}</strong>:
                                        precio, capacidad, color y máx. por comprador. Podés ajustar
                                        cualquiera de estos campos abajo si este tipo debe ser distinto.
                                    </p>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        Al elegir una localidad se completan precio, capacidad, color y
                                        máx. por comprador con sus valores. Podés ajustarlos después.
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Description */}
                        <div className="space-y-1.5">
                            <Label>Descripción</Label>
                            <Textarea
                                value={form.description || ""}
                                onChange={(e) => upd("description", e.target.value)}
                                rows={2}
                                placeholder="Incluye cena, copa de bienvenida…"
                            />
                        </div>

                        {/* Price + Capacity */}
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Precio (USD)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={priceStr}
                                    onChange={(e) => setPriceStr(e.target.value)}
                                    data-testid="tt-price"
                                />
                                <p className="text-xs text-muted-foreground">0.00 para ticket gratuito</p>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Capacidad</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={form.capacity ?? ""}
                                    onChange={(e) =>
                                        upd("capacity", e.target.value ? parseInt(e.target.value) : undefined)
                                    }
                                    placeholder="Ilimitada"
                                    data-testid="tt-capacity"
                                />
                            </div>
                        </div>

                        {/* Color */}
                        <div className="space-y-1.5">
                            <Label className="flex items-center gap-1.5">
                                Color de identificación
                                {colorFromLocality && (
                                    <span className="text-xs font-normal text-muted-foreground">
                                        · de la localidad
                                    </span>
                                )}
                            </Label>
                            <div className="flex gap-2 flex-wrap">
                                {COLORS.map((c) => (
                                    <button
                                        key={c.value}
                                        type="button"
                                        title={c.label}
                                        onClick={() => upd("color", c.value)}
                                        className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                                            form.color === c.value
                                                ? "border-foreground scale-110"
                                                : "border-transparent"
                                        }`}
                                        style={{ backgroundColor: c.value }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Sale window */}
                        <div className="space-y-1.5">
                            <Label>Ventana de venta</Label>
                            <p className="text-xs text-muted-foreground">
                                Por defecto sigue la del evento (las fechas ya están cargadas
                                abajo). Cambiala solo si este tipo debe abrir o cerrar en otro
                                momento (ej. Early Bird).
                            </p>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground">Inicio</span>
                                    <Input
                                        type="datetime-local"
                                        value={form.sale_start ? isoToLocalInput(form.sale_start) : ""}
                                        onChange={(e) =>
                                            upd(
                                                "sale_start",
                                                e.target.value ? localInputToIso(e.target.value) : undefined,
                                            )
                                        }
                                    />
                                </div>
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground">Fin</span>
                                    <Input
                                        type="datetime-local"
                                        value={form.sale_end ? isoToLocalInput(form.sale_end) : ""}
                                        onChange={(e) =>
                                            upd(
                                                "sale_end",
                                                e.target.value ? localInputToIso(e.target.value) : undefined,
                                            )
                                        }
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Max per buyer */}
                        <div className="space-y-1.5">
                            <Label className="flex items-center gap-1.5">
                                Máx. por comprador
                                {maxBuyerFromLocality && (
                                    <span className="text-xs font-normal text-muted-foreground">
                                        · de la localidad
                                    </span>
                                )}
                                <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3.5 w-3.5 text-muted-foreground" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            Límite de unidades de <strong>este tipo de ticket</strong> por
                                            comprador. Es independiente del límite general en "Accesos y
                                            parámetros", que aplica a la compra completa sumando todos los
                                            tipos.
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </Label>
                            <Input
                                type="number"
                                min="1"
                                value={form.max_per_buyer ?? ""}
                                onChange={(e) =>
                                    upd(
                                        "max_per_buyer",
                                        e.target.value ? parseInt(e.target.value) : undefined,
                                    )
                                }
                                placeholder="Sin límite específico"
                                data-testid="tt-max-buyer"
                            />
                        </div>

                        {/* Purchase-quantity limit (§4.2.6) */}
                        <div className="space-y-1.5">
                            <Label>Límite de compra por transacción</Label>
                            <Select
                                value={limitModeOf(form.min_quantity, form.exact_quantity)}
                                onValueChange={(v: PurchaseLimitMode) =>
                                    setForm((prev) => ({
                                        ...prev,
                                        min_quantity: v === "min" ? prev.min_quantity || 4 : undefined,
                                        exact_quantity: v === "exact" ? prev.exact_quantity || 4 : undefined,
                                    }))
                                }
                            >
                                <SelectTrigger data-testid="tt-limit-mode">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Sin límite</SelectItem>
                                    <SelectItem value="min">Mínimo N por compra</SelectItem>
                                    <SelectItem value="exact">Cantidad exacta (paquete de N)</SelectItem>
                                </SelectContent>
                            </Select>
                            {form.min_quantity !== undefined && form.min_quantity !== null && (
                                <Input
                                    type="number"
                                    min="2"
                                    value={form.min_quantity ?? ""}
                                    onChange={(e) =>
                                        upd("min_quantity", e.target.value ? parseInt(e.target.value) : undefined)
                                    }
                                    placeholder="Ej: 4"
                                    data-testid="tt-min-quantity"
                                />
                            )}
                            {form.exact_quantity !== undefined && form.exact_quantity !== null && (
                                <Input
                                    type="number"
                                    min="2"
                                    value={form.exact_quantity ?? ""}
                                    onChange={(e) =>
                                        upd("exact_quantity", e.target.value ? parseInt(e.target.value) : undefined)
                                    }
                                    placeholder="Ej: 4"
                                    data-testid="tt-exact-quantity"
                                />
                            )}
                            <p className="text-xs text-muted-foreground">
                                Ej: mesas o paquetes familiares que deben comprarse juntos.
                            </p>
                        </div>

                        {/* Early bird */}
                        <div className="rounded-lg border p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-medium text-sm">Early Bird</div>
                                    <div className="text-xs text-muted-foreground">
                                        Este tipo tiene precio especial hasta cierta fecha o cupo
                                    </div>
                                </div>
                                <Switch
                                    checked={form.is_early_bird}
                                    onCheckedChange={(v) => upd("is_early_bird", v)}
                                    data-testid="tt-early-bird"
                                />
                            </div>
                            {form.is_early_bird && (
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground">Cierra Early Bird</span>
                                    <Input
                                        type="datetime-local"
                                        value={
                                            form.early_bird_closes_at
                                                ? isoToLocalInput(form.early_bird_closes_at)
                                                : ""
                                        }
                                        onChange={(e) =>
                                            upd(
                                                "early_bird_closes_at",
                                                e.target.value
                                                    ? localInputToIso(e.target.value)
                                                    : undefined,
                                            )
                                        }
                                        data-testid="tt-early-bird-closes"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Sort order */}
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
                        <Button onClick={handleSave} disabled={saving} data-testid="tt-save">
                            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            {editing ? "Guardar cambios" : "Crear tipo"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function TicketTypeRow({
    tt,
    localities,
    onEdit,
    onDelete,
    deleting,
}: {
    tt: TicketType;
    localities: Locality[];
    onEdit: () => void;
    onDelete: () => void;
    deleting: boolean;
}) {
    const localityName = localities.find((l) => l.id === tt.venue_locality_id)?.name;
    const priceLabel =
        tt.price_cents === 0
            ? "Gratis"
            : `$${priceDollars(tt.price_cents)} ${tt.currency.toUpperCase()}`;

    return (
        <div className="flex items-center gap-3 rounded-lg border p-3 bg-card">
            <div
                className="h-8 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: tt.color || "#6366f1" }}
            />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{tt.name}</span>
                    {tt.is_early_bird && (
                        <Badge variant="secondary" className="text-xs">Early Bird</Badge>
                    )}
                    {tt.exact_quantity ? (
                        <Badge variant="outline" className="text-xs">Paquete de {tt.exact_quantity}</Badge>
                    ) : tt.min_quantity ? (
                        <Badge variant="outline" className="text-xs">Mín. {tt.min_quantity}</Badge>
                    ) : null}
                    {!tt.active && (
                        <Badge variant="destructive" className="text-xs">Inactivo</Badge>
                    )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs font-medium text-primary">{priceLabel}</span>
                    {tt.capacity && (
                        <span className="text-xs text-muted-foreground">
                            Cap. {tt.capacity}
                            {tt.tickets_sold ? ` · ${tt.tickets_sold} vendidos` : ""}
                        </span>
                    )}
                    {localityName && (
                        <span className="text-xs text-muted-foreground">{localityName}</span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={onEdit}
                    data-testid={`tt-edit-${tt.id}`}
                >
                    <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={onDelete}
                    disabled={deleting}
                    data-testid={`tt-delete-${tt.id}`}
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
