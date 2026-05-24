/**
 * Right-sidebar properties.
 * Phase 6b: extended to handle 7 element kinds + multi-select alignment +
 * distribute + z-index controls.
 */
import {
    Trash2, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
    AlignStartVertical, AlignCenterVertical, AlignEndVertical,
    AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
    ArrowUpToLine, ArrowDownToLine, Copy,
} from "lucide-react";
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
    onAlign,
    onDistribute,
    onBringFront,
    onSendBack,
    onDuplicate,
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
                    <li>Click = seleccionar · Ctrl/Cmd+Click = multi</li>
                    <li>Drag en zona vacía = selección por marquee</li>
                    <li>Drag elemento = mover (snap 20px)</li>
                    <li>Delete / Backspace = eliminar</li>
                    <li>Ctrl+A / Ctrl+D / Ctrl+C / Ctrl+V</li>
                    <li>Ctrl+Z / Ctrl+Shift+Z = undo/redo</li>
                    <li>Click derecho = menú contextual</li>
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
                <div className="space-y-1.5">
                    <Label className="text-xs">Alinear</Label>
                    <div className="grid grid-cols-3 gap-1">
                        <AlignBtn data-testid="align-left" onClick={() => onAlign("left")} icon={AlignStartVertical} label="Izquierda" />
                        <AlignBtn data-testid="align-cx" onClick={() => onAlign("cx")} icon={AlignCenterVertical} label="Centro V" />
                        <AlignBtn data-testid="align-right" onClick={() => onAlign("right")} icon={AlignEndVertical} label="Derecha" />
                        <AlignBtn data-testid="align-top" onClick={() => onAlign("top")} icon={AlignStartHorizontal} label="Arriba" />
                        <AlignBtn data-testid="align-cy" onClick={() => onAlign("cy")} icon={AlignCenterHorizontal} label="Centro H" />
                        <AlignBtn data-testid="align-bottom" onClick={() => onAlign("bottom")} icon={AlignEndHorizontal} label="Abajo" />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs">Distribuir</Label>
                    <div className="grid grid-cols-2 gap-1">
                        <AlignBtn data-testid="dist-h" onClick={() => onDistribute("h")} icon={AlignHorizontalDistributeCenter} label="Horizontal" />
                        <AlignBtn data-testid="dist-v" onClick={() => onDistribute("v")} icon={AlignVerticalDistributeCenter} label="Vertical" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-1">
                    <Button variant="outline" size="sm" onClick={onDuplicate} data-testid="multi-duplicate">
                        <Copy className="h-3.5 w-3.5 mr-1.5" /> Duplicar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => selection.forEach(onDelete)}
                            disabled={readOnly} data-testid="multi-delete"
                            className="text-red-600 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Eliminar
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Usá el panel de Localidades para asignar la misma localidad a todos.
                </p>
            </section>
        );
    }

    const el = selectedElements[0];
    const titleByKind = {
        stage: "Escenario",
        unnumbered_zone: "Zona no numerada",
        seat_row_straight: "Fila recta",
        seat_row_curved: "Fila curva",
        seat_individual: "Asiento",
        table_round: "Mesa redonda",
        table_rect: "Mesa rectangular",
    };

    return (
        <section className="space-y-3" data-testid="properties-panel">
            <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{titleByKind[el.kind] || el.kind}</h3>
                {!readOnly && (
                    <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={onBringFront} title="Traer al frente">
                            <ArrowUpToLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={onSendBack} title="Enviar al fondo">
                            <ArrowDownToLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={onDuplicate} title="Duplicar">
                            <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => onDelete(el.id)} data-testid="properties-delete">
                            <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                    </div>
                )}
            </header>

            <Field label="Etiqueta">
                <Input value={el.label || ""} disabled={readOnly} className="h-8"
                       onChange={(e) => onUpdate(el.id, { label: e.target.value })}
                       data-testid="prop-label" />
            </Field>

            <div className="grid grid-cols-2 gap-2">
                <Field label="X"><Input type="number" value={Math.round(el.x)} disabled={readOnly} className="h-8"
                                        onChange={(e) => onUpdate(el.id, { x: Number(e.target.value) })} /></Field>
                <Field label="Y"><Input type="number" value={Math.round(el.y)} disabled={readOnly} className="h-8"
                                        onChange={(e) => onUpdate(el.id, { y: Number(e.target.value) })} /></Field>
                <Field label="Rotación (°)"><Input type="number" value={Math.round(el.rotation || 0)}
                                                    disabled={readOnly} className="h-8"
                                                    onChange={(e) => onUpdate(el.id, { rotation: Number(e.target.value) })} /></Field>
            </div>

            {(el.kind === "stage" || el.kind === "unnumbered_zone" || el.kind === "table_rect") && (
                <div className="grid grid-cols-2 gap-2">
                    <Field label="Ancho"><Input type="number" value={el.width || 0} min={20} disabled={readOnly} className="h-8"
                                                onChange={(e) => onUpdate(el.id, { width: Number(e.target.value) })} /></Field>
                    <Field label="Alto"><Input type="number" value={el.height || 0} min={20} disabled={readOnly} className="h-8"
                                                onChange={(e) => onUpdate(el.id, { height: Number(e.target.value) })} /></Field>
                </div>
            )}

            {el.kind === "unnumbered_zone" && (
                <Field label="Capacidad">
                    <Input type="number" min={1} value={el.capacity || 0} disabled={readOnly} className="h-8"
                           data-testid="prop-capacity"
                           onChange={(e) => onUpdate(el.id, { capacity: Math.max(1, Number(e.target.value)) })} />
                </Field>
            )}

            {(el.kind === "seat_row_straight" || el.kind === "seat_row_curved") && (
                <>
                    <Field label="Etiqueta de fila">
                        <Input value={el.row_label || ""} disabled={readOnly} className="h-8"
                               onChange={(e) => onUpdate(el.id, { row_label: e.target.value })} />
                    </Field>
                    <Field label={`Asientos (1-200): ${el.seats_count}`}>
                        <Input type="number" min={1} max={200} value={el.seats_count || 1}
                               disabled={readOnly} className="h-8" data-testid="prop-seats-count"
                               onChange={(e) => onUpdate(el.id, { seats_count: Math.max(1, Math.min(200, Number(e.target.value))) })} />
                    </Field>
                    <Field label="Separación (px)">
                        <Input type="number" min={16} max={64} value={el.seat_spacing || 24}
                               disabled={readOnly} className="h-8"
                               onChange={(e) => onUpdate(el.id, { seat_spacing: Math.max(16, Number(e.target.value)) })} />
                    </Field>
                    {el.kind === "seat_row_curved" && (
                        <div className="grid grid-cols-2 gap-2">
                            <Field label="Radio del arco">
                                <Input type="number" min={60} value={el.curve_radius || 240}
                                       disabled={readOnly} className="h-8"
                                       onChange={(e) => onUpdate(el.id, { curve_radius: Math.max(60, Number(e.target.value)) })} />
                            </Field>
                            <Field label="Ángulo arco (°)">
                                <Input type="number" min={10} max={180} value={el.curve_arc_degrees || 60}
                                       disabled={readOnly} className="h-8"
                                       onChange={(e) => onUpdate(el.id, { curve_arc_degrees: Math.max(10, Math.min(180, Number(e.target.value))) })} />
                            </Field>
                        </div>
                    )}
                    <Field label="Numeración">
                        <Select value={el.numbering_direction || "ltr"} disabled={readOnly}
                                onValueChange={(v) => onUpdate(el.id, { numbering_direction: v })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ltr">Izquierda → derecha</SelectItem>
                                <SelectItem value="rtl">Derecha → izquierda</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                </>
            )}

            {el.kind === "table_round" && (
                <>
                    <div className="grid grid-cols-2 gap-2">
                        <Field label="Sillas (2-12)">
                            <Input type="number" min={2} max={12} value={el.chairs_count || 6}
                                   disabled={readOnly} className="h-8" data-testid="prop-chairs-count"
                                   onChange={(e) => onUpdate(el.id, { chairs_count: Math.max(2, Math.min(12, Number(e.target.value))) })} />
                        </Field>
                        <Field label="Radio mesa">
                            <Input type="number" min={20} value={el.table_radius || 40}
                                   disabled={readOnly} className="h-8"
                                   onChange={(e) => onUpdate(el.id, { table_radius: Math.max(20, Number(e.target.value)) })} />
                        </Field>
                    </div>
                    <Field label="Distancia silla → mesa">
                        <Input type="number" min={6} value={el.chair_distance || 22}
                               disabled={readOnly} className="h-8"
                               onChange={(e) => onUpdate(el.id, { chair_distance: Math.max(6, Number(e.target.value)) })} />
                    </Field>
                </>
            )}

            {el.kind === "table_rect" && (
                <div className="grid grid-cols-2 gap-2">
                    <Field label="Sillas arriba">
                        <Input type="number" min={0} max={12}
                               value={el.chairs_per_side?.top || 0} disabled={readOnly} className="h-8"
                               onChange={(e) => onUpdate(el.id, {
                                   chairs_per_side: { ...el.chairs_per_side, top: Math.max(0, Math.min(12, Number(e.target.value))) },
                               })} />
                    </Field>
                    <Field label="Sillas abajo">
                        <Input type="number" min={0} max={12}
                               value={el.chairs_per_side?.bottom || 0} disabled={readOnly} className="h-8"
                               onChange={(e) => onUpdate(el.id, {
                                   chairs_per_side: { ...el.chairs_per_side, bottom: Math.max(0, Math.min(12, Number(e.target.value))) },
                               })} />
                    </Field>
                    <Field label="Sillas izquierda">
                        <Input type="number" min={0} max={8}
                               value={el.chairs_per_side?.left || 0} disabled={readOnly} className="h-8"
                               onChange={(e) => onUpdate(el.id, {
                                   chairs_per_side: { ...el.chairs_per_side, left: Math.max(0, Math.min(8, Number(e.target.value))) },
                               })} />
                    </Field>
                    <Field label="Sillas derecha">
                        <Input type="number" min={0} max={8}
                               value={el.chairs_per_side?.right || 0} disabled={readOnly} className="h-8"
                               onChange={(e) => onUpdate(el.id, {
                                   chairs_per_side: { ...el.chairs_per_side, right: Math.max(0, Math.min(8, Number(e.target.value))) },
                               })} />
                    </Field>
                </div>
            )}

            {el.kind === "seat_individual" && (
                <Field label="Radio">
                    <Input type="number" min={6} max={24} value={el.seat_radius || 12}
                           disabled={readOnly} className="h-8"
                           onChange={(e) => onUpdate(el.id, { seat_radius: Math.max(6, Math.min(24, Number(e.target.value))) })} />
                </Field>
            )}

            {el.kind !== "stage" && (
                <Field label="Localidad">
                    <Select value={el.locality_id || "__none"} disabled={readOnly}
                            onValueChange={(v) => onUpdate(el.id, { locality_id: v === "__none" ? null : v })}>
                        <SelectTrigger className="h-8" data-testid="prop-locality"><SelectValue /></SelectTrigger>
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
                </Field>
            )}

            {el.kind === "stage" && (
                <Field label="Color">
                    <Input type="color" value={el.color || "#9CA3AF"} disabled={readOnly} className="h-8 cursor-pointer"
                           onChange={(e) => onUpdate(el.id, { color: e.target.value })} />
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

function AlignBtn({ icon: Icon, label, onClick, ...rest }) {
    return (
        <Button variant="outline" size="sm" className="h-8 px-2 text-xs"
                onClick={onClick} title={label} {...rest}>
            <Icon className="h-3.5 w-3.5" />
        </Button>
    );
}
