/**
 * Right sidebar properties for the currently-selected element.
 * When multi-select, only shows shared/global actions (delete all, assign locality).
 */
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function PropertiesPanel({
    selection,
    elements,
    localities,
    onUpdate,
    onDelete,
    readOnly,
}) {
    const selectedElements = elements.filter((e) => selection.includes(e.id));

    if (selectedElements.length === 0) {
        return (
            <section className="space-y-2" data-testid="properties-panel-empty">
                <h3 className="text-sm font-semibold">Propiedades</h3>
                <p className="text-xs text-muted-foreground">
                    Seleccioná un elemento en el canvas para editarlo.
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    <li>Click = seleccionar</li>
                    <li>Ctrl/Cmd+Click = multi-selección</li>
                    <li>Arrastrá para mover (snap a {20}px)</li>
                    <li>Delete o Backspace = eliminar</li>
                    <li>Wheel = zoom</li>
                </ul>
            </section>
        );
    }

    if (selectedElements.length > 1) {
        return (
            <section className="space-y-3" data-testid="properties-panel-multi">
                <h3 className="text-sm font-semibold">
                    {selectedElements.length} elementos seleccionados
                </h3>
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-red-600 hover:bg-red-50"
                    onClick={() => selection.forEach((id) => onDelete(id))}
                    disabled={readOnly}
                    data-testid="properties-multi-delete"
                >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Eliminar selección
                </Button>
                <p className="text-xs text-muted-foreground">
                    Usá el panel de Localidades para asignar una localidad a todos a la vez.
                </p>
            </section>
        );
    }

    const el = selectedElements[0];

    return (
        <section className="space-y-3" data-testid="properties-panel">
            <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize">
                    {el.kind === "stage" && "Escenario"}
                    {el.kind === "unnumbered_zone" && "Zona no numerada"}
                    {el.kind === "seat_row_straight" && "Fila de asientos"}
                </h3>
                {!readOnly && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onDelete(el.id)}
                        data-testid="properties-delete"
                    >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                )}
            </header>

            <Field label="Etiqueta">
                <Input
                    value={el.label || ""}
                    onChange={(e) => onUpdate(el.id, { label: e.target.value })}
                    disabled={readOnly}
                    className="h-8"
                    data-testid="prop-label"
                />
            </Field>

            <div className="grid grid-cols-2 gap-2">
                <Field label="X">
                    <Input
                        type="number"
                        value={Math.round(el.x)}
                        onChange={(e) => onUpdate(el.id, { x: Number(e.target.value) })}
                        disabled={readOnly}
                        className="h-8"
                    />
                </Field>
                <Field label="Y">
                    <Input
                        type="number"
                        value={Math.round(el.y)}
                        onChange={(e) => onUpdate(el.id, { y: Number(e.target.value) })}
                        disabled={readOnly}
                        className="h-8"
                    />
                </Field>
            </div>

            {(el.kind === "stage" || el.kind === "unnumbered_zone") && (
                <div className="grid grid-cols-2 gap-2">
                    <Field label="Ancho">
                        <Input
                            type="number"
                            value={el.width || 0}
                            min={20}
                            onChange={(e) => onUpdate(el.id, { width: Number(e.target.value) })}
                            disabled={readOnly}
                            className="h-8"
                        />
                    </Field>
                    <Field label="Alto">
                        <Input
                            type="number"
                            value={el.height || 0}
                            min={20}
                            onChange={(e) => onUpdate(el.id, { height: Number(e.target.value) })}
                            disabled={readOnly}
                            className="h-8"
                        />
                    </Field>
                </div>
            )}

            {el.kind === "unnumbered_zone" && (
                <Field label="Capacidad">
                    <Input
                        type="number"
                        min={1}
                        value={el.capacity || 0}
                        onChange={(e) => onUpdate(el.id, { capacity: Math.max(1, Number(e.target.value)) })}
                        disabled={readOnly}
                        className="h-8"
                        data-testid="prop-capacity"
                    />
                </Field>
            )}

            {el.kind === "seat_row_straight" && (
                <>
                    <Field label="Etiqueta de fila (A, B…)">
                        <Input
                            value={el.row_label || ""}
                            onChange={(e) => onUpdate(el.id, { row_label: e.target.value })}
                            disabled={readOnly}
                            className="h-8"
                        />
                    </Field>
                    <Field label={`Asientos (1-200): ${el.seats_count}`}>
                        <Input
                            type="number"
                            min={1}
                            max={200}
                            value={el.seats_count || 1}
                            onChange={(e) =>
                                onUpdate(el.id, {
                                    seats_count: Math.max(1, Math.min(200, Number(e.target.value))),
                                })
                            }
                            disabled={readOnly}
                            className="h-8"
                            data-testid="prop-seats-count"
                        />
                    </Field>
                    <Field label="Separación entre asientos (px)">
                        <Input
                            type="number"
                            min={16}
                            max={64}
                            value={el.seat_spacing || 24}
                            onChange={(e) =>
                                onUpdate(el.id, { seat_spacing: Math.max(16, Number(e.target.value)) })
                            }
                            disabled={readOnly}
                            className="h-8"
                        />
                    </Field>
                    <Field label="Numeración">
                        <Select
                            value={el.numbering_direction || "ltr"}
                            onValueChange={(v) => onUpdate(el.id, { numbering_direction: v })}
                            disabled={readOnly}
                        >
                            <SelectTrigger className="h-8">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ltr">Izquierda → derecha</SelectItem>
                                <SelectItem value="rtl">Derecha → izquierda</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                </>
            )}

            {(el.kind === "unnumbered_zone" || el.kind === "seat_row_straight") && (
                <Field label="Localidad">
                    <Select
                        value={el.locality_id || "__none"}
                        onValueChange={(v) => onUpdate(el.id, { locality_id: v === "__none" ? null : v })}
                        disabled={readOnly}
                    >
                        <SelectTrigger className="h-8" data-testid="prop-locality">
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
                </Field>
            )}

            {el.kind === "stage" && (
                <Field label="Color">
                    <Input
                        type="color"
                        value={el.color || "#9CA3AF"}
                        onChange={(e) => onUpdate(el.id, { color: e.target.value })}
                        disabled={readOnly}
                        className="h-8 cursor-pointer"
                    />
                </Field>
            )}
        </section>
    );
}

function Field({ label, children }) {
    return (
        <div className="space-y-1">
            <Label className="text-xs">{label}</Label>
            {children}
        </div>
    );
}
