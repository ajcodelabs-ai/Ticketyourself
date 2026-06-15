/**
 * Single dialog used for both round and rectangular tables, picked via `kind`.
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

export default function TableConfigDialog({ open, kind, onClose, onConfirm, localities }) {
    const isRound = kind === "table_round";
    const [label, setLabel] = useState(isRound ? "Mesa 1" : "Mesa rect.");
    const [chairsCount, setChairsCount] = useState(6);
    const [width, setWidth] = useState(200);
    const [height, setHeight] = useState(100);
    const [top, setTop] = useState(4);
    const [bottom, setBottom] = useState(4);
    const [left, setLeft] = useState(0);
    const [right, setRight] = useState(0);
    const [locality_id, setLocality] = useState(localities[0]?.id || "__none");

    useEffect(() => {
        if (open) {
            setLabel(isRound ? "Mesa 1" : "Mesa rect.");
            setChairsCount(6);
            setWidth(200); setHeight(100);
            setTop(4); setBottom(4); setLeft(0); setRight(0);
            setLocality(localities[0]?.id || "__none");
        }
    }, [open, kind, localities, isRound]);

    const total = isRound ? chairsCount : top + right + bottom + left;

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {isRound ? "Configurar mesa redonda" : "Configurar mesa rectangular"}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="space-y-1">
                        <Label className="text-xs">Nombre</Label>
                        <Input value={label} onChange={(e) => setLabel(e.target.value)}
                               autoFocus data-testid="table-dialog-label" />
                    </div>

                    {isRound ? (
                        <div className="space-y-1">
                            <Label className="text-xs">Sillas (2-12)</Label>
                            <Input type="number" min={2} max={12} value={chairsCount}
                                   onChange={(e) => setChairsCount(Math.max(2, Math.min(12, Number(e.target.value))))}
                                   data-testid="table-round-chairs" />
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">Ancho (px)</Label>
                                    <Input type="number" min={80} value={width}
                                           onChange={(e) => setWidth(Math.max(80, Number(e.target.value)))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Alto (px)</Label>
                                    <Input type="number" min={60} value={height}
                                           onChange={(e) => setHeight(Math.max(60, Number(e.target.value)))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">Sillas arriba</Label>
                                    <Input type="number" min={0} max={12} value={top}
                                           onChange={(e) => setTop(Math.max(0, Math.min(12, Number(e.target.value))))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Sillas abajo</Label>
                                    <Input type="number" min={0} max={12} value={bottom}
                                           onChange={(e) => setBottom(Math.max(0, Math.min(12, Number(e.target.value))))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Sillas izquierda</Label>
                                    <Input type="number" min={0} max={8} value={left}
                                           onChange={(e) => setLeft(Math.max(0, Math.min(8, Number(e.target.value))))} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Sillas derecha</Label>
                                    <Input type="number" min={0} max={8} value={right}
                                           onChange={(e) => setRight(Math.max(0, Math.min(8, Number(e.target.value))))} />
                                </div>
                            </div>
                        </>
                    )}

                    <p className="text-xs text-muted-foreground" data-testid="table-dialog-total">
                        Total sillas: <strong>{total}</strong>
                    </p>

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
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button
                        onClick={() => onConfirm(
                            isRound
                                ? {
                                    kind: "table_round", label, chairs_count: chairsCount,
                                    locality_id: locality_id === "__none" ? null : locality_id,
                                }
                                : {
                                    kind: "table_rect", label, width, height,
                                    chairs_per_side: { top, right, bottom, left },
                                    locality_id: locality_id === "__none" ? null : locality_id,
                                }
                        )}
                        disabled={!label.trim() || total < 1}
                        data-testid="table-dialog-submit"
                    >
                        {isRound ? "Crear mesa redonda" : "Crear mesa rectangular"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
