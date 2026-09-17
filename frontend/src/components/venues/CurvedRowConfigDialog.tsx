/**
 * Config dialog for curved seat row(s). Primary fields mirror the reference
 * app's minimal "Filas / Asientos por fila" dialog, plus Curvatura since
 * that's what makes this tool distinct from a straight row — everything
 * else (etiqueta, separación, numeración, localidad) is tucked under
 * "Opciones avanzadas", editable later per-row from the Properties Panel.
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
import { CURVATURE_MIN, CURVATURE_MAX, clampCurvature } from "@/lib/venues";
import ClampedNumberInput from "@/components/venues/ClampedNumberInput";

export default function CurvedRowConfigDialog({
    open, onClose, onConfirm, localities, nextRowLabel = "A",
}) {
    const [row_label, setRowLabel] = useState(nextRowLabel);
    const [row_count, setRowCount] = useState(3);
    const [seats_count, setSeats] = useState(12);
    const [curvature, setCurvature] = useState(2);
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
            setSeats(12);
            setCurvature(2);
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
                    <DialogTitle>Agregar filas curvas</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="space-y-1">
                        <Label className="text-xs">Filas</Label>
                        <ClampedNumberInput
                            value={row_count}
                            min={1}
                            max={26}
                            onCommit={setRowCount}
                            testid="curved-row-row-count"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Asientos por fila</Label>
                        <ClampedNumberInput
                            value={seats_count}
                            min={1}
                            max={200}
                            onCommit={setSeats}
                            testid="curved-row-count"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Curvatura</Label>
                        <div className="flex items-center gap-2.5">
                            <input
                                type="range"
                                min={CURVATURE_MIN}
                                max={CURVATURE_MAX}
                                step={0.1}
                                value={curvature}
                                onChange={(e) => setCurvature(clampCurvature(Number(e.target.value)))}
                                className="curvature-slider flex-1"
                                data-testid="curved-row-curvature"
                            />
                            <Input
                                type="number"
                                min={CURVATURE_MIN}
                                max={CURVATURE_MAX}
                                step={0.1}
                                value={curvature}
                                onChange={(e) => setCurvature(clampCurvature(Number(e.target.value)))}
                                className="w-16 text-center"
                            />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Positivo: curva hacia arriba · Negativo: curva hacia abajo · 0: recta
                        </p>
                    </div>

                    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                        <CollapsibleTrigger asChild>
                            <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                data-testid="curved-row-advanced-toggle"
                            >
                                <ChevronDown
                                    className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                                />
                                Opciones avanzadas
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-3 pt-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Etiqueta</Label>
                                <Input value={row_label} onChange={(e) => setRowLabel(e.target.value)}
                                       data-testid="curved-row-label" />
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
                                    testid="curved-row-step"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Define el salto en la numeración (1 = 1,2,3... · 2 = 1,3,5... · 3 = 1,4,7...)
                                </p>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Numeración</Label>
                                <Select value={numbering_direction} onValueChange={setDirection}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                                Todo esto también se puede ajustar después, fila por fila,
                                desde el panel de Propiedades.
                            </p>
                        </CollapsibleContent>
                    </Collapsible>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button
                        onClick={() => onConfirm({
                            row_label, row_count, seats_count, curvature, seat_spacing,
                            numbering_direction, numbering_start, numbering_step,
                            locality_id: locality_id === "__none" ? null : locality_id,
                        })}
                        disabled={!row_label.trim() || seats_count < 1}
                        data-testid="curved-row-submit"
                    >
                        Agregar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
