/**
 * Numbered-event seat selection section (Phase 7).
 * Used inside EventPublic when `event.venue_id` is set.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, Ticket, Trash2, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api from "@/lib/api";
import SeatPickerCanvas from "@/components/venues/SeatPickerCanvas";
import {
    getOrCreateSessionToken, selectedSubtotalCents, feesForSubtotal,
} from "@/lib/seats";

const REFRESH_MS = 15_000;

// ── Hold countdown ───────────────────────────────────────────────────────────
function HoldCountdown({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
    const [secondsLeft, setSecondsLeft] = useState(() =>
        Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
    );
    const onExpireRef = useRef(onExpire);
    onExpireRef.current = onExpire;

    useEffect(() => {
        if (secondsLeft <= 0) { onExpireRef.current(); return; }
        const t = setInterval(() => {
            setSecondsLeft((s) => {
                if (s <= 1) { clearInterval(t); onExpireRef.current(); return 0; }
                return s - 1;
            });
        }, 1000);
        return () => clearInterval(t);
    }, [expiresAt]); // re-run only if expiresAt changes (new hold)

    const min = Math.floor(secondsLeft / 60);
    const sec = secondsLeft % 60;
    const warning = secondsLeft < 120;
    return (
        <span className={`inline-flex items-center gap-1 font-mono font-semibold ${warning ? "text-amber-600" : "text-emerald-600"}`}>
            {warning ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
            {min}:{sec.toString().padStart(2, "0")}
        </span>
    );
}

export default function NumberedSeatSection({
    tenantSlug, event, onLaunchPurchase, functionId = "", functionName = "",
    localityPricing,
}) {
    const [seatsStatus, setSeatsStatus] = useState(event.seats_status || []);
    const [selected, setSelected] = useState([]); // array of seat objects we picked
    const [holdsLoading, setHoldsLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [sessionToken] = useState(() => getOrCreateSessionToken());
    const [activeHoldExpiresAt, setActiveHoldExpiresAt] = useState<string | null>(null);

    // A función may override per-locality pricing; fall back to the event's
    // own locality_pricing when no override (or no función) applies.
    const effectiveLocalityPricing = localityPricing?.length
        ? localityPricing
        : event.locality_pricing;

    const localitiesById = useMemo(
        () => Object.fromEntries((event.venue?.localities || []).map((l) => [l.id, l])),
        [event.venue?.localities],
    );

    const refreshSeats = useCallback(async () => {
        try {
            setRefreshing(true);
            const r = await api.get(`/public/events/${tenantSlug}/${event.slug}`, {
                params: { function_id: functionId || undefined },
            });
            setSeatsStatus(r.data.seats_status || []);
        } catch (e) {
            // Refresh runs every 15s in background; users have a manual retry
            // via the "Reservar y continuar" flow if it really fails. Log only.
            console.debug("[seats] refresh failed:", e?.message || e);
        } finally {
            setRefreshing(false);
        }
    }, [tenantSlug, event.slug, functionId]);

    // Re-fetch seat status from scratch whenever the chosen función changes
    // (each función has its own independent seat pool).
    useEffect(() => {
        refreshSeats();
        setSelected([]);
        setActiveHoldExpiresAt(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [functionId]);

    // Refresh seats status every 15s so users see other people's holds/sales live
    useEffect(() => {
        const t = setInterval(refreshSeats, REFRESH_MS);
        return () => clearInterval(t);
    }, [refreshSeats]);

    const toggleSeat = (seat) => {
        if (seat.status !== "available") return;
        setSelected((prev) => {
            const exists = prev.find((s) => s.seat_id === seat.seat_id);
            if (exists) return prev.filter((s) => s.seat_id !== seat.seat_id);
            if (prev.length >= 10) {
                toast.error("Máximo 10 asientos por compra.");
                return prev;
            }
            return [...prev, seat];
        });
    };

    const subtotal = selectedSubtotalCents(selected, effectiveLocalityPricing);
    const fees = feesForSubtotal(subtotal);
    const total = subtotal + fees;

    const handleReserveAndContinue = async () => {
        if (selected.length === 0) return;
        setHoldsLoading(true);
        try {
            const res = await api.post(
                `/public/events/${tenantSlug}/${event.slug}/seat-holds`,
                {
                    seat_ids: selected.map((s) => s.seat_id),
                    session_token: sessionToken,
                    function_id: functionId || undefined,
                },
            );
            // Refresh seat status with response payload
            if (res.data?.seats_status) setSeatsStatus(res.data.seats_status);
            const expiresAt = res.data?.expires_at;
            setActiveHoldExpiresAt(expiresAt || null);
            onLaunchPurchase({
                seat_ids: selected.map((s) => s.seat_id),
                seats: selected,
                session_token: sessionToken,
                expires_at: expiresAt,
                subtotal_cents: subtotal,
                fees_cents: fees,
                total_cents: total,
                function_id: functionId || undefined,
                function_name: functionName || undefined,
            });
        } catch (e) {
            const detail = e?.response?.data?.detail;
            if (typeof detail === "object" && detail?.unavailable_seat_ids) {
                toast.error(
                    `${detail.unavailable_seat_ids.length} asiento(s) ya no están disponibles. Refresco el mapa.`,
                );
                refreshSeats();
                setSelected((prev) =>
                    prev.filter((s) => !detail.unavailable_seat_ids.includes(s.seat_id)),
                );
            } else {
                toast.error(detail || "No pudimos reservar. Probá de nuevo.");
            }
        } finally {
            setHoldsLoading(false);
        }
    };

    if (!event.venue) {
        return (
            <section className="max-w-3xl mx-auto px-6 py-10 text-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                Cargando mapa…
            </section>
        );
    }

    // Group active localities (with at least 1 element) for the legend
    const activeLocalityIds = new Set();
    for (const el of event.venue.elements || []) {
        if (el.locality_id) activeLocalityIds.add(el.locality_id);
    }
    const pricingByLocality = Object.fromEntries(
        (effectiveLocalityPricing || []).map((lp) => [lp.locality_id, lp.price_cents]),
    );

    return (
        <section
            className="max-w-6xl mx-auto px-4 sm:px-6 py-10"
            data-testid="event-public-seat-section"
        >
            <h2 className="text-2xl font-semibold mb-4">
                Elegí tus asientos
                {functionName && (
                    <span className="text-base font-normal text-muted-foreground"> — {functionName}</span>
                )}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                <div>
                    <SeatPickerCanvas
                        venue={event.venue}
                        seatsStatus={seatsStatus}
                        localitiesById={localitiesById}
                        selectedIds={selected.map((s) => s.seat_id)}
                        onToggleSeat={toggleSeat}
                        height={520}
                    />
                    {/* Status legend */}
                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-3 w-3 rounded-full ring-2 ring-sky-500" />
                            Tu selección
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-3 w-3 rounded-full bg-slate-300" />
                            Reservado
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-3 w-3 rounded-full bg-slate-600" />
                            Vendido
                        </span>
                        {refreshing && <span className="italic">Actualizando…</span>}
                    </div>
                </div>

                <aside className="space-y-4">
                    {/* Localities legend with prices */}
                    <div className="rounded-xl border p-4 space-y-2">
                        <h3 className="text-sm font-semibold">Localidades</h3>
                        {(event.venue.localities || [])
                            .filter((loc) => activeLocalityIds.has(loc.id))
                            .map((loc) => (
                                <div
                                    key={loc.id}
                                    className="flex items-center justify-between text-sm"
                                    data-testid={`legend-loc-${loc.id}`}
                                >
                                    <span className="inline-flex items-center gap-2">
                                        <span
                                            className="h-3 w-3 rounded-sm ring-1 ring-slate-200"
                                            style={{ background: loc.color }}
                                        />
                                        {loc.name}
                                    </span>
                                    <span className="font-medium">
                                        USD {((pricingByLocality[loc.id] || 0) / 100).toFixed(2)}
                                    </span>
                                </div>
                            ))}
                    </div>

                    {/* Selection summary */}
                    <div className="rounded-xl border p-4 space-y-2 bg-secondary/40">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">
                                Asientos elegidos ({selected.length})
                            </span>
                            {selected.length > 0 && (
                                <button
                                    onClick={() => setSelected([])}
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                    data-testid="seats-clear"
                                >
                                    <Trash2 className="h-3 w-3 inline mr-0.5" />
                                    Limpiar
                                </button>
                            )}
                        </div>
                        {selected.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">
                                Click en cualquier asiento disponible del mapa.
                            </p>
                        ) : (
                            <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                {selected.map((s) => {
                                    const loc = localitiesById[s.locality_id];
                                    const price = pricingByLocality[s.locality_id] || 0;
                                    return (
                                        <div
                                            key={s.seat_id}
                                            className="flex items-center justify-between text-xs"
                                            data-testid={`selected-seat-${s.seat_id}`}
                                        >
                                            <span className="inline-flex items-center gap-1.5">
                                                <span
                                                    className="h-2.5 w-2.5 rounded-full"
                                                    style={{ background: loc?.color || "#94A3B8" }}
                                                />
                                                <strong>{s.label}</strong>
                                                <span className="text-muted-foreground">
                                                    · {loc?.name || ""}
                                                </span>
                                            </span>
                                            <span className="font-mono">
                                                ${(price / 100).toFixed(2)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <hr className="border-slate-200" />
                        <div className="text-xs flex items-center justify-between">
                            <span>Subtotal</span><span className="font-mono">${(subtotal / 100).toFixed(2)}</span>
                        </div>
                        <div className="text-xs flex items-center justify-between text-muted-foreground">
                            <span>Servicio</span><span className="font-mono">${(fees / 100).toFixed(2)}</span>
                        </div>
                        <div className="text-base flex items-center justify-between font-semibold">
                            <span>Total</span>
                            <Badge variant="secondary" className="text-base font-bold" data-testid="seats-total">
                                ${(total / 100).toFixed(2)}
                            </Badge>
                        </div>
                        <Button
                            className="w-full"
                            size="lg"
                            disabled={selected.length === 0 || holdsLoading}
                            onClick={handleReserveAndContinue}
                            data-testid="seats-reserve-btn"
                        >
                            {holdsLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                            ) : (
                                <Ticket className="h-4 w-4 mr-1.5" />
                            )}
                            Reservar y continuar
                        </Button>
                        <p className="text-[10px] text-center text-muted-foreground">
                            {activeHoldExpiresAt ? (
                                <>
                                    Reserva activa — tiempo restante:{" "}
                                    <HoldCountdown
                                        expiresAt={activeHoldExpiresAt}
                                        onExpire={() => {
                                            setActiveHoldExpiresAt(null);
                                            setSelected([]);
                                            refreshSeats();
                                            toast.warning("Tu reserva de asientos venció. Elegí nuevamente.");
                                        }}
                                    />
                                </>
                            ) : (
                                "Te reservamos los asientos por 10 minutos."
                            )}
                        </p>
                    </div>
                </aside>
            </div>
        </section>
    );
}
