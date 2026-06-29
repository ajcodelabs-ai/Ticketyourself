/**
 * Quick config dialog launched after the user clicks on the canvas with
 * the "zone" tool. Returns initial zone settings (label, capacity, locality).
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

export default function ZoneConfigDialog({ open, onClose, onConfirm, localities }) {
    const [label, setLabel] = useState("Zona");
    const [capacity, setCapacity] = useState(50);
    const [locality_id, setLocality] = useState(localities[0]?.id || "__none");

    useEffect(() => {
        if (open) {
            setLabel("Zona");
            setCapacity(50);
            setLocality(localities[0]?.id || "__none");
        }
    }, [open, localities]);

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Configurar zona no numerada</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="space-y-1">
                        <Label className="text-xs">Nombre</Label>
                        <Input
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="Tribuna Norte, Pit, Gradería…"
                            autoFocus
                            data-testid="zone-dialog-label"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Capacidad</Label>
                        <Input
                            type="number"
                            min={1}
                            value={capacity}
                            onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))}
                            data-testid="zone-dialog-capacity"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Localidad</Label>
                        <Select value={locality_id} onValueChange={setLocality}>
                            <SelectTrigger data-testid="zone-dialog-locality">
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
                                label, capacity,
                                locality_id: locality_id === "__none" ? null : locality_id,
                            })
                        }
                        disabled={!label.trim() || capacity < 1}
                        data-testid="zone-dialog-submit"
                    >
                        Crear zona
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
