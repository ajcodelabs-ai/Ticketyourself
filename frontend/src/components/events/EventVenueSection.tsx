/**
 * EventVenueSection — pasos 4.1 Escenario, 4.2 Localidades y 4.3 Asignar.
 *
 *  4.1 Selecciona el escenario (mapa = solo la forma)
 *  4.2 Crea localidades (tipo numerada o no numerada, nombre, precio)
 *  4.3 Asigna esas localidades a elementos del mapa (asientos, mesas, zonas)
 *
 * Nombre, color, tipo y precios viven en el evento (`venue_layout.localities` +
 * `locality_pricing`). El venue maestro solo aporta canvas + elementos —
 * agregar filas/mesas/zonas nuevas se hace ahí, no en el mapa del evento.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    MapPin,
    MapPinned,
    Users,
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import api, { formatApiError } from "@/lib/api";
import { venuesApi, eventVenueLayoutApi, computeCapacity, unnumberedCapacityByLocality, elementAcceptsLocality, newId } from "@/lib/venues";
import EditorCanvas from "@/components/venues/EditorCanvas";
import AssignLocalityPanel from "@/components/venues/AssignLocalityPanel";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanFeatures } from "@/hooks/queries/usePlanFeatures";
import { ATTENDANCE_FORMATS, LOCALITY_SEATING_TYPES, elementMatchesSeatingType, inferAttendanceFormatFromLocalities, normalizeLocalitySeatingType, planLayoutSeatingConflict, PLAN_SEATING_COPY } from "@/lib/attendanceFormat";
import LocalityFormDialog from "@/components/events/LocalityFormDialog";
import { PlanGateHint } from "@/components/plans/PlanGate";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { centsToInput } from "@/lib/money";

type LocalityPricingEntry = {
    price_cents?: number;
    service_fee_cents?: number;
    admin_fee_cents?: number;
    vxs_cents?: number;
    wallet_fee_cents?: number;
    max_per_purchase?: number | null;
    reserved_quota?: number;
};

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
        "TicketSeguro: cobertura / seguro por ticket. Se suma al total del comprador. Deja $0 si no aplica.",
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
            title: "Guarda el evento para crear localidades",
            done: eventSaved && selectedVenue,
            active: selectedVenue && !eventSaved,
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

function PlanSeatingNotice({ conflict }: { conflict: "none" | "numbered_unused" | "numbered_only_blocked" }) {
    if (conflict === "none") return null;
    return (
        <div data-testid="plan-seating-conflict" data-conflict={conflict}>
            <PlanGateHint feature="numbered_seating">
                {PLAN_SEATING_COPY[conflict]}
            </PlanGateHint>
        </div>
    );
}

export default function EventVenueSection({
    event,
    disabled,
    onUpdated,
    onReturnFromVenueCreate = undefined,
    onBeforeVenueCreate = undefined,
    pendingVenueId = null,
    onPendingVenueChange = undefined,
    panel = "all",
    // Live, not-yet-saved value of form.attendance_format from the wizard —
    // `event.access_params.attendance_format` only reflects the last SAVE,
    // so using that instead made the selector below look unresponsive: it
    // called onFormatChange correctly on click, but kept rendering the old
    // choice as "selected" until the next persist() round-trip.
    plannedAttendanceFormat = null,
    onFormatChange,
    // Jumps the wizard to the "4.3 Asignar" substep — assigning localities
    // to map elements lives there now, not inline in this panel.
    onGotoAssign = undefined,
}: {
    event: any;
    disabled?: boolean;
    onUpdated?: (e: any) => void;
    onReturnFromVenueCreate?: unknown;
    onBeforeVenueCreate?: () => Promise<unknown> | void;
    pendingVenueId?: string | null;
    onPendingVenueChange?: (id: string | null) => void;
    panel?: "all" | "escenario" | "localidades" | "asignar";
    plannedAttendanceFormat?: string | null;
    onFormatChange?: (format: string) => void;
    onGotoAssign?: () => void;
}) {
    const { organizer } = useAuth();
    const { data: planFeatures } = usePlanFeatures();
    // These links do a full-page navigation away from the wizard (they open
    // the standalone venue editor and come back via `return_to`). Save any
    // unsaved wizard edits first so they aren't lost on the way out.
    //
    // onBeforeVenueCreate (persist(false, {silent:true})) resolves to the
    // saved event on success, or null/undefined when the save was blocked
    // (e.g. missing title) or failed (network/API error) — persist() already
    // toasts why in both cases. Navigating away anyway used to strand the
    // organizer on a *new*, blank event draft (venueCreateHref falls back to
    // "/app/eventos/nuevo" without an id), silently discarding whatever they
    // had typed — the real cause behind "se sale de la configuración actual".
    const goTo = async (href: string) => {
        if (onBeforeVenueCreate) {
            const saved = await onBeforeVenueCreate();
            if (!saved) return;
            toast.message("Evento guardado — vas a crear el mapa y vuelves acá al terminar.");
        }
        window.location.href = href;
    };
    // Escenario is always available. This flag only limits numbered localities.
    const allowNumbered = planFeatures ? Boolean(planFeatures.numbered_seating) : true;
    const tenantSlug = organizer?.slug || event?.tenant_slug;
    const [venues, setVenues] = useState([]);
    const [linkedVenue, setLinkedVenue] = useState(null);
    const [loadingLink, setLoadingLink] = useState(false);
    const [pricing, setPricing] = useState<Record<string, LocalityPricingEntry>>({});
    const [formOpen, setFormOpen] = useState(false);
    const [editingLocality, setEditingLocality] = useState(null);
    const [savingForm, setSavingForm] = useState(false);
    const [feeQuotes, setFeeQuotes] = useState({});
    const [assignSelection, setAssignSelection] = useState<string[]>([]);
    const [savingAssign, setSavingAssign] = useState(false);
    const initializedRef = useRef(false);
    const pricingType = event?.pricing_type || "paid";
    const feeBearer = event?.platform_fee_bearer === "organizer" ? "organizer" : "buyer";

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
                reserved_quota: lp.reserved_quota || 0,
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
                    reserved_quota: 0,
                };
            }
        }
        setPricing(next);
        initializedRef.current = true;
    }, [linkedVenue, event?.locality_pricing]);

    useEffect(() => {
        if (panel === "escenario") return undefined;
        const prices = [
            ...new Set(
                Object.values(pricing || {}).map((p) => Number(p?.price_cents || 0)),
            ),
        ];
        if (!prices.length) {
            setFeeQuotes({});
            return undefined;
        }
        let alive = true;
        api.post("/sales-fees/quote-batch", {
            pricing_type: pricingType,
            prices_cents: prices,
        })
            .then((r) => {
                if (alive) setFeeQuotes(r.data?.quotes || {});
            })
            .catch(() => {
                if (alive) setFeeQuotes({});
            });
        return () => {
            alive = false;
        };
    }, [pricing, pricingType, panel]);

    const allLocalities = useMemo(() => linkedVenue?.localities || [], [linkedVenue]);
    const hasNumbered = useMemo(
        () => allLocalities.some((loc) => normalizeLocalitySeatingType(loc.seating_type) !== "unnumbered"),
        [allLocalities],
    );

    const assignedCountByLocality = useMemo(() => {
        const counts = {};
        for (const el of linkedVenue?.elements || []) {
            if (!el.locality_id) continue;
            counts[el.locality_id] = (counts[el.locality_id] || 0) + 1;
        }
        return counts;
    }, [linkedVenue]);

    const elements = useMemo(() => linkedVenue?.elements || [], [linkedVenue]);
    const layoutElements = useMemo(
        () =>
            linkedVenue?.elements
            || selectedVenueMeta?.elements
            || event?.venue_layout?.elements
            || [],
        [linkedVenue, selectedVenueMeta, event?.venue_layout],
    );
    const seatingConflict = useMemo(
        () => planLayoutSeatingConflict(layoutElements, allowNumbered),
        [layoutElements, allowNumbered],
    );
    const canvas = useMemo(
        () => linkedVenue?.canvas || { width: 1000, height: 600 },
        [linkedVenue],
    );

    const summary = useMemo(() => {
        if (allLocalities.length === 0) return null;
        const prices = allLocalities.map((l) => pricing[l.id]?.price_cents ?? 0);
        const reservedTotal = allLocalities.reduce(
            (s, l) => s + (pricing[l.id]?.reserved_quota || 0),
            0,
        );
        return {
            capacity: Math.max(0, computeCapacity(elements) - reservedTotal),
            reservedTotal,
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

    const persistLayout = async (nextElements, nextLocalities) => {
        if (!event?.id || !linkedVenue) return null;
        return eventVenueLayoutApi.put(event.id, {
            canvas: linkedVenue.canvas || { width: 1000, height: 600 },
            elements: nextElements,
            localities: nextLocalities,
        });
    };

    const persistLocalities = async (nextLocalities) => {
        if (!linkedVenue) return null;
        return persistLayout(linkedVenue.elements || [], nextLocalities);
    };

    const syncGaTicketTypes = async (eventId, localitiesList, pricingMap, layoutElements) => {
        try {
            const existing = (await api.get(`/events/me/${eventId}/ticket-types`)).data || [];
            const byLoc = {};
            for (const t of existing) {
                if (t.venue_locality_id) byLoc[t.venue_locality_id] = t;
            }
            for (const loc of localitiesList) {
                const seating = normalizeLocalitySeatingType(loc.seating_type);
                if (seating === "numbered") continue;
                const payload = {
                    name: loc.name,
                    color: loc.color,
                    price_cents: pricingMap[loc.id]?.price_cents ?? loc.default_price_cents ?? 0,
                    venue_locality_id: loc.id,
                    capacity: unnumberedCapacityByLocality(layoutElements, loc.id) || undefined,
                };
                if (byLoc[loc.id]) {
                    await api.put(`/events/me/${eventId}/ticket-types/${byLoc[loc.id].id}`, payload);
                } else {
                    await api.post(`/events/me/${eventId}/ticket-types`, payload);
                }
            }
        } catch {
            // Checkout still uses ticket types for GA; don't block locality save.
        }
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
                reserved_quota: Math.max(0, parseInt(row.reserved_quota ?? 0, 10) || 0),
            };
        });

    const selectVenue = async (vid: string) => {
        if (!vid) return;
        const v = venues.find((x) => x.id === vid);
        const conflict = planLayoutSeatingConflict(v?.elements, allowNumbered);
        const warnPlan = () => {
            if (conflict !== "none") {
                toast.warning(PLAN_SEATING_COPY[conflict], { duration: 8000 });
            }
        };

        // Create flow: remember selection until the event is saved.
        if (!event?.id) {
            onPendingVenueChange?.(vid);
            warnPlan();
            if (conflict === "none") {
                toast.message("Escenario seleccionado. Guarda el evento para continuar.");
            }
            return;
        }

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
            warnPlan();
            if (conflict === "none") {
                toast.success("Mapa vinculado — ahora crea las localidades del evento");
            }
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

    const saveFeeBearer = async (next) => {
        if (!event?.id || next === feeBearer) return;
        try {
            const r = await api.put(`/events/me/${event.id}`, {
                platform_fee_bearer: next,
            });
            onUpdated?.(r.data);
            toast.success(
                next === "organizer"
                    ? "La comisión TYS la absorbes tú. El comprador no la ve."
                    : "La comisión TYS se suma al total del comprador.",
            );
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || "No se pudo guardar quién paga el fee.");
        }
    };

    // TI-91: moved from the General tab's content panel — this only applies
    // to numbered maps, so it belongs where localities/seating are
    // configured. `content` is a full JSONB blob on the event (the backend
    // replaces it wholesale on PUT), so every existing field must be spread
    // back in, not just the one being toggled.
    const saveGroupPurchase = async (next) => {
        if (!event?.id) return;
        try {
            const r = await api.put(`/events/me/${event.id}`, {
                content: { ...(event.content || {}), allow_full_group_purchase: next },
            });
            onUpdated?.(r.data);
            toast.success(
                next
                    ? "Activado — el comprador puede comprar filas/mesas completas"
                    : "Desactivado — selección individual de asientos",
            );
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || "No se pudo guardar la opción.");
        }
    };

    const openEditForm = (loc) => {
        const p = pricing[loc.id] || {};
        setEditingLocality({
            id: loc.id,
            name: loc.name,
            color: loc.color,
            description: loc.description,
            seating_type: normalizeLocalitySeatingType(loc.seating_type),
            price_cents: p.price_cents,
            vxs_cents: p.vxs_cents,
            service_fee_cents: p.service_fee_cents,
            admin_fee_cents: p.admin_fee_cents,
            wallet_fee_cents: p.wallet_fee_cents,
            reserved_quota: p.reserved_quota || 0,
        });
        setFormOpen(true);
    };

    const submitLocalityForm = async (values) => {
        if (!linkedVenue) return;
        setSavingForm(true);
        try {
            const locId = values.id || editingLocality?.id || newId();
            const isEdit = allLocalities.some((l) => l.id === locId);
            const newSeatingType = normalizeLocalitySeatingType(values.seating_type);
            const entry = {
                id: locId,
                name: values.name,
                color: values.color,
                description: values.description,
                default_price_cents: values.price_cents,
                seating_type: newSeatingType,
            };
            const nextLocalities = isEdit
                ? allLocalities.map((l) => (l.id === locId ? { ...l, ...entry } : l))
                : [...allLocalities, entry];
            // Creating a locality never touches map elements — assignment
            // always happens afterward in "4.3 Asignar". Editing one can
            // change its seating type though, which can make some of its
            // existing assignments invalid (e.g. numbered -> unnumbered no
            // longer matches an assigned seat row) — unassign only those.
            let unassignedCount = 0;
            const nextElements = isEdit
                ? (linkedVenue.elements || []).map((e) => {
                      if (e.locality_id !== locId) return e;
                      if (elementMatchesSeatingType(e.kind, newSeatingType)) return e;
                      unassignedCount += 1;
                      return { ...e, locality_id: null };
                  })
                : linkedVenue.elements || [];

            await persistLayout(nextElements, nextLocalities);

            const nextPricing = {
                ...pricing,
                [locId]: {
                    price_cents: values.price_cents,
                    service_fee_cents: values.service_fee_cents,
                    admin_fee_cents: values.admin_fee_cents,
                    vxs_cents: values.vxs_cents,
                    wallet_fee_cents: values.wallet_fee_cents,
                    max_per_purchase: pricing[locId]?.max_per_purchase ?? null,
                    reserved_quota: values.reserved_quota || 0,
                },
            };

            // Only reflect the new price in the UI once the backend actually
            // accepts it (e.g. a Gratuito event rejects nonzero pricing) —
            // updating state before persistLink resolves would show a price
            // as "saved" that the server just rejected.
            await persistLink({
                venue_id: linkedVenue.id,
                locality_pricing: pricingPayload(nextPricing, nextLocalities),
                seat_holds_window_minutes: event?.seat_holds_window_minutes || 10,
            });
            setPricing(nextPricing);
            await syncGaTicketTypes(event.id, nextLocalities, nextPricing, nextElements);
            onFormatChange?.(inferAttendanceFormatFromLocalities(nextLocalities));

            if (isEdit) {
                toast.success(
                    unassignedCount > 0
                        ? `Localidad actualizada — se desasignaron ${unassignedCount} elemento(s) que ya no coinciden con el tipo`
                        : "Localidad actualizada",
                );
            } else {
                toast.success("Localidad creada", {
                    description: "Asígnala a asientos, mesas o zonas en \"4.3 Asignar\".",
                    action: onGotoAssign
                        ? { label: "4.3 Asignar", onClick: onGotoAssign }
                        : undefined,
                });
            }
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
            await persistLink({
                venue_id: linkedVenue.id,
                locality_pricing: pricingPayload(nextPricing, nextLocalities),
                seat_holds_window_minutes: event?.seat_holds_window_minutes || 10,
            });
            setPricing(nextPricing);
            onFormatChange?.(inferAttendanceFormatFromLocalities(nextLocalities));
            toast.success("Localidad borrada");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo borrar la localidad.");
        } finally {
            setLoadingLink(false);
        }
    };

    // ── 4.3 Asignar: map element <-> locality assignment ────────────────────
    // Saves immediately per action (not batched), matching the reference
    // app's assignment screen — persistLayout alone doesn't refresh
    // `linkedVenue` (only persistLink's onUpdated round-trip does), so every
    // handler below calls both.
    const persistElementsChange = async (nextElements) => {
        await persistLayout(nextElements, allLocalities);
        await persistLink({
            venue_id: linkedVenue.id,
            locality_pricing: pricingPayload(pricing, allLocalities),
            seat_holds_window_minutes: event?.seat_holds_window_minutes || 10,
        });
    };

    const handleAssignSelect = (ids, { additive, replace }: { additive?: boolean; replace?: boolean } = {}) => {
        setAssignSelection((prev) => {
            if (replace || !additive) return ids;
            const set = new Set(prev);
            ids.forEach((id) => (set.has(id) ? set.delete(id) : set.add(id)));
            return [...set];
        });
    };

    const assignLocalityToSelection = async (locId) => {
        const affected = elements.filter(
            (e) => assignSelection.includes(e.id) && elementAcceptsLocality(e.kind),
        );
        if (!affected.length) {
            toast.error("Selecciona elementos asignables (zonas, asientos, mesas).");
            return;
        }
        setSavingAssign(true);
        try {
            const nextElements = elements.map((e) =>
                assignSelection.includes(e.id) && elementAcceptsLocality(e.kind)
                    ? { ...e, locality_id: locId }
                    : e,
            );
            await persistElementsChange(nextElements);
            toast.success(
                `${affected.length} elemento(s) asignado(s) a "${localitiesById[locId]?.name || "localidad"}".`,
            );
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo asignar.");
        } finally {
            setSavingAssign(false);
        }
    };

    const clearLocalityFromSelection = async () => {
        const affected = elements.filter((e) => assignSelection.includes(e.id) && e.locality_id);
        if (!affected.length) {
            toast.error("Selecciona elementos con localidad asignada.");
            return;
        }
        setSavingAssign(true);
        try {
            const nextElements = elements.map((e) =>
                assignSelection.includes(e.id) ? { ...e, locality_id: null } : e,
            );
            await persistElementsChange(nextElements);
            toast.success(`Se quitó la localidad de ${affected.length} elemento(s).`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo quitar la asignación.");
        } finally {
            setSavingAssign(false);
        }
    };

    const clearLocalityAssignments = async (locId) => {
        const n = elements.filter((e) => e.locality_id === locId).length;
        if (!n) return;
        setSavingAssign(true);
        try {
            const nextElements = elements.map((e) =>
                e.locality_id === locId ? { ...e, locality_id: null } : e,
            );
            await persistElementsChange(nextElements);
            toast.success(`Se quitó la asignación de ${n} elemento(s).`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo quitar la asignación.");
        } finally {
            setSavingAssign(false);
        }
    };

    const clearAllLocalityAssignments = async () => {
        const n = elements.filter((e) => e.locality_id).length;
        if (!n) return;
        const ok = window.confirm("¿Quitar todas las asignaciones de localidades del mapa?");
        if (!ok) return;
        setSavingAssign(true);
        try {
            const nextElements = elements.map((e) => ({ ...e, locality_id: null }));
            await persistElementsChange(nextElements);
            toast.success("Mapa sin asignaciones");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo limpiar.");
        } finally {
            setSavingAssign(false);
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
            toast.error("No puedes cambiar el mapa una vez que hay ventas confirmadas.");
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

    const localitiesById = useMemo(() => {
        const m = {};
        for (const l of allLocalities) m[l.id] = l;
        return m;
    }, [allLocalities]);

    const canManageLocalities = eventSaved && !!linkedVenue;
    const showCreateGate = !canManageLocalities;

    const showEscenario = panel === "all" || panel === "escenario";
    const showLocalidades = panel === "all" || panel === "localidades";
    const showAsignar = panel === "all" || panel === "asignar";

    const emptyState = (
        <div className="rounded-xl border-2 border-dashed p-8 bg-card text-center space-y-4" data-testid="venue-empty-state">
            <div className="mx-auto h-14 w-14 rounded-full bg-teal-50 flex items-center justify-center">
                <Building2 className="h-7 w-7 text-teal-800" />
            </div>
            <div className="space-y-1">
                <h3 className="font-semibold text-lg">Todavía no tienes un mapa</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Crea un mapa (la forma del lugar), publicalo y vuelve acá. Las localidades y precios
                    los configuras por evento.
                </p>
            </div>
            <Button size="lg" data-testid="venue-create-cta" onClick={() => goTo(venueCreateHref(event?.id))}>
                <PlusCircle className="h-5 w-5 mr-2" />
                Crear mapa
                <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
        </div>
    );

    const currentFormat = inferAttendanceFormatFromLocalities(allLocalities);
    const formatInfo = ATTENDANCE_FORMATS[currentFormat];
    const hasAnyLocalities = allLocalities.length > 0;
    // Before any locality exists, "numbered vs. aforo general" isn't defined
    // by anything real yet — this is the organizer's upfront intent. Prefer
    // the wizard's live (unsaved) form value so clicking a card reflects
    // immediately; fall back to the last-saved value for callers that don't
    // pass it (or once the draft has actually been persisted).
    const plannedFormat =
        (plannedAttendanceFormat ?? event?.access_params?.attendance_format) === "general"
            ? "general"
            : "numbered";

    const seatingChoice = (
        <div className="space-y-2" data-testid="attendance-format-picker">
            <Label className="text-xs">Tipo de evento *</Label>
            <div className="grid sm:grid-cols-2 gap-2">
                {[
                    { value: "numbered", title: "Numerado", desc: "El comprador elige su butaca en un mapa.", Icon: MapPinned },
                    { value: "general", title: "Aforo general", desc: "El comprador elige cantidad, sin butaca asignada.", Icon: Users },
                ].map(({ value, title, desc, Icon }) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => onFormatChange?.(value)}
                        disabled={disabled || (value === "numbered" && !allowNumbered)}
                        className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition disabled:opacity-50 disabled:cursor-not-allowed ${
                            plannedFormat === value
                                ? "border-primary bg-primary/5"
                                : "hover:bg-secondary/40"
                        }`}
                        data-testid={`attendance-format-${value}`}
                    >
                        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div>
                            <p className="text-sm font-medium">{title}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
                        </div>
                    </button>
                ))}
            </div>
            {!allowNumbered && (
                <p className="text-[11px] text-muted-foreground">
                    Tu plan no incluye asientos numerados — solo puedes elegir aforo general.
                </p>
            )}
        </div>
    );

    const seatingStatus = (
        <div
            className="flex items-start gap-2.5 rounded-lg border bg-secondary/30 px-3 py-2.5"
            data-testid="attendance-format-indicator"
        >
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="text-xs">
                <p className="font-medium text-foreground">
                    Este evento es: {formatInfo.title}
                </p>
                <p className="text-muted-foreground mt-0.5">
                    {formatInfo.description} Ya definido por las localidades creadas en
                    &quot;4.2 Localidades&quot; — borralas todas para volver a elegir el tipo.
                </p>
            </div>
        </div>
    );

    const escenarioPanel = (
        <div className="rounded-xl border bg-card p-5 space-y-4" data-testid="escenario-panel">
            <div>
                <h4 className="font-semibold text-base">Escenario</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Elige el mapa del lugar. En el paso siguiente creas las localidades y las asignas al plano.
                </p>
            </div>

            {hasAnyLocalities ? seatingStatus : seatingChoice}

            <div className="space-y-1.5">
                <Label className="text-xs">Mapa / Lugar *</Label>
                <Select
                    value={selectedVenueId || undefined}
                    onValueChange={selectVenue}
                    disabled={disabled || loadingLink || (event?.tickets_sold || 0) > 0}
                >
                    <SelectTrigger data-testid="wiz-venue-select">
                        <SelectValue placeholder="Elige un mapa publicado…" />
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

            <PlanSeatingNotice conflict={seatingConflict} />

            {(selectedVenueMeta || linkedVenue) && (
                <div className="flex flex-wrap items-center gap-2">
                    <Badge
                        variant="secondary"
                        className="bg-emerald-50 text-emerald-800 border-emerald-200 font-normal max-w-full truncate"
                        data-testid="venue-selected-badge"
                    >
                        {(linkedVenue || selectedVenueMeta)?.name}
                    </Badge>
                    {canManageLocalities && (
                        <span className="text-[11px] text-muted-foreground">
                            {allLocalities.length} localidad{allLocalities.length !== 1 ? "es" : ""}
                        </span>
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

            <Button
                variant="outline"
                size="sm"
                data-testid="venue-create-link"
                onClick={() => goTo(venueCreateHref(event?.id))}
            >
                <PlusCircle className="h-3.5 w-3.5 mr-1.5" /> Nuevo mapa
            </Button>
        </div>
    );

    const localidadesPanel = (
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
                        <h3 className="font-semibold text-base">Creación de localidades</h3>
                        <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
                            {!selectedVenueId
                                ? "Primero selecciona un escenario en el paso 4.1. El mapa define la forma; nombre, tipo y precios son de este evento."
                                : !eventSaved
                                  ? "Guarda el borrador para vincular el mapa. Después creas las localidades (numerada o no numerada) en este paso, y las asignas al plano en \"4.3 Asignar\"."
                                  : "Vinculando mapa…"}
                        </p>
                    </div>
                    {selectedVenueId ? <PlanSeatingNotice conflict={seatingConflict} /> : null}
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                            <h4 className="font-semibold">Localidades</h4>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Cada localidad es numerada o no numerada, con su precio.
                                Asignala al mapa en &quot;4.3 Asignar&quot;. Un evento mixto
                                se arma combinando ambos tipos.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            {onGotoAssign && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    data-testid="venue-goto-assign"
                                    onClick={onGotoAssign}
                                >
                                    <Wand2 className="h-4 w-4 mr-1.5" /> 4.3 Asignar
                                </Button>
                            )}
                            <Button
                                size="sm"
                                onClick={openCreateForm}
                                disabled={disabled || seatingConflict === "numbered_only_blocked"}
                                data-testid="locality-add"
                            >
                                <PlusCircle className="h-4 w-4 mr-1.5" /> Nueva Localidad
                            </Button>
                        </div>
                    </div>

                    <PlanSeatingNotice conflict={seatingConflict} />

                    <div className="space-y-3" data-testid="locality-pricing-table">
                        {allLocalities.length === 0 ? (
                            <div className="rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
                                {seatingConflict === "numbered_only_blocked"
                                    ? "Este mapa solo tiene butacas y tu plan no las vende. Elige un escenario con zonas de aforo o mejora el plan."
                                    : seatingConflict === "numbered_unused"
                                      ? "Crea una localidad no numerada y después asignala a las zonas de aforo en \"4.3 Asignar\". Las butacas de este mapa no se venden con tu plan actual."
                                      : "Crea una localidad — elige si es numerada o no numerada — y después asignala al mapa en \"4.3 Asignar\"."}
                            </div>
                        ) : (
                            <div className="rounded-xl border bg-card overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b bg-secondary/40 text-xs text-muted-foreground">
                                            <th className="text-left font-medium px-3 py-2 w-8">#</th>
                                            <th className="text-left font-medium px-3 py-2">Nombre</th>
                                            <th className="text-left font-medium px-3 py-2">Tipo</th>
                                            <th className="text-left font-medium px-3 py-2">Color</th>
                                            <th className="text-right font-medium px-3 py-2">
                                                <span className="inline-flex items-center justify-end gap-1">
                                                    Entrada
                                                    <FieldTip text={LOCALITY_FIELD_TIPS.price} />
                                                </span>
                                            </th>
                                            <th className="text-right font-medium px-3 py-2">
                                                <span className="inline-flex items-center justify-end gap-1">
                                                    Comisión TYS
                                                    <FieldTip text="Comisión TYS por boleto: monto fijo o porcentaje, según la regla del admin para tu plan, tipo de evento y precio." />
                                                </span>
                                            </th>
                                            <th className="text-right font-medium px-3 py-2">
                                                <span className="inline-flex items-center justify-end gap-1">
                                                    Servicio
                                                    <FieldTip text={LOCALITY_FIELD_TIPS.service} />
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
                                            const seating = normalizeLocalitySeatingType(loc.seating_type);
                                            return (
                                                <tr
                                                    key={loc.id}
                                                    className="border-b last:border-0"
                                                    data-testid={`loc-row-${loc.id}`}
                                                >
                                                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                                                    <td className="px-3 py-2 font-medium">{loc.name}</td>
                                                    <td className="px-3 py-2">
                                                        <Badge variant="outline" className="font-normal text-[10px]">
                                                            {LOCALITY_SEATING_TYPES[seating]?.title || seating}
                                                        </Badge>
                                                    </td>
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
                                                        {feeQuotes[String(p.price_cents || 0)]
                                                            ? `$${centsToInput(feeQuotes[String(p.price_cents || 0)].fee_cents)}`
                                                            : "—"}
                                                    </td>
                                                    <td className="px-3 py-2 text-right tabular-nums">
                                                        ${centsToInput(p.service_fee_cents) || "0.00"}
                                                    </td>
                                                    <td className="px-3 py-2 text-right tabular-nums">
                                                        {assigned === 0 ? (
                                                            <span
                                                                className="inline-flex items-center gap-1 text-amber-700"
                                                                title="Sin nada asignado en el mapa — no vas a poder publicar el evento hasta asignarle asientos, mesas o una zona en '4.3 Asignar'."
                                                                data-testid={`loc-unassigned-${loc.id}`}
                                                            >
                                                                <Info className="h-3.5 w-3.5" />
                                                                0
                                                            </span>
                                                        ) : (
                                                            <span className="text-muted-foreground">{assigned}</span>
                                                        )}
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
                                {summary.reservedTotal > 0 && ` (${summary.reservedTotal} reservados)`}
                                {" · "}
                                entradas desde ${summary.minPrice.toFixed(2)}
                                {summary.minPrice !== summary.maxPrice && ` hasta $${summary.maxPrice.toFixed(2)}`}
                            </p>
                        )}

                        {eventSaved && allLocalities.length > 0 && pricingType !== "free" ? (
                            <div
                                className="rounded-xl border bg-card p-4 space-y-3"
                                data-testid="platform-fee-bearer"
                            >
                                <div>
                                    <h4 className="text-sm font-semibold">¿Quién paga la comisión TYS?</h4>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Se calcula por cada entrada según tu plan, el tipo de evento y el precio.
                                        No incluye cargo de servicio ni TicketSeguro.
                                    </p>
                                </div>
                                <RadioGroup
                                    value={feeBearer}
                                    onValueChange={(v) => !disabled && saveFeeBearer(v)}
                                    className="grid sm:grid-cols-2 gap-2"
                                    disabled={disabled}
                                >
                                    <label
                                        className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${
                                            feeBearer === "buyer" ? "border-teal-700 bg-teal-700/5" : ""
                                        }`}
                                    >
                                        <RadioGroupItem value="buyer" id="fee-bearer-buyer" className="mt-0.5" />
                                        <div>
                                            <div className="text-sm font-medium">El comprador</div>
                                            <p className="text-[11px] text-muted-foreground leading-snug">
                                                Se suma al total en el checkout.
                                            </p>
                                        </div>
                                    </label>
                                    <label
                                        className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${
                                            feeBearer === "organizer" ? "border-teal-700 bg-teal-700/5" : ""
                                        }`}
                                    >
                                        <RadioGroupItem value="organizer" id="fee-bearer-organizer" className="mt-0.5" />
                                        <div>
                                            <div className="text-sm font-medium">Yo (organizador)</div>
                                            <p className="text-[11px] text-muted-foreground leading-snug">
                                                El comprador paga solo la entrada; la comisión se descuenta de tu liquidación.
                                            </p>
                                        </div>
                                    </label>
                                </RadioGroup>
                            </div>
                        ) : null}

                        {eventSaved && hasNumbered && (
                            <div
                                className="rounded-xl border bg-card p-4 space-y-3"
                                data-testid="section-group-purchase"
                            >
                                <div>
                                    <h4 className="text-sm font-semibold">Compra de fila / mesa completa</h4>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Permite al comprador seleccionar una fila o mesa entera desde la
                                        página del evento (sólo para eventos con mapa de asientos numerados).
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id="allow-group-purchase"
                                        checked={!!event?.content?.allow_full_group_purchase}
                                        disabled={disabled}
                                        onCheckedChange={saveGroupPurchase}
                                        data-testid="content-allow-group-purchase"
                                    />
                                    <Label htmlFor="allow-group-purchase" className="cursor-pointer">
                                        {event?.content?.allow_full_group_purchase
                                            ? "Activo — el comprador puede comprar filas/mesas completas"
                                            : "Inactivo — selección individual de asientos"}
                                    </Label>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </section>
    );

    const asignarPanel = (
        <section className="space-y-3 min-w-0" data-testid="asignar-panel">
            {showCreateGate ? (
                <div
                    className="rounded-xl border bg-card min-h-[280px] flex flex-col items-center justify-center text-center p-8 gap-3"
                    data-testid="asignar-save-gate"
                >
                    <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center">
                        <Wand2 className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold text-base">Asignar al mapa</h3>
                    <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
                        Primero vincula un escenario en 4.1 y crea al menos una localidad
                        en 4.2 — recién ahí hay algo que asignar.
                    </p>
                </div>
            ) : allLocalities.length === 0 ? (
                <div
                    className="rounded-xl border bg-card min-h-[280px] flex flex-col items-center justify-center text-center p-8 gap-3"
                    data-testid="asignar-empty-gate"
                >
                    <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center">
                        <Wand2 className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold text-base">Asignar al mapa</h3>
                    <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
                        Todavía no creaste ninguna localidad. Volvé a 4.2 Localidades para
                        crear una — ahí eliges nombre, tipo y precio.
                    </p>
                </div>
            ) : (
                <>
                    <div>
                        <h4 className="font-semibold">Asignar al mapa</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Selecciona elementos del mapa (clic, o Shift+arrastrar) y
                            asígnalos a una localidad. Cada asignación se guarda al
                            instante. Para agregar filas, mesas o zonas nuevas, edita el
                            escenario maestro desde &quot;Mapas&quot;.
                        </p>
                    </div>
                    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-3 min-w-0">
                        <div
                            className="rounded-xl border overflow-hidden min-w-0 max-w-full relative"
                            data-testid="asignar-canvas-wrap"
                        >
                            <EditorCanvas
                                canvas={canvas}
                                elements={elements}
                                localitiesById={localitiesById}
                                selection={assignSelection}
                                onSelect={handleAssignSelect}
                                onUpdate={() => {}}
                                onTransform={() => {}}
                                onContextMenu={() => {}}
                                onCanvasClick={() => setAssignSelection([])}
                                tool="select"
                                readOnly={disabled}
                                height={520}
                                autoFitKey={event?.id ? `asignar:${event.id}` : undefined}
                            />
                            {savingAssign && (
                                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            )}
                        </div>
                        <aside className="lg:sticky lg:top-3 lg:self-start min-w-0">
                            <div className="rounded-xl border bg-card p-4 flex flex-col min-h-0 max-h-[560px]">
                                <AssignLocalityPanel
                                    localities={allLocalities}
                                    elements={elements}
                                    selection={assignSelection}
                                    pricingById={pricing}
                                    onAssign={assignLocalityToSelection}
                                    onClearSelection={clearLocalityFromSelection}
                                    onClearLocality={clearLocalityAssignments}
                                    onClearAll={clearAllLocalityAssignments}
                                    readOnly={disabled || savingAssign}
                                />
                            </div>
                        </aside>
                    </div>
                </>
            )}
        </section>
    );

    if (venues.length === 0 && !linkedVenue && !pendingVenueId && showEscenario) {
        return emptyState;
    }

    return (
        <div className="space-y-4" data-testid="venue-localidades-layout">
            {showEscenario ? escenarioPanel : null}
            {showLocalidades ? localidadesPanel : null}
            {showAsignar ? asignarPanel : null}
            <LocalityFormDialog
                open={formOpen}
                onClose={() => { setFormOpen(false); setEditingLocality(null); }}
                onSubmit={submitLocalityForm}
                initial={editingLocality}
                saving={savingForm}
                elements={elements}
                allowNumbered={allowNumbered}
                pricingType={pricingType}
                feeBearer={feeBearer}
                defaultSeatingType={plannedFormat === "general" ? "unnumbered" : "numbered"}
            />
        </div>
    );
}
