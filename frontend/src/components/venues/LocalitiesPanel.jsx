/**
 * Localities sidebar — list + create + assign-to-selection.
 */
import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { capacityByLocality, LOCALITY_PALETTE, newLocality } from "@/lib/venues";
import { toast } from "sonner";

export default function LocalitiesPanel({
    localities,
    elements,
    selection,
    onAdd,
    onUpdate,
    onDelete,
    onAssign,
    readOnly,
}) {
    const [showNew, setShowNew] = useState(false);
    const [draft, setDraft] = useState(newLocality());

    const handleCreate = () => {
        if (!draft.name.trim()) {
            toast.error("Poné un nombre a la localidad");
            return;
        }
        onAdd(draft);
        setShowNew(false);
        setDraft(newLocality("Localidad", localities.length + 1));
    };

    return (
        <section className="space-y-3" data-testid="localities-panel">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold">Localidades</h3>
                    <p className="text-xs text-muted-foreground">{localities.length} total</p>
                </div>
                {!readOnly && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            setDraft(newLocality("Localidad", localities.length));
                            setShowNew(true);
                        }}
                        data-testid="locality-add"
                    >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Nueva
                    </Button>
                )}
            </div>

            <div className="space-y-2">
                {localities.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                        Aún sin localidades. Creá una para empezar a colorear zonas y asientos.
                    </p>
                )}
                {localities.map((loc) => {
                    const used = capacityByLocality(elements, loc.id);
                    return (
                        <div
                            key={loc.id}
                            className="border rounded-md p-2.5 space-y-2"
                            data-testid={`locality-row-${loc.id}`}
                        >
                            <div className="flex items-center gap-2">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button
                                            disabled={readOnly}
                                            className="h-6 w-6 rounded-md ring-1 ring-slate-300 shrink-0 disabled:opacity-50"
                                            style={{ background: loc.color }}
                                            aria-label="Cambiar color"
                                            data-testid={`locality-color-${loc.id}`}
                                        />
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-2">
                                        <HexColorPicker
                                            color={loc.color}
                                            onChange={(c) => onUpdate(loc.id, { color: c })}
                                        />
                                        <div className="flex gap-1 mt-2 flex-wrap">
                                            {LOCALITY_PALETTE.map((c) => (
                                                <button
                                                    key={c}
                                                    className="h-5 w-5 rounded ring-1 ring-slate-200"
                                                    style={{ background: c }}
                                                    onClick={() => onUpdate(loc.id, { color: c })}
                                                />
                                            ))}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                                <Input
                                    value={loc.name}
                                    onChange={(e) => onUpdate(loc.id, { name: e.target.value })}
                                    disabled={readOnly}
                                    className="h-8 text-sm"
                                    data-testid={`locality-name-${loc.id}`}
                                />
                                {!readOnly && (
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 shrink-0"
                                        onClick={() => onDelete(loc.id)}
                                        data-testid={`locality-delete-${loc.id}`}
                                    >
                                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                    </Button>
                                )}
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className={used === 0 ? "text-muted-foreground italic" : "text-muted-foreground"}>
                                    {used === 0 ? "Sin asignar" : `${used} asientos asignados`}
                                </span>
                                {!readOnly && selection.length > 0 && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 text-xs"
                                        onClick={() => onAssign(loc.id)}
                                        data-testid={`locality-assign-${loc.id}`}
                                    >
                                        <Wand2 className="h-3 w-3 mr-1" />
                                        Asignar a selección ({selection.length})
                                    </Button>
                                )}
                            </div>
                            <details className="text-xs">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                    Detalle
                                </summary>
                                <div className="pt-2 space-y-1.5">
                                    <Input
                                        placeholder="Descripción"
                                        value={loc.description || ""}
                                        onChange={(e) => onUpdate(loc.id, { description: e.target.value })}
                                        disabled={readOnly}
                                        className="h-7 text-xs"
                                    />
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-muted-foreground">USD</span>
                                        <Input
                                            type="number"
                                            placeholder="Precio sugerido"
                                            value={
                                                loc.default_price_cents != null
                                                    ? loc.default_price_cents / 100
                                                    : ""
                                            }
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                onUpdate(loc.id, {
                                                    default_price_cents: v === "" ? null : Math.round(parseFloat(v) * 100),
                                                });
                                            }}
                                            disabled={readOnly}
                                            className="h-7 text-xs"
                                        />
                                    </div>
                                </div>
                            </details>
                        </div>
                    );
                })}
            </div>

            <Dialog open={showNew} onOpenChange={setShowNew}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nueva localidad</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="text-xs">Nombre</Label>
                            <Input
                                value={draft.name}
                                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                placeholder="VIP, Platea, General…"
                                autoFocus
                                data-testid="locality-new-name"
                            />
                        </div>
                        <div>
                            <Label className="text-xs">Color</Label>
                            <div className="flex gap-1 mt-1 flex-wrap">
                                {LOCALITY_PALETTE.map((c) => (
                                    <button
                                        key={c}
                                        className={`h-7 w-7 rounded ring-2 ${
                                            draft.color === c ? "ring-slate-900" : "ring-slate-200"
                                        }`}
                                        style={{ background: c }}
                                        onClick={() => setDraft({ ...draft, color: c })}
                                    />
                                ))}
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs">Precio sugerido (USD)</Label>
                            <Input
                                type="number"
                                placeholder="ej. 25"
                                value={
                                    draft.default_price_cents != null
                                        ? draft.default_price_cents / 100
                                        : ""
                                }
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        default_price_cents:
                                            e.target.value === ""
                                                ? null
                                                : Math.round(parseFloat(e.target.value) * 100),
                                    })
                                }
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setShowNew(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleCreate} data-testid="locality-new-submit">
                            Crear localidad
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}
