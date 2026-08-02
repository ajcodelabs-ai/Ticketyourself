/**
 * Assign localities to map elements — event-scoped map page only.
 * Creating/editing localidades (nombre, color, precio) happens in the event's
 * tab Localidades; this panel only maps physical elements to those localities.
 */
import { Button } from "@/components/ui/button";
import { capacityByLocality, elementAcceptsLocality, elementSeats } from "@/lib/venues";

function countElementsByLocality(elements, localityId) {
    return (elements || []).filter(
        (e) => e.locality_id === localityId && elementAcceptsLocality(e.kind),
    ).length;
}

function formatMoney(cents) {
    return `$${((cents || 0) / 100).toFixed(2)}`;
}

export default function AssignLocalityPanel({
    localities,
    elements,
    selection,
    pricingById = {},
    onAssign,
    onClearLocality,
    onClearAll,
    readOnly,
}) {
    const assignable = (elements || []).filter((e) => elementAcceptsLocality(e.kind));
    const assignedElems = assignable.filter((e) => e.locality_id);
    const unassignedElems = assignable.filter((e) => !e.locality_id);
    const assignedCap = assignedElems.reduce((s, e) => s + elementSeats(e), 0);
    const unassignedCap = unassignedElems.reduce((s, e) => s + elementSeats(e), 0);
    const selectionAssignable = (selection || []).filter((id) => {
        const el = (elements || []).find((e) => e.id === id);
        return el && elementAcceptsLocality(el.kind);
    });

    return (
        <section className="flex flex-col min-h-0 gap-3" data-testid="assign-locality-panel">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="text-sm font-medium">Localidades</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Seleccioná elementos en el mapa (click o Shift+arrastrar) y asignalos a una localidad.
                    </p>
                </div>
                {!readOnly && onClearAll && assignedElems.length > 0 && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs shrink-0"
                        onClick={onClearAll}
                        data-testid="assign-clear-all"
                    >
                        Limpiar todo
                    </Button>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-0.5">
                {localities.length === 0 && (
                    <p className="text-xs text-muted-foreground italic py-2">
                        Este evento todavía no tiene localidades. Creálas en el tab
                        &quot;Localidades&quot; antes de asignar.
                    </p>
                )}
                {localities.map((loc) => {
                    const cap = capacityByLocality(elements, loc.id);
                    const nElems = countElementsByLocality(elements, loc.id);
                    const price =
                        pricingById[loc.id]?.price_cents ?? loc.default_price_cents ?? 0;
                    const canAssign = !readOnly && selectionAssignable.length > 0;
                    return (
                        <div
                            key={loc.id}
                            className="rounded-xl border bg-background overflow-hidden"
                            data-testid={`assign-locality-row-${loc.id}`}
                            style={{ borderLeftWidth: 4, borderLeftColor: loc.color || "#94A3B8" }}
                        >
                            <div className="p-3 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="font-medium text-sm truncate">{loc.name}</div>
                                        <div className="text-xs text-muted-foreground tabular-nums">
                                            {formatMoney(price)}
                                        </div>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground text-right shrink-0 tabular-nums">
                                        <div>{nElems} elem.</div>
                                        <div>{cap} cap.</div>
                                    </div>
                                </div>
                                {!readOnly && (
                                    <div className="flex gap-1.5">
                                        <Button
                                            size="sm"
                                            className="h-8 flex-1 text-xs"
                                            style={
                                                canAssign
                                                    ? { backgroundColor: loc.color || undefined }
                                                    : undefined
                                            }
                                            variant={canAssign ? "default" : "secondary"}
                                            disabled={!canAssign}
                                            onClick={() => onAssign(loc.id)}
                                            data-testid={`assign-locality-btn-${loc.id}`}
                                        >
                                            Asignar selección
                                            {canAssign ? ` (${selectionAssignable.length})` : ""}
                                        </Button>
                                        {nElems > 0 && onClearLocality && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 text-xs"
                                                onClick={() => onClearLocality(loc.id)}
                                                data-testid={`assign-clear-loc-${loc.id}`}
                                            >
                                                Quitar todo
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {assignable.length > 0 && (
                <div
                    className="rounded-lg border bg-secondary/40 px-3 py-2 text-[11px] grid grid-cols-2 gap-2"
                    data-testid="assign-distribution"
                >
                    <div>
                        <div className="uppercase tracking-wide text-muted-foreground font-medium">
                            Asignados
                        </div>
                        <div className="tabular-nums text-foreground">
                            {assignedElems.length} elem. · {assignedCap} cap.
                        </div>
                    </div>
                    <div>
                        <div className="uppercase tracking-wide text-muted-foreground font-medium">
                            Sin asignar
                        </div>
                        <div className="tabular-nums text-foreground">
                            {unassignedElems.length} elem. · {unassignedCap} cap.
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
