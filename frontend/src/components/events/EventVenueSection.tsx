/**
 * EventVenueSection — Mapa + precios por localidad (paso Localidades).
 *
 * Flujo claro:
 *  1) Elegir / vincular mapa publicado
 *  2) Ver plano (copia del evento) + editar en mapa
 *  3) Definir precios por localidad en tarjetas simples
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    MapPin,
    Loader2,
    Unlink,
    PlusCircle,
    Building2,
    ArrowRight,
    Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import { venuesApi, computeCapacity } from "@/lib/venues";
import EditorCanvas from "@/components/venues/EditorCanvas";
import { useAuth } from "@/contexts/AuthContext";

function activeLocalityIds(venue): Set<string> {
    const out = new Set<string>();
    for (const el of venue?.elements || []) if (el.locality_id) out.add(el.locality_id as string);
    return out;
}

function dollarsToCents(v: string): number {
    if (v === "" || v == null) return 0;
    return Math.max(0, Math.round(parseFloat(v) * 100) || 0);
}

function centsToInput(cents: number | null | undefined): string {
    if (cents == null) return "";
    return (cents / 100).toFixed(2);
}

function VenueCard({ venue, onSelect }) {
    const localityCount = (venue.localities || []).length;
    return (
        <button
            type="button"
            onClick={() => onSelect(venue.id)}
            className="text-left rounded-xl border p-4 transition hover:border-foreground/30 hover:bg-secondary/40"
            data-testid={`venue-card-${venue.slug}`}
        >
            <div className="font-medium leading-snug">{venue.name}</div>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                {venue.description || "Sin descripción"}
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{venue.capacity_calculated || 0} asientos</span>
                <span>{localityCount} localidad{localityCount !== 1 ? "es" : ""}</span>
            </div>
        </button>
    );
}

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

function MoneyInput({ label, value, onChange, onBlur, disabled, testid, hint = undefined }) {
    return (
        <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-normal">{label}</Label>
            <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="pl-6 h-9"
                    value={centsToInput(value)}
                    onChange={(e) => onChange(dollarsToCents(e.target.value))}
                    onBlur={onBlur}
                    disabled={disabled}
                    data-testid={testid}
                />
            </div>
            {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
        </div>
    );
}

export default function EventVenueSection({ event, disabled, onUpdated, onReturnFromVenueCreate = undefined }) {
    const { organizer } = useAuth();
    const tenantSlug = organizer?.slug || event?.tenant_slug;
    const [venues, setVenues] = useState([]);
    const [linkedVenue, setLinkedVenue] = useState(null);
    const [loadingLink, setLoadingLink] = useState(false);
    const [highlightLocality, setHighlightLocality] = useState(null);
    const [mapOpen, setMapOpen] = useState(true);
    const [pricing, setPricing] = useState({});
    const initializedRef = useRef(false);

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
                max_per_purchase: lp.max_tickets_per_purchase ?? null,
            };
        }
        for (const loc of linkedVenue.localities || []) {
            if (!next[loc.id]) {
                next[loc.id] = {
                    price_cents: loc.default_price_cents || 0,
                    service_fee_cents: 0,
                    admin_fee_cents: 0,
                    max_per_purchase: null,
                };
            }
        }
        setPricing(next);
        initializedRef.current = true;
    }, [linkedVenue, event?.locality_pricing]);

    const localitiesActive = useMemo(() => {
        if (!linkedVenue) return [];
        const activeIds = activeLocalityIds(linkedVenue);
        return (linkedVenue.localities || []).filter((l) => activeIds.has(l.id));
    }, [linkedVenue]);

    const localitiesById = useMemo(() => {
        const m = {};
        for (const l of linkedVenue?.localities || []) m[l.id] = l;
        return m;
    }, [linkedVenue]);

    const elements = useMemo(() => linkedVenue?.elements || [], [linkedVenue]);
    const canvas = useMemo(
        () => linkedVenue?.canvas || { width: 1000, height: 600 },
        [linkedVenue],
    );

    const summary = useMemo(() => {
        if (localitiesActive.length === 0) return null;
        const prices = localitiesActive.map((l) => pricing[l.id]?.price_cents ?? 0);
        return {
            capacity: computeCapacity(elements),
            localityCount: localitiesActive.length,
            minPrice: Math.min(...prices) / 100,
            maxPrice: Math.max(...prices) / 100,
        };
    }, [localitiesActive, pricing, elements]);

    const persistLink = async (next) => {
        if (!event?.id) return;
        setLoadingLink(true);
        try {
            const r = await api.put(`/events/me/${event.id}/venue`, next);
            onUpdated?.(r.data);
            toast.success("Mapa y precios guardados");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo guardar el mapa.");
        } finally {
            setLoadingLink(false);
        }
    };

    const selectVenue = async (vid) => {
        const v = venues.find((x) => x.id === vid);
        if (!v) return;
        const activeIds = activeLocalityIds(v);
        const body = {
            venue_id: vid,
            locality_pricing: Array.from(activeIds).map((id) => {
                const loc = v.localities?.find((l) => l.id === id);
                return {
                    locality_id: id,
                    price_cents: loc?.default_price_cents || 0,
                    service_fee_cents: 0,
                    admin_fee_cents: 0,
                    max_tickets_per_purchase: null,
                };
            }),
            seat_holds_window_minutes: 10,
        };
        await persistLink(body);
    };

    const updatePricing = (locId, patch) =>
        setPricing((p) => ({ ...p, [locId]: { ...p[locId], ...patch } }));

    const savePricing = async () => {
        if (!linkedVenue) return;
        const activeIds = activeLocalityIds(linkedVenue);
        const body = {
            venue_id: linkedVenue.id,
            locality_pricing: Array.from(activeIds).map((id) => {
                const locId = String(id);
                const row = pricing[locId] || {};
                return {
                    locality_id: locId,
                    price_cents: Math.max(0, parseInt(row.price_cents ?? 0, 10) || 0),
                    service_fee_cents: Math.max(0, parseInt(row.service_fee_cents ?? 0, 10) || 0),
                    admin_fee_cents: Math.max(0, parseInt(row.admin_fee_cents ?? 0, 10) || 0),
                    max_tickets_per_purchase:
                        row.max_per_purchase != null
                            ? Math.max(1, parseInt(row.max_per_purchase, 10) || 0) || null
                            : null,
                };
            }),
            seat_holds_window_minutes: 10,
        };
        await persistLink(body);
    };

    const handleUnlink = async () => {
        const ok = window.confirm(
            "¿Desvincular el mapa del evento? Los precios por localidad se perderán.",
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

    if (venues.length === 0 && !linkedVenue) {
        return (
            <div className="rounded-xl border-2 border-dashed p-8 bg-card text-center space-y-4" data-testid="venue-empty-state">
                <div className="mx-auto h-14 w-14 rounded-full bg-teal-50 flex items-center justify-center">
                    <Building2 className="h-7 w-7 text-teal-800" />
                </div>
                <div className="space-y-1">
                    <h3 className="font-semibold text-lg">Todavía no tenés un mapa</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        Creá un mapa (podés partir de una plantilla), publicalo y volvé acá para vincularlo.
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

    if (!linkedVenue) {
        return (
            <div className="space-y-4 rounded-xl border p-5 bg-card" data-testid="venue-picker">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h4 className="font-medium">Elegí un mapa publicado</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Al vincularlo se crea una copia solo para este evento.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" asChild data-testid="venue-create-link">
                        <a href={venueCreateHref(event?.id)}>
                            <PlusCircle className="h-4 w-4 mr-1.5" /> Nuevo mapa
                        </a>
                    </Button>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {venues.map((v) => (
                        <VenueCard key={v.id} venue={v} onSelect={selectVenue} />
                    ))}
                </div>
                {loadingLink && (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Vinculando mapa…
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-5" data-testid="venue-linked">
            {/* Linked map header */}
            <div className="rounded-xl border p-4 bg-card flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-teal-50 flex items-center justify-center shrink-0">
                        <MapPin className="h-5 w-5 text-teal-800" />
                    </div>
                    <div className="min-w-0">
                        <div className="font-semibold leading-tight truncate">{linkedVenue.name}</div>
                        <div className="text-xs text-muted-foreground">
                            {summary?.capacity ?? linkedVenue.capacity_calculated} asientos
                            {" · "}
                            {localitiesActive.length} localidad{localitiesActive.length !== 1 ? "es" : ""}
                        </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">Copia del evento</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="default" size="sm" asChild data-testid="venue-assign-map">
                        <a href={event?.id ? eventMapHref(event.id) : "#"}>
                            <Pencil className="h-4 w-4 mr-1.5" /> Editar mapa
                        </a>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUnlink}
                        disabled={disabled || loadingLink || (event?.tickets_sold || 0) > 0}
                        data-testid="venue-change"
                    >
                        <Unlink className="h-4 w-4 mr-1.5" /> Cambiar
                    </Button>
                </div>
            </div>

            {/* Map preview (collapsible) */}
            <div className="rounded-xl border bg-card overflow-hidden min-w-0 max-w-full">
                <button
                    type="button"
                    className="w-full px-4 py-2.5 border-b text-left text-sm flex items-center justify-between hover:bg-secondary/40"
                    onClick={() => setMapOpen((v) => !v)}
                >
                    <span className="font-medium">Plano del evento</span>
                    <span className="text-xs text-muted-foreground">
                        {mapOpen ? "Ocultar" : "Mostrar"} · click en una zona para resaltar precios
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
                            height={360}
                            autoFitKey={event?.id ? `${event.id}:${event.venue_id || ""}` : undefined}
                        />
                    </div>
                )}
            </div>

            {/* Pricing cards */}
            <div className="space-y-3" data-testid="locality-pricing-table">
                <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                        <h4 className="font-semibold">Precios por localidad</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Entrada + cargos opcionales (USD). Se guardan al salir de cada campo.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" asChild data-testid="venue-add-locality">
                        <a href={event?.id ? eventMapHref(event.id) : "#"}>
                            <PlusCircle className="h-4 w-4 mr-1.5" /> Gestionar localidades
                        </a>
                    </Button>
                </div>

                <div className="grid gap-3">
                    {localitiesActive.map((loc) => {
                        const p = pricing[loc.id] || {};
                        const highlighted = highlightLocality === loc.id;
                        const entrada = (p.price_cents || 0) / 100;
                        const fees = ((p.service_fee_cents || 0) + (p.admin_fee_cents || 0)) / 100;
                        return (
                            <div
                                key={loc.id}
                                className={`rounded-xl border bg-card p-4 transition ${
                                    highlighted ? "ring-2 ring-teal-700/30 border-teal-700/40" : ""
                                }`}
                                data-testid={`loc-row-${loc.id}`}
                                onMouseEnter={() => setHighlightLocality(loc.id)}
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span
                                            className="h-3.5 w-3.5 rounded-sm border shrink-0"
                                            style={{ background: loc.color }}
                                        />
                                        <span className="font-medium truncate">{loc.name}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Comprador paga{" "}
                                        <strong className="text-foreground">
                                            ${(entrada + fees).toFixed(2)}
                                        </strong>
                                        {fees > 0 && (
                                            <span> (entrada ${entrada.toFixed(2)} + cargos)</span>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <MoneyInput
                                        label="Entrada"
                                        value={p.price_cents}
                                        onChange={(cents) => updatePricing(loc.id, { price_cents: cents })}
                                        onBlur={savePricing}
                                        disabled={disabled}
                                        testid={`loc-price-${loc.id}`}
                                    />
                                    <MoneyInput
                                        label="Cargo servicio"
                                        value={p.service_fee_cents}
                                        onChange={(cents) => updatePricing(loc.id, { service_fee_cents: cents })}
                                        onBlur={savePricing}
                                        disabled={disabled}
                                        testid={`loc-service-${loc.id}`}
                                    />
                                    <MoneyInput
                                        label="Cargo admin"
                                        value={p.admin_fee_cents}
                                        onChange={(cents) => updatePricing(loc.id, { admin_fee_cents: cents })}
                                        onBlur={savePricing}
                                        disabled={disabled}
                                        testid={`loc-admin-${loc.id}`}
                                    />
                                    <div className="space-y-1">
                                        <Label className="text-[11px] text-muted-foreground font-normal">
                                            Máx. por compra
                                        </Label>
                                        <Input
                                            type="number"
                                            min="1"
                                            className="h-9"
                                            placeholder="Sin límite"
                                            value={p.max_per_purchase ?? ""}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                updatePricing(loc.id, {
                                                    max_per_purchase: v === "" ? null : parseInt(v, 10),
                                                });
                                            }}
                                            onBlur={savePricing}
                                            disabled={disabled}
                                            data-testid={`loc-max-${loc.id}`}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

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
        </div>
    );
}
