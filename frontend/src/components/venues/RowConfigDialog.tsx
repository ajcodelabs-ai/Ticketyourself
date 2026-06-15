/**
 * Quick config dialog for a new seat row.
 */
import { useState, useEffect } from "react";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function RowConfigDialog({
    open, onClose, onConfirm, localities, nextRowLabel = "A",
}) {
    const [row_label, setRowLabel] = useState(nextRowLabel);
    const [seats_count, setSeats] = useState(10);
    const [seat_spacing, setSpacing] = useState(24);
    const [numbering_direction, setDirection] = useState("ltr");
    const [numbering_start, setStart] = useState(1);
    const [locality_id, setLocality] = useState(localities[0]?.id || "__none");

    useEffect(() => {
        if (open) {
            setRowLabel(nextRowLabel);
            setSeats(10);
            setSpacing(24);
            setDirection("ltr");
            setStart(1);
            setLocality(localities[0]?.id || "__none");
        }
    }, [open, nextRowLabel, localities]);

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Configurar fila recta</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <Label className="text-xs">Etiqueta (A, B, 1…)</Label>
                            <Input
                                value={row_label}
                                onChange={(e) => setRowLabel(e.target.value)}
                                autoFocus
                                data-testid="row-dialog-label"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Cantidad (1-200)</Label>
                            <Input
                                type="number"
                                min={1}
                                max={200}
                                value={seats_count}
                                onChange={(e) =>
                                    setSeats(Math.max(1, Math.min(200, Number(e.target.value))))
                                }
                                data-testid="row-dialog-count"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <Label className="text-xs">Separación (px)</Label>
                            <Input
                                type="number"
                                min={16}
                                max={64}
                                value={seat_spacing}
                                onChange={(e) =>
                                    setSpacing(Math.max(16, Math.min(64, Number(e.target.value))))
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Primer asiento</Label>
                            <Input
                                type="number"
                                min={0}
                                value={numbering_start}
                                onChange={(e) => setStart(Math.max(0, Number(e.target.value)))}
                            />
                        </div>
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
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button
                        onClick={() =>
                            onConfirm({
                                row_label, seats_count, seat_spacing,
                                numbering_direction, numbering_start,
                                locality_id: locality_id === "__none" ? null : locality_id,
                            })
                        }
                        disabled={!row_label.trim() || seats_count < 1}
                        data-testid="row-dialog-submit"
                    >
                        Crear fila
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
