/**
 * EventVenueSection — Mapa + Localidades (paso Localidades).
 *
 * Flujo (create):
 *  1) Seleccioná el escenario (mapa = solo la forma)
 *  2) Guardá el evento
 *  3) Agregá localidades del evento (nombre, color, precios) y asignalas en el mapa
 *
 * Nombre / color / precios viven en el evento (`venue_layout.localities` +
 * `locality_pricing`). El venue maestro solo aporta canvas + elementos.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { HexColorPicker } from "react-colorful";
import {
    MapPin,
    Loader2,
    PlusCircle,
    Building2,
    ArrowRight,
    Pencil,
    Trash2,
    Wand2,
    Layers,
    CheckCircle2,
    Circle,
    Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import api, { formatApiError } from "@/lib/api";
import { venuesApi, eventVenueLayoutApi, computeCapacity, LOCALITY_PALETTE, newId } from "@/lib/venues";
import EditorCanvas from "@/components/venues/EditorCanvas";
import { useAuth } from "@/contexts/AuthContext";

function dollarsToCents(v: string): number {
    if (v === "" || v == null) return 0;
    return Math.max(0, Math.round(parseFloat(v) * 100) || 0);
}

function centsToInput(cents: number | null | undefined): string {
    if (cents == null) return "";
    return (cents / 100).toFixed(2);
}

function FieldTip({ text }: { text: string }) {
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex text-muted-foreground hover:text-foreground"
                        aria-label="Más información"
                        onClick={(e) => e.preventDefault()}
                    >
                        <Info className="h-3.5 w-3.5" />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
                    {text}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

const LOCALITY_FIELD_TIPS = {
    color: "Color con el que se pintan en el mapa los asientos o zonas de esta localidad.",
    name: "Nombre que ve el comprador al elegir asientos (ej. Platea, VIP, General).",
    description: "Texto opcional para aclarar qué incluye o dónde queda esta localidad.",
    price: "Precio base de la entrada. Sobre este monto se calcula el fee de la plataforma.",
    service:
        "Cargo de servicio configurable por ticket (PRD §4.2.1). Se suma al total del comprador.",
    admin:
        "TicketSeguro: cobertura / seguro por ticket. Se suma al total del comprador. Dejá $0 si no aplica.",
    vxs: "Impuestos (IVA u otros) por ticket. Se suma al total del comprador.",
    wallet:
        "Billetera Virtual: cargo o recarga asociada al ticket. Se suma al total del comprador.",
};

function venueCreateHref(eventId: string | null | undefined) {
    const returnTo = eventId
        ? encodeURIComponent(`/app/eventos/${eventId}/editar?tab=localidades`)
        : encodeURIComponent("/app/eventos/nuevo?tab=localidades");
    return `/app/venues?create=1&return_to=${returnTo}`;
}

function eventMapHref(eventId: string) {
    const returnTo = encodeURIComponent(`/app/eventos/${eventId}/editar?tab=localidades`);
    return `/app/eventos/${eventId}/mapa?return_to=${returnTo}`;
}

function layoutAsLinkedVenue(event, tenantSlug) {
    const layout = event?.venue_layout;
    if (!event?.venue_id || !layout) return null;
    return {
        id: event.venue_id,
        name: event.venue_name || "Mapa del evento",
        slug: event.venue_slug,
        tenant_slug: tenantSlug,
        canvas: layout.canvas || { width: 1000, height: 600 },
        elements: layout.elements || [],
        localities: layout.localities || [],
        capacity_calculated: layout.capacity_calculated || 0,
        is_event_snapshot: true,
    };
}

function MoneyField({ label, tip, value, onChange, disabled = false, testid }) {
    return (
        <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-normal inline-flex items-center gap-1">
                {label}
                {tip ? <FieldTip text={tip} /> : null}
            </Label>
            <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="pl-6 h-9"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    data-testid={testid}
                />
            </div>
        </div>
    );
}

const emptyDraftMoney = { price: "", vxs: "", service: "", admin: "", wallet: "" };

function LocalityFormDialog({ open, onClose, onSubmit, initial, saving }) {
    const [name, setName] = useState("");
    const [color, setColor] = useState(LOCALITY_PALETTE[0]);
    const [description, setDescription] = useState("");
    const [money, setMoney] = useState(emptyDraftMoney);

    useEffect(() => {
        if (!open) return;
        if (initial) {
            setName(initial.name || "");
            setColor(initial.color || LOCALITY_PALETTE[0]);
            setDescription(initial.description || "");
            setMoney({
                price: centsToInput(initial.price_cents) || "",
                vxs: centsToInput(initial.vxs_cents) || "",
                service: centsToInput(initial.service_fee_cents) || "",
                admin: centsToInput(initial.admin_fee_cents) || "",
                wallet: centsToInput(initial.wallet_fee_cents) || "",
            });
        } else {
            setName("");
            setColor(LOCALITY_PALETTE[0]);
            setDescription("");
            setMoney(emptyDraftMoney);
        }
    }, [open, initial]);

    const handleSubmit = () => {
        if (!name.trim()) {
            toast.error("Poné un nombre a la localidad");
            return;
        }
        onSubmit({
            name: name.trim(),
            color,
            description: description.trim() || null,
            price_cents: dollarsToCents(money.price),
            vxs_cents: dollarsToCents(money.vxs),
            service_fee_cents: dollarsToCents(money.service),
            admin_fee_cents: dollarsToCents(money.admin),
            wallet_fee_cents: dollarsToCents(money.wallet),
        });
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent data-testid="locality-form-dialog">
                <DialogHeader>
                    <DialogTitle>{initial ? "Editar localidad" : "Nueva localidad"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
                        <div className="space-y-1">
                            <Label className="text-xs inline-flex items-center gap-1">
                                Color
                                <FieldTip text={LOCALITY_FIELD_TIPS.color} />
                            </Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="h-9 w-9 rounded-md ring-1 ring-border"
                                        style={{ background: color }}
                                        aria-label="Elegir color"
                                        data-testid="locality-form-color"
                                    />
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-2">
                                    <HexColorPicker color={color} onChange={setColor} />
                                    <div className="flex gap-1 mt-2 flex-wrap">
                                        {LOCALITY_PALETTE.map((c) => (
                                            <button
                                                key={c}
                                                type="button"
                                                className="h-5 w-5 rounded ring-1 ring-border"
                                                style={{ background: c }}
                                                onClick={() => setColor(c)}
                                            />
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs inline-flex items-center gap-1">
                                Nombre
                                <FieldTip text={LOCALITY_FIELD_TIPS.name} />
                            </Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="VIP, Platea, General…"
                                autoFocus
                                data-testid="locality-form-name"
                            />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs inline-flex items-center gap-1">
                            Descripción
                            <FieldTip text={LOCALITY_FIELD_TIPS.description} />
                        </Label>
                        <Input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Opcional"
                            data-testid="locality-form-description"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <MoneyField
                            label="Precio Entrada"
                            tip={LOCALITY_FIELD_TIPS.price}
                            value={money.price}
                            onChange={(v) => setMoney((m) => ({ ...m, price: v }))}
                            testid="locality-form-price"
                        />
                        <MoneyField
                            label="Cargo de servicio"
                            tip={LOCALITY_FIELD_TIPS.service}
                            value={money.service}
                            onChange={(v) => setMoney((m) => ({ ...m, service: v }))}
                            testid="locality-form-service"
                        />
                        <MoneyField
                            label="TicketSeguro"
                            tip={LOCALITY_FIELD_TIPS.admin}
                            value={money.admin}
                            onChange={(v) => setMoney((m) => ({ ...m, admin: v }))}
                            testid="locality-form-admin"
                        />
                        <MoneyField
                            label="Impuestos"
                            tip={LOCALITY_FIELD_TIPS.vxs}
                            value={money.vxs}
                            onChange={(v) => setMoney((m) => ({ ...m, vxs: v }))}
                            testid="locality-form-vxs"
                        />
                        <MoneyField
                            label="Billetera Virtual"
                            tip={LOCALITY_FIELD_TIPS.wallet}
                            value={money.wallet}
                            onChange={(v) => setMoney((m) => ({ ...m, wallet: v }))}
                            testid="locality-form-wallet"
                        />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        El comprador paga: Entrada + servicio + TicketSeguro + impuestos + billetera.
                        El fee de TicketYourself aplica solo sobre la Entrada.
                    </p>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={saving} data-testid="locality-form-submit">
                        {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                        {initial ? "Guardar" : "Crear localidad"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CreateFlowSteps({ selectedVenue, eventSaved }: { selectedVenue: boolean; eventSaved: boolean }) {
    const steps = [
        {
            n: 1,
            title: "Selecciona el escenario",
            done: selectedVenue,
            active: !selectedVenue,
        },
        {
            n: 2,
            title: "Guarda el evento",
            done: eventSaved && selectedVenue,
            active: selectedVenue && !eventSaved,
        },
        {
            n: 3,
            title: "Agrega localidades",
            done: false,
            active: eventSaved && selectedVenue,
        },
    ];
    return (
        <ol className="mt-4 space-y-3" data-testid="localidades-create-steps">
            {steps.map((s) => (
                <li key={s.n} className="flex items-start gap-2.5">
                    {s.done ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : s.active ? (
                        <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                            {s.n}
                        </span>
                    ) : (
                        <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
                    )}
                    <span
                        className={`text-sm leading-snug ${
                            s.active || s.done ? "text-foreground font-medium" : "text-muted-foreground"
                        }`}
                    >
                        {s.title}
                    </span>
                </li>
            ))}
        </ol>
    );
}

export default function EventVenueSection({
    event,
    disabled,
    onUpdated,
    onReturnFromVenueCreate = undefined,
    pendingVenueId = null,
    onPendingVenueChange = undefined,
}: {
    event: any;
    disabled?: boolean;
    onUpdated?: (e: any) => void;
    onReturnFromVenueCreate?: unknown;
    pendingVenueId?: string | null;
    onPendingVenueChange?: (id: string | null) => void;
}) {
    const { organizer } = useAuth();
    const tenantSlug = organizer?.slug || event?.tenant_slug;
    const [venues, setVenues] = useState([]);
    const [linkedVenue, setLinkedVenue] = useState(null);
    const [loadingLink, setLoadingLink] = useState(false);
    const [highlightLocality, setHighlightLocality] = useState(null);
    const [mapOpen, setMapOpen] = useState(false);
    const [pricing, setPricing] = useState({});
    const [formOpen, setFormOpen] = useState(false);
    const [editingLocality, setEditingLocality] = useState(null);
    const [savingForm, setSavingForm] = useState(false);
    const initializedRef = useRef(false);

    const eventSaved = !!event?.id;
    const selectedVenueId = event?.venue_id || pendingVenueId || "";
    const selectedVenueMeta = useMemo(
        () => venues.find((v) => v.id === selectedVenueId) || null,
        [venues, selectedVenueId],
    );

    useEffect(() => {
        let alive = true;
        venuesApi
            .list({ status: "published" })
            .then((d) => {
                if (!alive) return;
                setVenues((d.items || []).filter((v) => v.status === "published"));
            })
            .catch(() => setVenues([]));
        return () => { alive = false; };
    }, [onReturnFromVenueCreate]);

    useEffect(() => {
        let alive = true;
        if (!event?.venue_id) {
            setLinkedVenue(null);
            initializedRef.current = false;
            return undefined;
        }
        const fromSnapshot = layoutAsLinkedVenue(event, tenantSlug);
        if (fromSnapshot) {
            setLinkedVenue(fromSnapshot);
            return undefined;
        }
        venuesApi
            .get(event.venue_id)
            .then((v) => { if (alive) setLinkedVenue(v); })
            .catch(() => { if (alive) setLinkedVenue(null); });
        return () => { alive = false; };
    }, [event?.venue_id, event?.venue_layout, event?.venue_name, event?.venue_slug, tenantSlug]);

    useEffect(() => {
        if (!linkedVenue || initializedRef.current) return;
        const next = {};
        for (const lp of event?.locality_pricing || []) {
            next[lp.locality_id] = {
                price_cents: lp.price_cents || 0,
                service_fee_cents: lp.service_fee_cents || 0,
                admin_fee_cents: lp.admin_fee_cents || 0,
                vxs_cents: lp.vxs_cents || 0,
                wallet_fee_cents: lp.wallet_fee_cents || 0,
                max_per_purchase: lp.max_tickets_per_purchase ?? null,
            };
        }
        for (const loc of linkedVenue.localities || []) {
            if (!next[loc.id]) {
                next[loc.id] = {
                    price_cents: loc.default_price_cents || 0,
                    service_fee_cents: 0,
                    admin_fee_cents: 0,
                    vxs_cents: 0,
                    wallet_fee_cents: 0,
                    max_per_purchase: null,
                };
            }
        }
        setPricing(next);
        initializedRef.current = true;
    }, [linkedVenue, event?.locality_pricing]);

    const allLocalities = useMemo(() => linkedVenue?.localities || [], [linkedVenue]);

    const assignedCountByLocality = useMemo(() => {
        const counts = {};
        for (const el of linkedVenue?.elements || []) {
            if (!el.locality_id) continue;
            counts[el.locality_id] = (counts[el.locality_id] || 0) + 1;
        }
        return counts;
    }, [linkedVenue]);

    const elements = useMemo(() => linkedVenue?.elements || [], [linkedVenue]);
    const canvas = useMemo(
        () => linkedVenue?.canvas || { width: 1000, height: 600 },
        [linkedVenue],
    );

    const summary = useMemo(() => {
        if (allLocalities.length === 0) return null;
        const prices = allLocalities.map((l) => pricing[l.id]?.price_cents ?? 0);
        return {
            capacity: computeCapacity(elements),
            localityCount: allLocalities.length,
            minPrice: Math.min(...prices) / 100,
            maxPrice: Math.max(...prices) / 100,
        };
    }, [allLocalities, pricing, elements]);

    const persistLink = async (next) => {
        if (!event?.id) return null;
        const r = await api.put(`/events/me/${event.id}/venue`, next);
        onUpdated?.(r.data);
        return r.data;
    };

    const persistLocalities = async (nextLocalities) => {
        if (!event?.id || !linkedVenue) return null;
        return eventVenueLayoutApi.put(event.id, {
            canvas: linkedVenue.canvas || { width: 1000, height: 600 },
            elements: linkedVenue.elements || [],
            localities: nextLocalities,
        });
    };

    const pricingPayload = (pricingMap, localitiesList) =>
        localitiesList.map((loc) => {
            const row = pricingMap[loc.id] || {};
            return {
                locality_id: loc.id,
                price_cents: Math.max(0, parseInt(row.price_cents ?? 0, 10) || 0),
                service_fee_cents: Math.max(0, parseInt(row.service_fee_cents ?? 0, 10) || 0),
                admin_fee_cents: Math.max(0, parseInt(row.admin_fee_cents ?? 0, 10) || 0),
                vxs_cents: Math.max(0, parseInt(row.vxs_cents ?? 0, 10) || 0),
                wallet_fee_cents: Math.max(0, parseInt(row.wallet_fee_cents ?? 0, 10) || 0),
                max_tickets_per_purchase:
                    row.max_per_purchase != null
                        ? Math.max(1, parseInt(row.max_per_purchase, 10) || 0) || null
                        : null,
            };
        });

    const selectVenue = async (vid: string) => {
        if (!vid) return;

        // Create flow: remember selection until the event is saved.
        if (!event?.id) {
            onPendingVenueChange?.(vid);
            toast.message("Escenario seleccionado. Guardá el evento para continuar.");
            return;
        }

        const v = venues.find((x) => x.id === vid);
        if (!v) return;
        setLoadingLink(true);
        try {
            // Shape-only link: localities/precios se crean después en este tab.
            const r = await api.put(`/events/me/${event.id}/venue`, {
                venue_id: vid,
                locality_pricing: [],
                seat_holds_window_minutes: event?.seat_holds_window_minutes || 10,
            });
            onPendingVenueChange?.(null);
            onUpdated?.(r.data);
            initializedRef.current = false;
            toast.success("Mapa vinculado — ahora creá las localidades del evento");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || "No se pudo vincular el mapa.");
        } finally {
            setLoadingLink(false);
        }
    };

    const openCreateForm = () => {
        setEditingLocality(null);
        setFormOpen(true);
    };

    const openEditForm = (loc) => {
        const p = pricing[loc.id] || {};
        setEditingLocality({
            id: loc.id,
            name: loc.name,
            color: loc.color,
            description: loc.description,
            price_cents: p.price_cents,
            vxs_cents: p.vxs_cents,
            service_fee_cents: p.service_fee_cents,
            admin_fee_cents: p.admin_fee_cents,
            wallet_fee_cents: p.wallet_fee_cents,
        });
        setFormOpen(true);
    };

    const submitLocalityForm = async (values) => {
        if (!linkedVenue) return;
        setSavingForm(true);
        try {
            const isEdit = !!editingLocality?.id;
            const locId = editingLocality?.id || newId();
            const entry = {
                id: locId,
                name: values.name,
                color: values.color,
                description: values.description,
                default_price_cents: values.price_cents,
            };
            const nextLocalities = isEdit
                ? allLocalities.map((l) => (l.id === locId ? { ...l, ...entry } : l))
                : [...allLocalities, entry];

            await persistLocalities(nextLocalities);

            const nextPricing = {
                ...pricing,
                [locId]: {
                    price_cents: values.price_cents,
                    service_fee_cents: values.service_fee_cents,
                    admin_fee_cents: values.admin_fee_cents,
                    vxs_cents: values.vxs_cents,
                    wallet_fee_cents: values.wallet_fee_cents,
                    max_per_purchase: pricing[locId]?.max_per_purchase ?? null,
                },
            };
            setPricing(nextPricing);

            await persistLink({
                venue_id: linkedVenue.id,
                locality_pricing: pricingPayload(nextPricing, nextLocalities),
                seat_holds_window_minutes: event?.seat_holds_window_minutes || 10,
            });

            toast.success(isEdit ? "Localidad actualizada" : "Localidad creada");
            setFormOpen(false);
            setEditingLocality(null);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo guardar la localidad.");
        } finally {
            setSavingForm(false);
        }
    };

    const deleteLocalityRow = async (locId) => {
        if ((assignedCountByLocality[locId] || 0) > 0) {
            toast.error("Esta localidad tiene elementos asignados en el mapa. Reasignalos antes de borrarla.");
            return;
        }
        const ok = window.confirm("¿Borrar esta localidad?");
        if (!ok) return;
        setLoadingLink(true);
        try {
            const nextLocalities = allLocalities.filter((l) => l.id !== locId);
            await persistLocalities(nextLocalities);
            const nextPricing = { ...pricing };
            delete nextPricing[locId];
            setPricing(nextPricing);
            await persistLink({
                venue_id: linkedVenue.id,
                locality_pricing: pricingPayload(nextPricing, nextLocalities),
                seat_holds_window_minutes: event?.seat_holds_window_minutes || 10,
            });
            toast.success("Localidad borrada");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo borrar la localidad.");
        } finally {
            setLoadingLink(false);
        }
    };

    const handleUnlink = async () => {
        if (!event?.id) {
            onPendingVenueChange?.(null);
            return;
        }
        const ok = window.confirm(
            "¿Desvincular el mapa del evento? Las localidades y precios se perderán.",
        );
        if (!ok) return;
        if ((event?.tickets_sold || 0) > 0) {
            toast.error("No podés cambiar el mapa una vez que hay ventas confirmadas.");
            return;
        }
        setLoadingLink(true);
        try {
            await api.delete(`/events/me/${event.id}/venue`);
            onUpdated?.({
                ...event,
                venue_id: null,
                venue_slug: null,
                source_venue_id: null,
                venue_layout: null,
                locality_pricing: [],
            });
            onPendingVenueChange?.(null);
            toast.success("Mapa desvinculado");
            initializedRef.current = false;
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo desvincular.");
        } finally {
            setLoadingLink(false);
        }
    };

    const onCanvasSelect = (ids) => {
        if (!ids || ids.length === 0) return setHighlightLocality(null);
        const el = elements.find((e) => e.id === ids[0]);
        if (!el?.locality_id) return setHighlightLocality(null);
        setHighlightLocality(el.locality_id);
        const row = document.querySelector(`[data-testid="loc-row-${el.locality_id}"]`);
        if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    const localitiesById = useMemo(() => {
        const m = {};
        for (const l of allLocalities) m[l.id] = l;
        return m;
    }, [allLocalities]);

    const canManageLocalities = eventSaved && !!linkedVenue;
    const showCreateGate = !canManageLocalities;

    if (venues.length === 0 && !linkedVenue && !pendingVenueId) {
        return (
            <div className="rounded-xl border-2 border-dashed p-8 bg-card text-center space-y-4" data-testid="venue-empty-state">
                <div className="mx-auto h-14 w-14 rounded-full bg-teal-50 flex items-center justify-center">
                    <Building2 className="h-7 w-7 text-teal-800" />
                </div>
                <div className="space-y-1">
                    <h3 className="font-semibold text-lg">Todavía no tenés un mapa</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        Creá un mapa (la forma del lugar), publicalo y volvé acá. Las localidades y precios
                        los configurás por evento.
                    </p>
                </div>
                <Button asChild size="lg" data-testid="venue-create-cta">
                    <a href={venueCreateHref(event?.id)}>
                        <PlusCircle className="h-5 w-5 mr-2" />
                        Crear mapa
                        <ArrowRight className="h-4 w-4 ml-2" />
                    </a>
                </Button>
            </div>
        );
    }

    return (
        <div className="grid lg:grid-cols-[minmax(240px,280px)_1fr] gap-4" data-testid="venue-localidades-layout">
            {/* ── Left: Escenario ── */}
            <aside className="rounded-xl border bg-card p-4 space-y-3 h-fit" data-testid="escenario-panel">
                <div>
                    <h4 className="font-semibold text-sm">Escenario</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                        Lugar del evento — solo la forma del mapa
                    </p>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs">Mapa / Lugar *</Label>
                    <Select
                        value={selectedVenueId || undefined}
                        onValueChange={selectVenue}
                        disabled={disabled || loadingLink || (event?.tickets_sold || 0) > 0}
                    >
                        <SelectTrigger data-testid="wiz-venue-select">
                            <SelectValue placeholder="Elegí un mapa publicado…" />
                        </SelectTrigger>
                        <SelectContent>
                            {venues.map((v) => (
                                <SelectItem
                                    key={v.id}
                                    value={v.id}
                                    data-testid={`venue-opt-${v.slug}`}
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                                        {v.name}
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {(event?.tickets_sold || 0) > 0 && (
                        <p
                            className="text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5"
                            data-testid="venue-locked-sales-reason"
                        >
                            El evento ya tiene {event.tickets_sold} ticket(s) vendido(s); no se puede cambiar el mapa.
                        </p>
                    )}
                </div>

                {(selectedVenueMeta || linkedVenue) && (
                    <div className="space-y-2">
                        <Badge
                            variant="secondary"
                            className="bg-emerald-50 text-emerald-800 border-emerald-200 font-normal max-w-full truncate"
                            data-testid="venue-selected-badge"
                        >
                            {(linkedVenue || selectedVenueMeta)?.name}
                        </Badge>
                        {canManageLocalities && (
                            <p className="text-[11px] text-muted-foreground">
                                {allLocalities.length} localidad{allLocalities.length !== 1 ? "es" : ""}
                                {" · "}
                                Mapa asignable
                            </p>
                        )}
                        {eventSaved && linkedVenue && (event?.tickets_sold || 0) === 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={handleUnlink}
                                disabled={disabled || loadingLink}
                                data-testid="venue-change"
                            >
                                Cambiar mapa
                            </Button>
                        )}
                        {!eventSaved && pendingVenueId && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => onPendingVenueChange?.(null)}
                                data-testid="venue-clear-pending"
                            >
                                Quitar selección
                            </Button>
                        )}
                    </div>
                )}

                {loadingLink && (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vinculando…
                    </p>
                )}

                {!eventSaved && (
                    <CreateFlowSteps
                        selectedVenue={!!selectedVenueId}
                        eventSaved={false}
                    />
                )}

                <Button variant="outline" size="sm" className="w-full" asChild data-testid="venue-create-link">
                    <a href={venueCreateHref(event?.id)}>
                        <PlusCircle className="h-3.5 w-3.5 mr-1.5" /> Nuevo mapa
                    </a>
                </Button>
            </aside>

            {/* ── Right: Localidades ── */}
            <section className="space-y-3 min-w-0" data-testid="localidades-panel">
                {showCreateGate ? (
                    <div
                        className="rounded-xl border bg-card min-h-[280px] flex flex-col items-center justify-center text-center p-8 gap-3"
                        data-testid="localidades-save-gate"
                    >
                        <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center">
                            <Layers className="h-7 w-7 text-muted-foreground" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-base">Localidades y Precios</h3>
                            <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
                                {!selectedVenueId
                                    ? "Primero seleccioná un mapa en Escenario. El mapa solo define la forma; nombre, color y precios son de este evento."
                                    : !eventSaved
                                      ? "Una vez guardado el evento podrás agregar localidades, configurar precios y asignarlas en el mapa del escenario."
                                      : "Vinculando mapa…"}
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <h4 className="font-semibold">Localidades y Precios</h4>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Configuración de este evento (no del mapa maestro). Podés usar solo
                                    algunas zonas del plano.
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" asChild data-testid="venue-assign-map">
                                    <a href={eventMapHref(event.id)}>
                                        <Wand2 className="h-4 w-4 mr-1.5" /> Asignar en Mapa
                                    </a>
                                </Button>
                                <Button size="sm" onClick={openCreateForm} data-testid="locality-add">
                                    <PlusCircle className="h-4 w-4 mr-1.5" /> Nueva Localidad
                                </Button>
                            </div>
                        </div>

                        {/* Optional map preview */}
                        <div className="rounded-xl border bg-card overflow-hidden min-w-0 max-w-full">
                            <button
                                type="button"
                                className="w-full px-4 py-2.5 border-b text-left text-sm flex items-center justify-between hover:bg-secondary/40"
                                onClick={() => setMapOpen((v) => !v)}
                            >
                                <span className="font-medium">Plano del evento</span>
                                <span className="text-xs text-muted-foreground">
                                    {mapOpen ? "Ocultar" : "Mostrar"} · forma del escenario
                                </span>
                            </button>
                            {mapOpen && (
                                <div className="min-w-0 max-w-full">
                                    <EditorCanvas
                                        canvas={canvas}
                                        elements={elements}
                                        localitiesById={localitiesById}
                                        selection={highlightLocality
                                            ? elements.filter((e) => e.locality_id === highlightLocality).map((e) => e.id)
                                            : []}
                                        onSelect={onCanvasSelect}
                                        onUpdate={() => {}}
                                        onTransform={() => {}}
                                        onContextMenu={() => {}}
                                        onCanvasClick={() => setHighlightLocality(null)}
                                        tool="select"
                                        readOnly
                                        height={280}
                                        autoFitKey={event?.id ? `${event.id}:${event.venue_id || ""}` : undefined}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="space-y-3" data-testid="locality-pricing-table">
                            {allLocalities.length === 0 ? (
                                <div className="rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
                                    Todavía no creaste localidades para este evento. Creá las que necesités
                                    (aunque el mapa tenga más secciones) y después asignalas en el mapa.
                                </div>
                            ) : (
                                <div className="rounded-xl border bg-card overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b bg-secondary/40 text-xs text-muted-foreground">
                                                <th className="text-left font-medium px-3 py-2 w-8">#</th>
                                                <th className="text-left font-medium px-3 py-2">Nombre</th>
                                                <th className="text-left font-medium px-3 py-2">Color</th>
                                                <th className="text-right font-medium px-3 py-2">
                                                    <span className="inline-flex items-center justify-end gap-1">
                                                        Entrada
                                                        <FieldTip text={LOCALITY_FIELD_TIPS.price} />
                                                    </span>
                                                </th>
                                                <th className="text-right font-medium px-3 py-2">
                                                    <span className="inline-flex items-center justify-end gap-1">
                                                        Servicio
                                                        <FieldTip text={LOCALITY_FIELD_TIPS.service} />
                                                    </span>
                                                </th>
                                                <th className="text-right font-medium px-3 py-2">
                                                    <span className="inline-flex items-center justify-end gap-1">
                                                        TicketSeguro
                                                        <FieldTip text={LOCALITY_FIELD_TIPS.admin} />
                                                    </span>
                                                </th>
                                                <th className="text-right font-medium px-3 py-2">
                                                    <span className="inline-flex items-center justify-end gap-1">
                                                        Impuestos
                                                        <FieldTip text={LOCALITY_FIELD_TIPS.vxs} />
                                                    </span>
                                                </th>
                                                <th className="text-right font-medium px-3 py-2">
                                                    <span className="inline-flex items-center justify-end gap-1">
                                                        Billetera
                                                        <FieldTip text={LOCALITY_FIELD_TIPS.wallet} />
                                                    </span>
                                                </th>
                                                <th className="text-right font-medium px-3 py-2">Asignados</th>
                                                <th className="px-3 py-2 w-20" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {allLocalities.map((loc, idx) => {
                                                const p = pricing[loc.id] || {};
                                                const assigned = assignedCountByLocality[loc.id] || 0;
                                                const highlighted = highlightLocality === loc.id;
                                                return (
                                                    <tr
                                                        key={loc.id}
                                                        className={`border-b last:border-0 ${highlighted ? "bg-teal-700/5" : ""}`}
                                                        data-testid={`loc-row-${loc.id}`}
                                                        onMouseEnter={() => setHighlightLocality(loc.id)}
                                                    >
                                                        <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                                                        <td className="px-3 py-2 font-medium">{loc.name}</td>
                                                        <td className="px-3 py-2">
                                                            <span
                                                                className="inline-block h-4 w-4 rounded-sm ring-1 ring-border"
                                                                style={{ background: loc.color }}
                                                            />
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums">
                                                            ${centsToInput(p.price_cents) || "0.00"}
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums">
                                                            ${centsToInput(p.service_fee_cents) || "0.00"}
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums">
                                                            ${centsToInput(p.admin_fee_cents) || "0.00"}
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums">
                                                            ${centsToInput(p.vxs_cents) || "0.00"}
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums">
                                                            ${centsToInput(p.wallet_fee_cents) || "0.00"}
                                                        </td>
                                                        <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                                                            {assigned}
                                                        </td>
                                                        <td className="px-3 py-2 text-right whitespace-nowrap">
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-7 w-7"
                                                                onClick={() => openEditForm(loc)}
                                                                disabled={disabled}
                                                                data-testid={`loc-edit-${loc.id}`}
                                                            >
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-7 w-7"
                                                                onClick={() => deleteLocalityRow(loc.id)}
                                                                disabled={disabled || loadingLink}
                                                                data-testid={`loc-delete-${loc.id}`}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {summary && (
                                <p className="text-xs text-muted-foreground" data-testid="locality-summary">
                                    {summary.localityCount} localidad{summary.localityCount !== 1 ? "es" : ""}
                                    {" · "}
                                    capacidad {summary.capacity}
                                    {" · "}
                                    entradas desde ${summary.minPrice.toFixed(2)}
                                    {summary.minPrice !== summary.maxPrice && ` hasta $${summary.maxPrice.toFixed(2)}`}
                                </p>
                            )}
                        </div>
                    </>
                )}
            </section>

            <LocalityFormDialog
                open={formOpen}
                onClose={() => { setFormOpen(false); setEditingLocality(null); }}
                onSubmit={submitLocalityForm}
                initial={editingLocality}
                saving={savingForm}
            />
        </div>
    );
}
