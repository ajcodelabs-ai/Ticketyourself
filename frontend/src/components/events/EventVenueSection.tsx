/**
 * EventVenueSection — venue picker grid + interactive readonly canvas + inline
 * locality pricing table for the event wizard's "Venue y localidades" tab.
 *
 * Replaces the dialog-based `EventVenueLink` for the new combined tab. Handles:
 *  • Empty state with CTA "Crear mi primer venue" deep-linking to /app/venues/nuevo
 *  • Grid of published venue cards with thumbnail + capacity + select button
 *  • Once linked: full-width readonly canvas + pricing table with click-to-highlight
 *  • Locality pricing edit (price + max_tickets_per_purchase) saved on blur
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    MapPin,
    Loader2,
    Eye,
    Unlink,
    PlusCircle,
    Building2,
    ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import api from "@/lib/api";
import { venuesApi, computeCapacity } from "@/lib/venues";
import EditorCanvas from "@/components/venues/EditorCanvas";

function activeLocalityIds(venue): Set<string> {
    const out = new Set<string>();
    for (const el of venue?.elements || []) if (el.locality_id) out.add(el.locality_id as string);
    return out;
}

function VenueCard({ venue, selected, onSelect }) {
    const localityCount = (venue.localities || []).length;
    return (
        <button
            type="button"
            onClick={() => onSelect(venue.id)}
            className={`text-left rounded-xl border p-4 transition hover:border-primary hover:bg-primary/5 ${
                selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : ""
            }`}
            data-testid={`venue-card-${venue.slug}`}
        >
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="font-medium leading-snug">{venue.name}</div>
                {selected && (
                    <Badge className="bg-primary/15 text-primary border-primary/30">
                        Seleccionado
                    </Badge>
                )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
                {venue.description || "Sin descripción"}
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span>🪑 {venue.capacity_calculated || 0} asientos</span>
                <span>📍 {localityCount} localidad{localityCount !== 1 ? "es" : ""}</span>
            </div>
        </button>
    );
}

export default function EventVenueSection({ event, disabled, onUpdated, onReturnFromVenueCreate = undefined }) {
    const [venues, setVenues] = useState([]);
    const [linkedVenue, setLinkedVenue] = useState(null);
    const [loadingLink, setLoadingLink] = useState(false);
    const [highlightLocality, setHighlightLocality] = useState(null);
    const [pricing, setPricing] = useState({}); // {locality_id: {price_cents, max_per_purchase}}
    const initializedRef = useRef(false);

    // Pull published venues list once.
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

    // Fetch the full linked venue (with elements + canvas) when event.venue_id changes.
    useEffect(() => {
        let alive = true;
        if (!event?.venue_id) {
            setLinkedVenue(null);
            initializedRef.current = false;
            return undefined;
        }
        venuesApi
            .get(event.venue_id)
            .then((v) => { if (alive) setLinkedVenue(v); })
            .catch(() => { if (alive) setLinkedVenue(null); });
        return () => { alive = false; };
    }, [event?.venue_id]);

    // Seed pricing from event.locality_pricing once we have both event + venue.
    useEffect(() => {
        if (!linkedVenue || initializedRef.current) return;
        const next = {};
        for (const lp of event?.locality_pricing || []) {
            next[lp.locality_id] = {
                price_cents: lp.price_cents || 0,
                max_per_purchase: lp.max_tickets_per_purchase ?? null,
            };
        }
        // Fill localities missing pricing with the venue's default.
        for (const loc of linkedVenue.localities || []) {
            if (!next[loc.id]) {
                next[loc.id] = {
                    price_cents: loc.default_price_cents || 0,
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
        const prices = localitiesActive.map(
            (l) => pricing[l.id]?.price_cents ?? 0,
        );
        return {
            capacity: computeCapacity(elements),
            localityCount: localitiesActive.length,
            minPrice: Math.min(...prices) / 100,
            maxPrice: Math.max(...prices) / 100,
        };
    }, [localitiesActive, pricing, elements]);

    // Persist link + pricing to the backend.
    const persistLink = async (next) => {
        if (!event?.id) return;
        setLoadingLink(true);
        try {
            const r = await api.put(`/events/me/${event.id}/venue`, next);
            onUpdated?.(r.data);
            toast.success("Venue vinculado y precios guardados");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo guardar el venue.");
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
                return {
                locality_id: locId,
                price_cents: Math.max(0, parseInt(pricing[locId]?.price_cents ?? 0, 10) || 0),
                max_tickets_per_purchase:
                    pricing[locId]?.max_per_purchase != null
                        ? Math.max(1, parseInt(pricing[locId].max_per_purchase, 10) || 0) ||
                          null
                        : null,
            };
            }),
            seat_holds_window_minutes: 10,
        };
        await persistLink(body);
    };

    const handleUnlink = async () => {
        const ok = window.confirm(
            "¿Desvincular el venue del evento? Los precios por localidad se perderán.",
        );
        if (!ok) return;
        if ((event?.tickets_sold || 0) > 0) {
            toast.error("No podés cambiar el venue una vez que hay ventas confirmadas.");
            return;
        }
        setLoadingLink(true);
        try {
            await api.delete(`/events/me/${event.id}/venue`);
            onUpdated?.({ ...event, venue_id: null, venue_slug: null, locality_pricing: [] });
            toast.success("Venue desvinculado");
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

    // ── Empty state ─────────────────────────────────────────────────────────
    if (venues.length === 0 && !linkedVenue) {
        const returnTo = event?.id
            ? encodeURIComponent(`/app/eventos/${event.id}/editar?tab=venue_localidades`)
            : "";
        return (
            <div className="rounded-xl border-2 border-dashed p-8 bg-card text-center space-y-4" data-testid="venue-empty-state">
                <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-7 w-7 text-primary" />
                </div>
                <div className="space-y-1">
                    <h3 className="font-semibold text-lg">
                        Todavía no tenés un venue creado
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        Un venue es el mapa de tu lugar (asientos, zonas, palcos). Creá uno
                        publicado y volvé a este evento para vincularlo y definir los precios
                        por localidad.
                    </p>
                </div>
                <Button asChild size="lg" data-testid="venue-create-cta">
                    <a href={`/app/venues/nuevo${returnTo ? `?return_to=${returnTo}` : ""}`}>
                        <PlusCircle className="h-5 w-5 mr-2" />
                        Crear mi primer venue
                        <ArrowRight className="h-4 w-4 ml-2" />
                    </a>
                </Button>
            </div>
        );
    }

    // ── Picker (no linked venue yet) ────────────────────────────────────────
    if (!linkedVenue) {
        return (
            <div className="space-y-4" data-testid="venue-picker">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            Elegí el venue para este evento
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            Mostramos solo los venues publicados de tu cuenta.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" asChild data-testid="venue-create-link">
                        <a
                            href={`/app/venues/nuevo${
                                event?.id
                                    ? `?return_to=${encodeURIComponent(
                                          `/app/eventos/${event.id}/editar?tab=venue_localidades`,
                                      )}`
                                    : ""
                            }`}
                        >
                            <PlusCircle className="h-4 w-4 mr-1.5" /> Crear nuevo venue
                        </a>
                    </Button>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {venues.map((v) => (
                        <VenueCard
                            key={v.id}
                            venue={v}
                            selected={false}
                            onSelect={selectVenue}
                        />
                    ))}
                </div>
                {loadingLink && (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Vinculando venue...
                    </p>
                )}
            </div>
        );
    }

    // ── Linked: canvas + pricing table ──────────────────────────────────────
    return (
        <div className="space-y-4" data-testid="venue-linked">
            {/* Header with selected venue + actions */}
            <div className="rounded-xl border p-4 bg-secondary/30 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center">
                        <MapPin className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <div className="font-semibold leading-tight">
                            {linkedVenue.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {linkedVenue.capacity_calculated} asientos · {localitiesActive.length} localidad
                            {localitiesActive.length !== 1 ? "es" : ""}
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        asChild
                        data-testid="venue-preview"
                    >
                        <a
                            href={`/o/${linkedVenue.tenant_slug}/venues/${linkedVenue.slug}/preview`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <Eye className="h-4 w-4 mr-1.5" />
                            Vista previa pública
                        </a>
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUnlink}
                        disabled={disabled || loadingLink || (event?.tickets_sold || 0) > 0}
                        className="text-red-600 hover:bg-red-50"
                        data-testid="venue-change"
                        title={(event?.tickets_sold || 0) > 0
                            ? "No podés cambiar el venue después de la primera venta."
                            : undefined}
                    >
                        <Unlink className="h-4 w-4 mr-1.5" />
                        Cambiar venue
                    </Button>
                </div>
            </div>

            {/* Read-only interactive canvas */}
            <div className="rounded-xl border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b text-xs text-muted-foreground bg-secondary/30">
                    Mapa del venue · click en una zona para resaltar su locality abajo
                </div>
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
                    height={420}
                />
            </div>

            {/* Pricing table */}
            <div className="rounded-xl border bg-card">
                <div className="px-4 py-3 border-b">
                    <h4 className="font-semibold">Precios por localidad</h4>
                    <p className="text-xs text-muted-foreground">
                        Definí el precio en USD y, opcionalmente, un máximo de tickets por
                        compra para cada localidad.
                    </p>
                </div>
                <div className="divide-y" data-testid="locality-pricing-table">
                    {localitiesActive.map((loc) => {
                        const p = pricing[loc.id] || {};
                        const highlighted = highlightLocality === loc.id;
                        return (
                            <div
                                key={loc.id}
                                className={`grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-3 transition ${
                                    highlighted ? "bg-primary/5" : ""
                                }`}
                                data-testid={`loc-row-${loc.id}`}
                            >
                                <span
                                    className="h-3.5 w-3.5 rounded-sm border"
                                    style={{ background: loc.color }}
                                />
                                <div>
                                    <div className="font-medium text-sm">{loc.name}</div>
                                    {loc.description && (
                                        <div className="text-xs text-muted-foreground">
                                            {loc.description}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Label className="text-xs text-muted-foreground">USD</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="h-8 w-24"
                                        value={p.price_cents != null ? (p.price_cents / 100).toFixed(2) : ""}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            updatePricing(loc.id, {
                                                price_cents: v === ""
                                                    ? 0
                                                    : Math.round(parseFloat(v) * 100),
                                            });
                                        }}
                                        onBlur={savePricing}
                                        disabled={disabled}
                                        data-testid={`loc-price-${loc.id}`}
                                    />
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Label className="text-xs text-muted-foreground">Máx/compra</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        className="h-8 w-20"
                                        placeholder="—"
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
                        );
                    })}
                </div>
                {summary && (
                    <div
                        className="px-4 py-3 border-t text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1"
                        data-testid="locality-summary"
                    >
                        <span>Total capacidad: <strong>{summary.capacity}</strong></span>
                        <span>Localidades: <strong>{summary.localityCount}</strong></span>
                        <span>
                            Precio: <strong>${summary.minPrice.toFixed(2)}</strong>
                            {summary.minPrice !== summary.maxPrice &&
                                <> – <strong>${summary.maxPrice.toFixed(2)}</strong></>}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
