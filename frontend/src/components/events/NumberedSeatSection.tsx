/**
 * Numbered-event seat selection section (Phase 7).
 * Used inside EventPublic when `event.venue_id` is set.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Loader2, Ticket, Trash2, Clock, AlertTriangle, LayoutList, CheckSquare2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api from "@/lib/api";
import SeatPickerCanvas from "@/components/venues/SeatPickerCanvas";
import { useHoldCountdown, HOLD_WARNING_SECONDS } from "@/components/HoldCountdown";
import {
    getOrCreateSessionToken, selectedSeatBreakdown,
} from "@/lib/seats";

interface SeatGroup {
    id: string;
    type: "row" | "table";
    label: string;
    seat_ids: string[];
    total_seats: number;
    available_seats: number;
}

const REFRESH_MS = 15_000;

// ── Reservation timer banner — top of the seat-selection screen, colors
// itself to match the countdown's own urgency (green → amber under 2min).
function ReservationTimerBanner({
    expiresAt, onExpire, onCancel, canceling,
}: { expiresAt: string; onExpire: () => void; onCancel: () => void; canceling: boolean }) {
    const secondsLeft = useHoldCountdown(expiresAt, onExpire);
    const min = Math.floor(secondsLeft / 60);
    const sec = secondsLeft % 60;
    const warning = secondsLeft < HOLD_WARNING_SECONDS;
    return (
        <div
            className={`mb-4 rounded-xl border-2 px-4 py-3 flex items-center justify-between gap-3 flex-wrap transition-colors ${
                warning ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"
            }`}
            data-testid="reservation-timer-banner"
        >
            <span className={`text-sm font-medium ${warning ? "text-amber-900" : "text-emerald-900"}`}>
                Tiempo restante de la reserva
            </span>
            <div className="flex items-center gap-3 ml-auto">
                <span
                    className={`inline-flex items-center gap-1 font-mono font-semibold text-lg ${warning ? "text-amber-600 animate-pulse" : "text-emerald-600"}`}
                    data-testid="hold-countdown"
                >
                    {warning ? <AlertTriangle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
                    {min}:{sec.toString().padStart(2, "0")}
                </span>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onCancel}
                    disabled={canceling}
                    data-testid="cancel-reservation-btn"
                >
                    {canceling ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                    Cancelar reserva
                </Button>
            </div>
        </div>
    );
}

export default function NumberedSeatSection({
    tenantSlug, event, onLaunchPurchase, functionId = "", functionName = "",
    localityPricing,
}) {
    const [seatsStatus, setSeatsStatus] = useState(event.seats_status || []);
    const [selected, setSelected] = useState([]); // array of seat objects we picked
    const [holdsLoading, setHoldsLoading] = useState(false);
    const [cancelingHold, setCancelingHold] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [sessionToken] = useState(() => getOrCreateSessionToken());
    const [activeHoldExpiresAt, setActiveHoldExpiresAt] = useState<string | null>(null);
    // Guards against a double resolution when the countdown expires while a
    // user-initiated cancel is still in flight (or vice versa) — whichever
    // resolves first "wins" and the other is a no-op.
    const holdResolvedRef = useRef(false);
    const [seatGroups, setSeatGroups] = useState<SeatGroup[]>([]);
    const [groupsLoading, setGroupsLoading] = useState(false);

    const allowGroupPurchase = !!(event?.content as any)?.allow_full_group_purchase;

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

    // Fetch available groups when allow_full_group_purchase is enabled
    useEffect(() => {
        if (!allowGroupPurchase) { setSeatGroups([]); return; }
        let alive = true;
        setGroupsLoading(true);
        api.get(`/public/events/${tenantSlug}/${event.slug}/seat-groups`, {
            params: { function_id: functionId || undefined },
        })
            .then((r) => { if (alive) setSeatGroups(r.data?.groups || []); })
            .catch(() => { if (alive) setSeatGroups([]); })
            .finally(() => { if (alive) setGroupsLoading(false); });
        return () => { alive = false; };
    }, [allowGroupPurchase, tenantSlug, event.slug, functionId]);

    // Re-fetch groups when seat status changes (holds/releases update availability)
    useEffect(() => {
        if (!allowGroupPurchase || !seatGroups.length) return;
        api.get(`/public/events/${tenantSlug}/${event.slug}/seat-groups`, {
            params: { function_id: functionId || undefined },
        })
            .then((r) => setSeatGroups(r.data?.groups || []))
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seatsStatus]);

    const selectGroup = useCallback((group: SeatGroup) => {
        const groupSeats = seatsStatus.filter(
            (s) => group.seat_ids.includes(s.seat_id) && s.status === "available",
        );
        const allSelected = groupSeats.every((s) => selected.some((p) => p.seat_id === s.seat_id));
        if (allSelected) {
            setSelected((prev) => prev.filter((p) => !group.seat_ids.includes(p.seat_id)));
            return;
        }
        if (groupSeats.length > 10) {
            toast.error(`Esta ${group.type === "table" ? "mesa" : "fila"} tiene ${groupSeats.length} asientos — el máximo por compra es 10.`);
            return;
        }
        const withoutGroup = selected.filter((p) => !group.seat_ids.includes(p.seat_id));
        if (withoutGroup.length + groupSeats.length > 10) {
            toast.error("Máximo 10 asientos por compra. Limpiá la selección actual primero.");
            return;
        }
        setSelected([...withoutGroup, ...groupSeats]);
        const noun = group.type === "table" ? "Mesa" : "Fila";
        toast.success(`${noun} "${group.label}" seleccionada (${groupSeats.length} asientos).`);
    }, [seatsStatus, selected]);

    const toggleSeat = (seat) => {
        if (seat.status !== "available") return;

        // §4.2.6 — "mesa / fila completa": clicking any seat of a flagged
        // element selects (or deselects) every available seat of that group.
        const element = (event.venue?.elements || []).find((e) => e.id === seat.element_id);
        if (element?.require_full_purchase) {
            const groupSeats = seatsStatus.filter(
                (s) => s.element_id === seat.element_id && s.status === "available",
            );
            const groupIds = new Set(groupSeats.map((s) => s.seat_id));
            setSelected((prev) => {
                const allSelected = groupSeats.every((s) =>
                    prev.some((p) => p.seat_id === s.seat_id),
                );
                if (allSelected) {
                    return prev.filter((p) => !groupIds.has(p.seat_id));
                }
                const withoutGroup = prev.filter((p) => !groupIds.has(p.seat_id));
                if (withoutGroup.length + groupSeats.length > 10) {
                    toast.error("Máximo 10 asientos por compra.");
                    return prev;
                }
                const noun = element.kind?.startsWith("table") ? "mesa" : "fila";
                toast.success(`Se seleccionó la ${noun} completa (${groupSeats.length} asientos).`);
                return [...withoutGroup, ...groupSeats];
            });
            return;
        }

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

    const breakdown = selectedSeatBreakdown(selected, effectiveLocalityPricing);
    const subtotal = breakdown.subtotal_cents;
    const fees = 0;
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
            holdResolvedRef.current = false;
            setActiveHoldExpiresAt(expiresAt || null);
            onLaunchPurchase({
                seat_ids: selected.map((s) => s.seat_id),
                seats: selected,
                session_token: sessionToken,
                expires_at: expiresAt,
                subtotal_cents: subtotal,
                entrada_cents: breakdown.entrada_cents,
                service_fee_cents: breakdown.service_fee_cents,
                admin_fee_cents: breakdown.admin_fee_cents,
                vxs_cents: breakdown.vxs_cents,
                wallet_fee_cents: breakdown.wallet_fee_cents,
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

    const cancelReservation = async () => {
        if (!window.confirm("¿Cancelar la reserva? Los asientos elegidos quedarán liberados.")) {
            return;
        }
        setCancelingHold(true);
        try {
            await api.delete(`/public/events/${tenantSlug}/${event.slug}/seat-holds`, {
                data: { session_token: sessionToken, function_id: functionId || undefined },
            });
            if (holdResolvedRef.current) return; // countdown already expired it first
            holdResolvedRef.current = true;
            setActiveHoldExpiresAt(null);
            setSelected([]);
            refreshSeats();
            toast.success("Reserva cancelada — los asientos quedaron liberados.");
        } catch {
            toast.error("No pudimos cancelar la reserva. Probá de nuevo.");
        } finally {
            setCancelingHold(false);
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
            {activeHoldExpiresAt && (
                <ReservationTimerBanner
                    expiresAt={activeHoldExpiresAt}
                    onExpire={() => {
                        if (holdResolvedRef.current) return; // already canceled by the user
                        holdResolvedRef.current = true;
                        setActiveHoldExpiresAt(null);
                        setSelected([]);
                        refreshSeats();
                        toast.warning("Tu reserva de asientos venció. Elegí nuevamente.");
                    }}
                    onCancel={cancelReservation}
                    canceling={cancelingHold}
                />
            )}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                <div className="min-w-0">
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
                    {/* ── Grupos disponibles (fila / mesa completa) ──────────────── */}
                    {allowGroupPurchase && (
                        <div className="rounded-xl border p-4 space-y-2" data-testid="seat-groups-panel">
                            <h3 className="text-sm font-semibold flex items-center gap-1.5">
                                <LayoutList className="h-4 w-4 text-violet-600" />
                                Comprar por grupo
                            </h3>
                            {groupsLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : seatGroups.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">
                                    Sin grupos disponibles.
                                </p>
                            ) : (
                                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {seatGroups.map((group) => {
                                        const isSelected = group.seat_ids.every((id) =>
                                            selected.some((s) => s.seat_id === id),
                                        );
                                        const noun = group.type === "table" ? "Mesa" : "Fila";
                                        return (
                                            <button
                                                key={group.id}
                                                onClick={() => selectGroup(group)}
                                                data-testid={`group-btn-${group.id}`}
                                                className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors ${
                                                    isSelected
                                                        ? "border-primary bg-primary/10 text-primary font-semibold"
                                                        : "hover:border-primary/50 hover:bg-muted"
                                                }`}
                                            >
                                                <span className="flex items-center gap-1.5">
                                                    {isSelected && (
                                                        <CheckSquare2 className="h-3.5 w-3.5 shrink-0" />
                                                    )}
                                                    <span>
                                                        {noun} <strong>{group.label}</strong>
                                                    </span>
                                                </span>
                                                <Badge
                                                    variant={isSelected ? "default" : "secondary"}
                                                    className="text-[10px]"
                                                >
                                                    {group.available_seats}/{group.total_seats}
                                                </Badge>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <p className="text-[10px] text-muted-foreground">
                                Al seleccionar un grupo se reservan todos sus asientos disponibles.
                            </p>
                        </div>
                    )}

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
                        {!activeHoldExpiresAt && (
                            <p className="text-[10px] text-center text-muted-foreground">
                                Te reservamos los asientos por 10 minutos.
                            </p>
                        )}
                    </div>
                </aside>
            </div>
        </section>
    );
}
