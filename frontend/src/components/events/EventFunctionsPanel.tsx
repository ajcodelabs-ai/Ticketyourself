import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Plus,
    Pencil,
    Trash2,
    CalendarRange,
    Loader2,
    AlertCircle,
    MapPin,
    Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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

interface FunctionTicketTypeOverride {
    ticket_type_id: string;
    price_cents_override?: number | null;
    capacity_override?: number | null;
    active: boolean;
    tickets_sold?: number;
}

interface LocalityPricing {
    locality_id: string;
    price_cents?: number | null;
}

interface EventFunction {
    id: string;
    name: string;
    description?: string;
    starts_at?: string;
    ends_at?: string;
    venue_name?: string;
    venue_address?: string;
    venue_city?: string;
    venue_country?: string;
    capacity?: number;
    sort_order: number;
    status: string;
    tickets_sold?: number;
    ticket_type_overrides?: FunctionTicketTypeOverride[];
    locality_pricing?: LocalityPricing[];
    kind?: "function" | "subevent";
}

interface TicketType {
    id: string;
    name: string;
    price_cents: number;
    color?: string;
}

interface Locality {
    id: string;
    name: string;
    price_cents?: number;
}

interface Props {
    eventId: string | null;
    localities?: Locality[];
    mode?: "function" | "subevent";
    timezone?: string;
}

type OverrideRow = { price: string; capacity: string; active: boolean };

// "function" = same show repeated (Multifunción — PRD §4.2.3).
// "subevent" = independent add-on under the umbrella event (sala VIP, cena,
// meet & greet). Entry time-slots / franjas de ingreso are Phase 2 — not here.
const MODE_LABELS = {
    function: {
        plural: "funciones",
        addButton: "Agregar función",
        panelTitle: "Funciones (multifunción)",
        panelSubtitle:
            "Agregá las repeticiones del mismo evento en distintas fechas u horarios. Todas ocurren en el escenario que elijas para el evento (lugar y aforo se heredan).",
        emptyTitle: "Aún no hay funciones.",
        emptyHint: "Agregá al menos una función para un evento multifunción.",
        namePlaceholder: "Función 1 — Sábado 14 de junio",
        descPlaceholder: "Detalles adicionales de esta función…",
        venueSectionTitle: "Lugar de esta función",
        capacityLabel: "Aforo de esta función",
        capacityHelp:
            "Si lo dejás vacío, esta función comparte el aforo general del evento. Si pones un número, esta función tiene su propio cupo independiente de las demás.",
        overlapHelp:
            "Todas las funciones ocurren en el mismo escenario. Si dos horarios se superponen, no vas a poder guardar.",
        dialogCreate: "Nueva función",
        dialogEdit: "Editar función",
        saveCreate: "Crear función",
        nameRequired: "El nombre de la función es requerido",
        savedCreate: "Función creada",
        savedEdit: "Función actualizada",
        deletedOk: "Función eliminada",
        deleteConfirm: (name: string) => `¿Eliminar la función "${name}"?`,
        deleteBlocked: "No se puede eliminar: ya hay tickets vendidos para esta función.",
        guardFirst: "Guarda primero la información general del evento para gestionar las funciones.",
    },
    subevent: {
        plural: "subeventos",
        addButton: "Agregar subevento",
        panelTitle: "Subeventos del evento",
        panelSubtitle:
            "Agrega experiencias independientes (sala VIP, cena, meet & greet). Cada una puede tener su propio escenario, aforo y precios — y puede coincidir en horario con el evento principal u otros subeventos.",
        emptyTitle: "Aún no hay subeventos.",
        emptyHint: "Agregá uno si tu evento incluye experiencias que se compran por separado.",
        namePlaceholder: "Cena VIP — Sábado 14 de junio",
        descPlaceholder: "Detalles adicionales de este subevento…",
        venueSectionTitle: "Lugar de este subevento",
        capacityLabel: "Aforo de este subevento",
        capacityHelp:
            "Si lo dejás vacío, este subevento comparte el aforo general del evento. Si pones un número, tiene su propio cupo independiente de los demás.",
        overlapHelp:
            "Los subeventos son experiencias independientes: pueden coincidir en horario con el evento principal u otros subeventos sin problema.",
        dialogCreate: "Nuevo subevento",
        dialogEdit: "Editar subevento",
        saveCreate: "Crear subevento",
        nameRequired: "El nombre del subevento es requerido",
        savedCreate: "Subevento creado",
        savedEdit: "Subevento actualizado",
        deletedOk: "Subevento eliminado",
        deleteConfirm: (name: string) => `¿Eliminar el subevento "${name}"?`,
        deleteBlocked: "No se puede eliminar: ya hay tickets vendidos para este subevento.",
        guardFirst: "Guarda primero la información general del evento para gestionar los subeventos.",
    },
} as const;

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

function priceDollars(cents?: number | null): string {
    if (cents == null) return "";
    return (cents / 100).toFixed(2);
}

// A função without an explicit end is assumed to run ~1h for overlap checks.
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function rangeOf(starts_at?: string | null, ends_at?: string | null) {
    if (!starts_at) return null;
    const start = new Date(starts_at).getTime();
    if (Number.isNaN(start)) return null;
    const end = ends_at ? new Date(ends_at).getTime() : start + DEFAULT_DURATION_MS;
    return { start, end: Number.isNaN(end) ? start + DEFAULT_DURATION_MS : end };
}

export default function EventFunctionsPanel({ eventId, localities = [], mode = "function", timezone = "America/Guayaquil" }: Props) {
    const L = MODE_LABELS[mode] || MODE_LABELS.function;
    const [functions, setFunctions] = useState<EventFunction[]>([]);
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<EventFunction | null>(null);
    const [form, setForm] = useState<typeof BLANK>({ ...BLANK });
    const [ttOverrides, setTtOverrides] = useState<Record<string, OverrideRow>>({});
    const [locOverrides, setLocOverrides] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    // A row already saved as "subevent" (own venue/capacity/overrides) must
    // keep behaving like one — in the save payload AND in the dialog itself —
    // even though the wizard now only exposes the "function" panel mode.
    // Otherwise editing it here would silently wipe, or permanently hide,
    // that data. Only a brand-new row follows the panel's mode.
    const rowKind = editing ? (editing.kind || mode) : mode;
    const DL = MODE_LABELS[rowKind] || L;

    const load = useCallback(async () => {
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
    }, [eventId]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!eventId) return;
        api.get(`/events/me/${eventId}/ticket-types`)
            .then((r) => setTicketTypes(r.data || []))
            .catch(() => setTicketTypes([]));
    }, [eventId]);

    const blankOverrideRows = (): Record<string, OverrideRow> => {
        const out: Record<string, OverrideRow> = {};
        for (const tt of ticketTypes) out[tt.id] = { price: "", capacity: "", active: true };
        return out;
    };

    const openCreate = () => {
        setEditing(null);
        setForm({ ...BLANK });
        setTtOverrides(blankOverrideRows());
        setLocOverrides({});
        setOpen(true);
    };

    const openEdit = (fn: EventFunction) => {
        setEditing(fn);
        setForm({
            name: fn.name,
            description: fn.description || "",
            starts_at: fn.starts_at ? isoToLocalInput(fn.starts_at, timezone) : "",
            ends_at: fn.ends_at ? isoToLocalInput(fn.ends_at, timezone) : "",
            venue_name: fn.venue_name || "",
            venue_address: fn.venue_address || "",
            venue_city: fn.venue_city || "",
            venue_country: fn.venue_country || "",
            capacity: fn.capacity ?? "",
            sort_order: fn.sort_order,
        });
        const rows = blankOverrideRows();
        for (const ov of fn.ticket_type_overrides || []) {
            rows[ov.ticket_type_id] = {
                price: ov.price_cents_override != null ? priceDollars(ov.price_cents_override) : "",
                capacity: ov.capacity_override != null ? String(ov.capacity_override) : "",
                active: ov.active,
            };
        }
        setTtOverrides(rows);
        const locRows: Record<string, string> = {};
        for (const lp of fn.locality_pricing || []) {
            if (lp.price_cents != null) locRows[lp.locality_id] = priceDollars(lp.price_cents);
        }
        setLocOverrides(locRows);
        setOpen(true);
    };

    const upd = (key: string, val: unknown) =>
        setForm((prev) => ({ ...prev, [key]: val }));

    const updOverride = (ticketTypeId: string, patch: Partial<OverrideRow>) =>
        setTtOverrides((prev) => ({
            ...prev,
            [ticketTypeId]: { ...(prev[ticketTypeId] || { price: "", capacity: "", active: true }), ...patch },
        }));

    // Mirrors the backend's exemption: a subevent never conflicts, and
    // nothing conflicts with a subevent (they run alongside the main event).
    const findScheduleConflict = (
        starts_at: string | null,
        ends_at: string | null,
        kind: "function" | "subevent",
    ) => {
        if (kind === "subevent") return null;
        const candidateRange = rangeOf(starts_at, ends_at);
        if (!candidateRange) return null;
        return functions.find((f) => {
            if (editing && f.id === editing.id) return false;
            if (f.status === "cancelled") return false;
            if (f.kind === "subevent") return false;
            const otherRange = rangeOf(f.starts_at, f.ends_at);
            if (!otherRange) return false;
            return candidateRange.start < otherRange.end && otherRange.start < candidateRange.end;
        });
    };

    const handleSave = async () => {
        if (!eventId) return;
        if (!form.name.trim()) {
            toast.error(DL.nameRequired);
            return;
        }

        const starts_at = form.starts_at ? localInputToIso(form.starts_at as string, timezone) : null;
        const ends_at = form.ends_at ? localInputToIso(form.ends_at as string, timezone) : null;
        const conflict = findScheduleConflict(starts_at, ends_at, rowKind);
        if (conflict) {
            toast.error(
                rowKind === "function"
                    ? `El horario se superpone con "${conflict.name}". Todas las funciones ocurren en el mismo escenario — ajustá el horario.`
                    : `El horario se superpone con "${conflict.name}" en el mismo lugar. Ajustá el horario o cambiá el lugar.`,
            );
            return;
        }

        const ticket_type_overrides =
            rowKind === "function"
                ? []
                : ticketTypes
                      .map((tt) => {
                          const row = ttOverrides[tt.id] || { price: "", capacity: "", active: true };
                          const hasPrice = row.price !== "";
                          const hasCapacity = row.capacity !== "";
                          if (!hasPrice && !hasCapacity && row.active) return null; // fully inherited
                          return {
                              ticket_type_id: tt.id,
                              price_cents_override: hasPrice ? Math.round(parseFloat(row.price) * 100) : null,
                              capacity_override: hasCapacity ? parseInt(row.capacity, 10) : null,
                              active: row.active,
                          };
                      })
                      .filter(Boolean);

        const locality_pricing =
            rowKind === "function"
                ? []
                : localities
                      .map((loc) => {
                          const v = locOverrides[loc.id];
                          if (v === "" || v == null) return null; // inherits event price
                          return { locality_id: loc.id, price_cents: Math.round(parseFloat(v) * 100) };
                      })
                      .filter(Boolean);

        setSaving(true);
        const payload = rowKind === "function"
            ? {
                  name: form.name,
                  description: form.description,
                  starts_at,
                  ends_at,
                  venue_name: null,
                  venue_address: null,
                  venue_city: null,
                  venue_country: null,
                  capacity: null,
                  sort_order: editing ? editing.sort_order : functions.length,
                  ticket_type_overrides: [],
                  locality_pricing: [],
                  kind: rowKind,
              }
            : {
                  ...form,
                  starts_at,
                  ends_at,
                  capacity: form.capacity !== "" ? Number(form.capacity) : null,
                  venue_name: form.venue_name || null,
                  venue_address: form.venue_address || null,
                  venue_city: form.venue_city || null,
                  venue_country: form.venue_country || null,
                  ticket_type_overrides,
                  locality_pricing,
                  kind: rowKind,
              };
        try {
            if (editing) {
                await api.put(`/events/me/${eventId}/functions/${editing.id}`, payload);
                toast.success(DL.savedEdit);
            } else {
                await api.post(`/events/me/${eventId}/functions`, payload);
                toast.success(DL.savedCreate);
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
        const fl = MODE_LABELS[fn.kind || mode] || L;
        if ((fn.tickets_sold ?? 0) > 0) {
            toast.error(fl.deleteBlocked);
            return;
        }
        if (!confirm(fl.deleteConfirm(fn.name))) return;
        setDeleting(fn.id);
        try {
            await api.delete(`/events/me/${eventId}/functions/${fn.id}`);
            toast.success(fl.deletedOk);
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
                <span className="text-sm">{L.guardFirst}</span>
            </div>
        );
    }

    return (
        <div className="space-y-4" data-testid="section-functions">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h4 className="font-medium text-sm">{L.panelTitle}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{L.panelSubtitle}</p>
                </div>
                <Button size="sm" onClick={openCreate} data-testid="add-function" className="shrink-0">
                    <Plus className="h-4 w-4 mr-1.5" />
                    {L.addButton}
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : functions.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                    <CalendarRange className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">{L.emptyTitle}</p>
                    <p className="text-xs mt-1">{L.emptyHint}</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {functions.map((fn) => (
                        <FunctionRow
                            key={fn.id}
                            fn={fn}
                            inheritFromEvent={(fn.kind || mode) === "function"}
                            onEdit={() => openEdit(fn)}
                            onDelete={() => handleDelete(fn)}
                            deleting={deleting === fn.id}
                        />
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className={`${rowKind === "function" ? "max-w-md" : "max-w-xl"} max-h-[90vh] overflow-y-auto`}>
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? DL.dialogEdit : DL.dialogCreate}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* Name */}
                        <div className="space-y-1.5">
                            <Label>Nombre *</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => upd("name", e.target.value)}
                                placeholder={DL.namePlaceholder}
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
                                placeholder={DL.descPlaceholder}
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
                        <p className="text-xs text-muted-foreground -mt-2">{DL.overlapHelp}</p>

                        {rowKind === "subevent" && (
                        <>
                        {/* Venue */}
                        <div className="space-y-3 rounded-lg border p-4">
                            <p className="text-sm font-medium">{DL.venueSectionTitle}</p>
                            <p className="text-xs text-muted-foreground -mt-2">
                                Opcional. Si es diferente al escenario principal del evento.
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
                            <Label>{DL.capacityLabel}</Label>
                            <Input
                                type="number"
                                min="1"
                                value={form.capacity}
                                onChange={(e) => upd("capacity", e.target.value)}
                                placeholder="Usa el aforo del evento"
                                data-testid="fn-capacity"
                            />
                            <p className="text-xs text-muted-foreground">{DL.capacityHelp}</p>
                        </div>

                        {/* Ticket type overrides */}
                        {ticketTypes.length > 0 && (
                            <div className="space-y-2 rounded-lg border p-4" data-testid="fn-ticket-overrides">
                                <p className="text-sm font-medium flex items-center gap-1.5">
                                    <Ticket className="h-4 w-4" />
                                    Precio y aforo por tipo de ticket
                                </p>
                                <p className="text-xs text-muted-foreground -mt-1">
                                    Dejá vacío para heredar el precio/aforo general del tipo de
                                    ticket. Desactivá un tipo si no se vende en esta función.
                                </p>
                                <div className="divide-y">
                                    {ticketTypes.map((tt) => {
                                        const row = ttOverrides[tt.id] || { price: "", capacity: "", active: true };
                                        return (
                                            <div
                                                key={tt.id}
                                                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-2"
                                                data-testid={`fn-tt-row-${tt.id}`}
                                            >
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    {tt.color && (
                                                        <span
                                                            className="h-2.5 w-2.5 rounded-full shrink-0"
                                                            style={{ background: tt.color }}
                                                        />
                                                    )}
                                                    <span className="text-sm truncate">{tt.name}</span>
                                                </div>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="h-8 w-24"
                                                    placeholder={priceDollars(tt.price_cents) || "0.00"}
                                                    value={row.price}
                                                    onChange={(e) => updOverride(tt.id, { price: e.target.value })}
                                                    disabled={!row.active}
                                                    data-testid={`fn-tt-price-${tt.id}`}
                                                />
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    className="h-8 w-20"
                                                    placeholder="Aforo"
                                                    value={row.capacity}
                                                    onChange={(e) => updOverride(tt.id, { capacity: e.target.value })}
                                                    disabled={!row.active}
                                                    data-testid={`fn-tt-capacity-${tt.id}`}
                                                />
                                                <div className="flex items-center gap-1.5 justify-end">
                                                    <Switch
                                                        checked={row.active}
                                                        onCheckedChange={(v) => updOverride(tt.id, { active: v })}
                                                        data-testid={`fn-tt-active-${tt.id}`}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Locality price overrides */}
                        {localities.length > 0 && (
                            <div className="space-y-2 rounded-lg border p-4" data-testid="fn-locality-overrides">
                                <p className="text-sm font-medium flex items-center gap-1.5">
                                    <MapPin className="h-4 w-4" />
                                    Precio por localidad
                                </p>
                                <p className="text-xs text-muted-foreground -mt-1">
                                    Dejá vacío para usar el precio que configuraste a nivel evento
                                    para esa localidad.
                                </p>
                                <div className="divide-y">
                                    {localities.map((loc) => (
                                        <div
                                            key={loc.id}
                                            className="grid grid-cols-[1fr_auto] items-center gap-2 py-2"
                                            data-testid={`fn-loc-row-${loc.id}`}
                                        >
                                            <span className="text-sm truncate">{loc.name}</span>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="h-8 w-24"
                                                placeholder={priceDollars(loc.price_cents) || "0.00"}
                                                value={locOverrides[loc.id] || ""}
                                                onChange={(e) =>
                                                    setLocOverrides((prev) => ({ ...prev, [loc.id]: e.target.value }))
                                                }
                                                data-testid={`fn-loc-price-${loc.id}`}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

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
                        </>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} disabled={saving} data-testid="fn-save">
                            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            {editing ? "Guardar cambios" : DL.saveCreate}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function FunctionRow({
    fn,
    inheritFromEvent,
    onEdit,
    onDelete,
    deleting,
}: {
    fn: EventFunction;
    inheritFromEvent: boolean;
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

    const activeOverrides = (fn.ticket_type_overrides || []).filter((o) => o.active === false || o.price_cents_override != null || o.capacity_override != null);

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
                    {!inheritFromEvent && fn.venue_name && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                            <MapPin className="h-3 w-3" />
                            {fn.venue_name}
                            {fn.venue_city ? `, ${fn.venue_city}` : ""}
                        </span>
                    )}
                    <span className="text-xs text-muted-foreground" data-testid={`fn-sold-${fn.id}`}>
                        {inheritFromEvent
                            ? (fn.tickets_sold ?? 0) > 0
                                ? `${fn.tickets_sold} vendidos · aforo del evento`
                                : "Aforo del evento"
                            : fn.capacity
                              ? `${fn.tickets_sold ?? 0}/${fn.capacity} vendidos`
                              : (fn.tickets_sold ?? 0) > 0
                                ? `${fn.tickets_sold} vendidos`
                                : "Aforo del evento"}
                    </span>
                    {!inheritFromEvent && activeOverrides.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                            {activeOverrides.length} override{activeOverrides.length > 1 ? "s" : ""} de ticket
                        </Badge>
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
