/**
 * Config dialog for new seat row(s). Primary fields match the reference
 * app's "Agregar filas de asientos" dialog exactly (Filas / Asientos por
 * fila) — everything else (etiqueta, separación, numeración, localidad)
 * is tucked under "Opciones avanzadas", editable later per-row from the
 * Properties Panel either way.
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

export default function RowConfigDialog({
    open, onClose, onConfirm, localities, nextRowLabel = "A",
}) {
    const [row_label, setRowLabel] = useState(nextRowLabel);
    const [row_count, setRowCount] = useState(3);
    const [seats_count, setSeats] = useState(10);
    const [seat_spacing, setSpacing] = useState(24);
    const [numbering_direction, setDirection] = useState("ltr");
    const [numbering_start, setStart] = useState(1);
    const [numbering_step, setStep] = useState(1);
    const [locality_id, setLocality] = useState(localities[0]?.id || "__none");
    const [advancedOpen, setAdvancedOpen] = useState(false);

    useEffect(() => {
        if (open) {
            setRowLabel(nextRowLabel);
            setRowCount(3);
            setSeats(10);
            setSpacing(24);
            setDirection("ltr");
            setStart(1);
            setStep(1);
            setLocality(localities[0]?.id || "__none");
            setAdvancedOpen(false);
        }
    }, [open, nextRowLabel, localities]);

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Agregar filas de asientos</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="space-y-1">
                        <Label className="text-xs">Filas</Label>
                        <ClampedNumberInput
                            value={row_count}
                            min={1}
                            max={26}
                            onCommit={setRowCount}
                            testid="row-dialog-row-count"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Asientos por fila</Label>
                        <ClampedNumberInput
                            value={seats_count}
                            min={1}
                            max={200}
                            onCommit={setSeats}
                            testid="row-dialog-count"
                        />
                    </div>

                    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                        <CollapsibleTrigger asChild>
                            <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                data-testid="row-dialog-advanced-toggle"
                            >
                                <ChevronDown
                                    className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                                />
                                Opciones avanzadas
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-3 pt-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Etiqueta (A, B, 1…)</Label>
                                <Input
                                    value={row_label}
                                    onChange={(e) => setRowLabel(e.target.value)}
                                    data-testid="row-dialog-label"
                                />
                                {row_count > 1 && (
                                    <p className="text-[11px] text-muted-foreground">
                                        Cada fila nueva sigue la correlativa ({row_label},{" "}
                                        {row_label ? String.fromCharCode(row_label.charCodeAt(0) + 1) : "B"}…).
                                    </p>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">Separación (px)</Label>
                                    <ClampedNumberInput
                                        value={seat_spacing}
                                        min={16}
                                        max={64}
                                        onCommit={setSpacing}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Primer asiento</Label>
                                    <ClampedNumberInput
                                        value={numbering_start}
                                        min={0}
                                        max={9999}
                                        onCommit={setStart}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Incremento de numeración</Label>
                                <ClampedNumberInput
                                    value={numbering_step}
                                    min={1}
                                    max={100}
                                    onCommit={setStep}
                                    testid="row-dialog-step"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Define el salto en la numeración (1 = 1,2,3... · 2 = 1,3,5... · 3 = 1,4,7...)
                                </p>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Numeración</Label>
                                <Select value={numbering_direction} onValueChange={setDirection}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ltr">Izquierda → derecha</SelectItem>
                                        <SelectItem value="rtl">Derecha → izquierda</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {localities.length > 0 && (
                                <div className="space-y-1">
                                    <Label className="text-xs">Localidad</Label>
                                    <Select value={locality_id} onValueChange={setLocality}>
                                        <SelectTrigger data-testid="row-dialog-locality">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none">Sin localidad</SelectItem>
                                            {localities.map((loc) => (
                                                <SelectItem key={loc.id} value={loc.id}>
                                                    <span className="inline-flex items-center gap-2">
                                                        <span
                                                            className="h-3 w-3 rounded-sm"
                                                            style={{ background: loc.color }}
                                                        />
                                                        {loc.name}
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <p className="text-[11px] text-muted-foreground">
                                Todo esto también se puede ajustar después, fila por fila,
                                desde el panel de Propiedades.
                            </p>
                        </CollapsibleContent>
                    </Collapsible>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button
                        onClick={() =>
                            onConfirm({
                                row_label, row_count, seats_count, seat_spacing,
                                numbering_direction, numbering_start, numbering_step,
                                locality_id: locality_id === "__none" ? null : locality_id,
                            })
                        }
                        disabled={!row_label.trim() || seats_count < 1}
                        data-testid="row-dialog-submit"
                    >
                        Agregar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
