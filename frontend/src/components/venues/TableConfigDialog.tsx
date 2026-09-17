/**
 * Single dialog used for both round and rectangular tables, picked via `kind`.
 * Primary fields mirror the reference app's minimal table dialog (sillas +
 * cantidad de mesas, auto-named "Mesa N" — no name prompt) — nombre,
 * dimensiones y localidad live under "Opciones avanzadas", editable later
 * per-table from the Properties Panel either way.
 */
import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import ClampedNumberInput from "@/components/venues/ClampedNumberInput";

export default function TableConfigDialog({ open, kind, onClose, onConfirm, localities }) {
    const isRound = kind === "table_round";
    const [label, setLabel] = useState(isRound ? "Mesa 1" : "Mesa rect.");
    const [tableCount, setTableCount] = useState(1);
    const [chairsCount, setChairsCount] = useState(8);
    const [width, setWidth] = useState(200);
    const [height, setHeight] = useState(100);
    const [top, setTop] = useState(4);
    const [bottom, setBottom] = useState(4);
    const [left, setLeft] = useState(0);
    const [right, setRight] = useState(0);
    const [locality_id, setLocality] = useState(localities[0]?.id || "__none");
    const [advancedOpen, setAdvancedOpen] = useState(false);

    useEffect(() => {
        if (open) {
            setLabel(isRound ? "Mesa 1" : "Mesa rect.");
            setTableCount(1);
            setChairsCount(8);
            setWidth(200); setHeight(100);
            setTop(4); setBottom(4); setLeft(0); setRight(0);
            setLocality(localities[0]?.id || "__none");
            setAdvancedOpen(false);
        }
    }, [open, kind, localities, isRound]);

    const total = isRound ? chairsCount : top + right + bottom + left;

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {isRound ? "Agregar mesas redondas" : "Agregar mesas rectangulares"}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    {isRound ? (
                        <div className="space-y-1">
                            <Label className="text-xs">Sillas por mesa</Label>
                            <ClampedNumberInput
                                value={chairsCount}
                                min={2}
                                max={12}
                                onCommit={setChairsCount}
                                testid="table-round-chairs"
                            />
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <Label className="text-xs">Sillas arriba</Label>
                                <ClampedNumberInput value={top} min={0} max={12} onCommit={setTop} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Sillas abajo</Label>
                                <ClampedNumberInput value={bottom} min={0} max={12} onCommit={setBottom} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Sillas izquierda</Label>
                                <ClampedNumberInput value={left} min={0} max={8} onCommit={setLeft} />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Sillas derecha</Label>
                                <ClampedNumberInput value={right} min={0} max={8} onCommit={setRight} />
                            </div>
                        </div>
                    )}

                    <div className="space-y-1">
                        <Label className="text-xs">Cantidad de mesas</Label>
                        <ClampedNumberInput
                            value={tableCount}
                            min={1}
                            max={50}
                            onCommit={setTableCount}
                            testid="table-dialog-count"
                        />
                        {tableCount > 1 && (
                            <p className="text-[11px] text-muted-foreground">
                                Se crean {tableCount} mesas acomodadas en grilla, numeradas
                                {" "}{label.replace(/\s*\d+\s*$/, "").trim() || "Mesa"} 1, 2, 3…
                            </p>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground" data-testid="table-dialog-total">
                        Total sillas por mesa: <strong>{total}</strong>
                    </p>

                    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                        <CollapsibleTrigger asChild>
                            <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                data-testid="table-dialog-advanced-toggle"
                            >
                                <ChevronDown
                                    className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                                />
                                Opciones avanzadas
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-3 pt-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Nombre</Label>
                                <Input value={label} onChange={(e) => setLabel(e.target.value)}
                                       data-testid="table-dialog-label" />
                            </div>
                            {!isRound && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Ancho (px)</Label>
                                        <ClampedNumberInput value={width} min={80} max={1000} onCommit={setWidth} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Alto (px)</Label>
                                        <ClampedNumberInput value={height} min={60} max={600} onCommit={setHeight} />
                                    </div>
                                </div>
                            )}
                            {localities.length > 0 && (
                                <div className="space-y-1">
                                    <Label className="text-xs">Localidad</Label>
                                    <Select value={locality_id} onValueChange={setLocality}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none">Sin localidad</SelectItem>
                                            {localities.map((loc) => (
                                                <SelectItem key={loc.id} value={loc.id}>
                                                    <span className="inline-flex items-center gap-2">
                                                        <span className="h-3 w-3 rounded-sm" style={{ background: loc.color }} />
                                                        {loc.name}
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <p className="text-[11px] text-muted-foreground">
                                Todo esto también se puede ajustar después, mesa por mesa,
                                desde el panel de Propiedades.
                            </p>
                        </CollapsibleContent>
                    </Collapsible>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button
                        onClick={() => onConfirm(
                            isRound
                                ? {
                                    kind: "table_round", label, table_count: tableCount, chairs_count: chairsCount,
                                    locality_id: locality_id === "__none" ? null : locality_id,
                                }
                                : {
                                    kind: "table_rect", label, table_count: tableCount, width, height,
                                    chairs_per_side: { top, right, bottom, left },
                                    locality_id: locality_id === "__none" ? null : locality_id,
                                }
                        )}
                        disabled={!label.trim() || total < 1}
                        data-testid="table-dialog-submit"
                    >
                        Agregar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
