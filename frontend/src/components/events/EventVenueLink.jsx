/**
 * EventVenueLink — picker + locality_pricing form for the event Wizard.
 * Calls PUT /api/events/me/:id/venue to attach a published venue to an event.
 */
import { useEffect, useMemo, useState } from "react";
import { Link as LinkIcon, MapPin, Loader2, Eye, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import api from "@/lib/api";
import { venuesApi } from "@/lib/venues";

function activeLocalityIds(venue) {
    const out = new Set();
    for (const el of venue.elements || []) if (el.locality_id) out.add(el.locality_id);
    return out;
}

export default function EventVenueLink({ event, onUpdated, disabled }) {
    const [venues, setVenues] = useState([]);
    const [open, setOpen] = useState(false);
    const [pickerVenueId, setPickerVenueId] = useState(event?.venue_id || "");
    const [pricing, setPricing] = useState({}); // {locality_id: price_cents}
    const [loading, setLoading] = useState(false);
    const [previewVenue, setPreviewVenue] = useState(null);

    useEffect(() => {
        venuesApi.list({ status: "published" })
            .then((d) => setVenues(d.items.filter((v) => v.status === "published")))
            .catch(() => setVenues([]));
    }, []);

    const currentVenue = useMemo(
        () => venues.find((v) => v.id === event?.venue_id),
        [venues, event?.venue_id],
    );

    const openDialog = () => {
        setPickerVenueId(event?.venue_id || "");
        // Pre-fill pricing from existing event.locality_pricing
        const initial = {};
        (event?.locality_pricing || []).forEach((lp) => {
            initial[lp.locality_id] = lp.price_cents;
        });
        setPricing(initial);
        setOpen(true);
    };

    const handleSelectVenue = (vid) => {
        setPickerVenueId(vid);
        const venue = venues.find((v) => v.id === vid);
        if (!venue) return;
        const initial = { ...pricing };
        for (const loc of venue.localities || []) {
            if (initial[loc.id] == null) initial[loc.id] = loc.default_price_cents || 0;
        }
        setPricing(initial);
    };

    const handleSubmit = async () => {
        const venue = venues.find((v) => v.id === pickerVenueId);
        if (!venue) return;
        const active = activeLocalityIds(venue);
        const body = {
            venue_id: pickerVenueId,
            locality_pricing: Array.from(active).map((loc_id) => ({
                locality_id: loc_id,
                price_cents: Math.max(0, parseInt(pricing[loc_id] ?? 0, 10) || 0),
                max_tickets_per_purchase: null,
            })),
            seat_holds_window_minutes: 10,
        };
        if (body.locality_pricing.some((lp) => lp.price_cents === 0)) {
            const proceed = window.confirm(
                "Hay localidades con precio $0. ¿Confirmás que el evento es gratuito en esas?",
            );
            if (!proceed) return;
        }
        setLoading(true);
        try {
            const res = await api.put(`/events/me/${event.id}/venue`, body);
            toast.success("Venue vinculado al evento");
            onUpdated?.(res.data);
            setOpen(false);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo vincular el venue.");
        } finally {
            setLoading(false);
        }
    };

    const handleUnlink = async () => {
        if (!window.confirm("¿Desvincular el venue del evento? Volverá a ser no numerado.")) return;
        setLoading(true);
        try {
            await api.delete(`/events/me/${event.id}/venue`);
            toast.success("Venue desvinculado");
            onUpdated?.({ ...event, venue_id: null, venue_slug: null, locality_pricing: [] });
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudo desvincular.");
        } finally {
            setLoading(false);
        }
    };

    const pickedVenue = venues.find((v) => v.id === pickerVenueId);

    return (
        <div className="rounded-xl border p-4 bg-secondary/20" data-testid="event-venue-link">
            <header className="flex items-center justify-between mb-2">
                <div>
                    <h3 className="font-semibold text-sm flex items-center gap-1.5">
                        <MapPin className="h-4 w-4" /> Venue con asientos numerados
                    </h3>
                    <p className="text-xs text-muted-foreground">
                        Si vinculás un venue, el evento usa el mapa interactivo y se ignora el precio base.
                    </p>
                </div>
                {currentVenue ? (
                    <Badge variant="default" className="bg-emerald-100 text-emerald-900 border-emerald-200">
                        Numerado
                    </Badge>
                ) : (
                    <Badge variant="outline">No numerado</Badge>
                )}
            </header>

            {currentVenue ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <div>
                            <p className="font-medium">{currentVenue.name}</p>
                            <p className="text-xs text-muted-foreground">
                                {currentVenue.capacity_calculated} asientos · {currentVenue.localities?.length || 0} localidades
                            </p>
                        </div>
                        <div className="flex gap-1.5">
                            <Button
                                size="sm" variant="outline" disabled={disabled || loading}
                                onClick={() => setPreviewVenue(currentVenue)}
                                data-testid="venue-link-preview"
                            >
                                <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                            </Button>
                            <Button
                                size="sm" variant="outline" disabled={disabled || loading}
                                onClick={openDialog}
                                data-testid="venue-link-edit"
                            >
                                Cambiar / Ajustar precios
                            </Button>
                            <Button
                                size="sm" variant="outline" disabled={disabled || loading || (event?.tickets_sold || 0) > 0}
                                onClick={handleUnlink}
                                className="text-red-600 hover:bg-red-50"
                                data-testid="venue-link-unlink"
                            >
                                <Unlink className="h-3.5 w-3.5 mr-1" /> Desvincular
                            </Button>
                        </div>
                    </div>
                    <div className="rounded-md bg-white border text-xs">
                        <div className="grid grid-cols-[1fr_auto] gap-2 px-2 py-1.5 bg-muted/50 font-medium">
                            <span>Localidad</span><span>Precio</span>
                        </div>
                        {(event.locality_pricing || []).map((lp) => {
                            const loc = currentVenue.localities?.find((l) => l.id === lp.locality_id);
                            return (
                                <div key={lp.locality_id}
                                     className="grid grid-cols-[1fr_auto] gap-2 px-2 py-1.5 border-t"
                                     data-testid={`event-loc-pricing-${lp.locality_id}`}>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: loc?.color }} />
                                        {loc?.name || "?"}
                                    </span>
                                    <span className="font-mono">USD {((lp.price_cents || 0) / 100).toFixed(2)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <Button onClick={openDialog} variant="outline" size="sm"
                        disabled={disabled || loading} data-testid="venue-link-attach">
                    <LinkIcon className="h-4 w-4 mr-1.5" /> Vincular venue
                </Button>
            )}

            {/* Picker dialog */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Vincular venue + precios por localidad</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1">
                            <Label className="text-xs">Venue publicado</Label>
                            <Select value={pickerVenueId} onValueChange={handleSelectVenue}>
                                <SelectTrigger data-testid="venue-picker-select">
                                    <SelectValue placeholder="Elegí un venue" />
                                </SelectTrigger>
                                <SelectContent>
                                    {venues.length === 0 && (
                                        <SelectItem value="__none" disabled>
                                            No tenés venues publicados. Andá a /app/venues primero.
                                        </SelectItem>
                                    )}
                                    {venues.map((v) => (
                                        <SelectItem key={v.id} value={v.id}>
                                            {v.name} ({v.capacity_calculated} cap.)
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {pickedVenue && (
                            <>
                                <p className="text-xs text-muted-foreground">
                                    Definí el precio por cada localidad activa del venue:
                                </p>
                                <div className="rounded-md border divide-y">
                                    {(pickedVenue.localities || [])
                                        .filter((loc) => activeLocalityIds(pickedVenue).has(loc.id))
                                        .map((loc) => (
                                            <div key={loc.id}
                                                 className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2">
                                                <span className="h-3 w-3 rounded-sm"
                                                      style={{ background: loc.color }} />
                                                <div>
                                                    <p className="text-sm">{loc.name}</p>
                                                    {loc.description && (
                                                        <p className="text-[10px] text-muted-foreground">{loc.description}</p>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs">USD</span>
                                                    <Input
                                                        type="number" min="0" step="0.01"
                                                        className="h-8 w-24"
                                                        value={pricing[loc.id] != null ? pricing[loc.id] / 100 : ""}
                                                        onChange={(e) => {
                                                            const cents = e.target.value === "" ? 0
                                                                : Math.round(parseFloat(e.target.value) * 100);
                                                            setPricing({ ...pricing, [loc.id]: cents });
                                                        }}
                                                        data-testid={`pricing-input-${loc.id}`}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSubmit}
                                disabled={!pickerVenueId || loading}
                                data-testid="venue-link-submit">
                            {loading && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                            Vincular y guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Preview mini dialog */}
            <Dialog open={!!previewVenue} onOpenChange={(o) => !o && setPreviewVenue(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>{previewVenue?.name}</DialogTitle>
                    </DialogHeader>
                    {previewVenue && (
                        <div className="text-xs">
                            <p>Cap: {previewVenue.capacity_calculated} · Elementos: {previewVenue.elements?.length || 0}</p>
                            <Button asChild variant="link" className="px-0">
                                <a href={`/o/${previewVenue.tenant_slug}/venues/${previewVenue.slug}/preview`}
                                   target="_blank" rel="noreferrer">
                                    Abrir preview público en pestaña nueva ↗
                                </a>
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
