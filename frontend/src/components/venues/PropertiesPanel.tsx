/**
 * Right-sidebar properties.
 * Phase 6b: extended to handle 7 element kinds + multi-select alignment +
 * distribute + z-index controls.
 * Reskinned to match the legacy venue-designer look: purple gradient header,
 * single "Curvatura" slider (-10..10) for curved rows.
 */
import {
    Trash2, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
    AlignStartVertical, AlignCenterVertical, AlignEndVertical,
    AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
    ArrowUpToLine, ArrowDownToLine, Copy, Ungroup,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CURVATURE_MIN, CURVATURE_MAX, clampCurvature, curvatureToArcFields, arcFieldsToCurvature } from "@/lib/venues";
import ClampedNumberInput from "@/components/venues/ClampedNumberInput";

const MAX_ELEMENT_SIZE = 3000;
const MAX_TABLE_RADIUS = 200;
const MAX_CHAIR_DISTANCE = 100;

const FULL_PURCHASE_KINDS = ["seat_row_straight", "seat_row_curved", "table_round", "table_rect"];
// Mirrors EditorCanvas.tsx's NO_DRAG_RESIZE_KINDS: rows/tables can't be
// drag-resized (their "size" is a seat/chair count or a radius shared with
// dependent sub-elements) — only rotated. Kept in sync so this panel's hint
// text never claims a capability that isn't actually there.
const NO_DRAG_RESIZE_KINDS = new Set(["seat_row_straight", "seat_row_curved", "table_round", "table_rect"]);

const titleByKind = {
    stage: "Escenario",
    unnumbered_zone: "Zona no numerada",
    seat_row_straight: "Fila recta",
    seat_row_curved: "Fila curva",
    seat_individual: "Asiento",
    table_round: "Mesa redonda",
    table_rect: "Mesa rectangular",
};

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
    onExplodeRows,
    readOnly,
}) {
    const selectedElements = elements.filter((e) => selection.includes(e.id));

    if (selectedElements.length === 0) {
        return (
            <section className="rounded-xl border bg-secondary/30 overflow-hidden" data-testid="properties-panel-empty">
                <div className="p-4 space-y-3">
                    <div>
                        <h3 className="text-sm font-medium">Propiedades</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Seleccioná un elemento en el canvas para editarlo.
                        </p>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1.5 rounded-lg border border-dashed bg-card p-3">
                        <li>Click = seleccionar · Ctrl/Cmd+Click = multi</li>
                        <li>Drag en vacío = marquee · Drag elemento = mover</li>
                        <li>Fila = objeto completo → convertí a individuales para editar asientos sueltos</li>
                        <li>Delete = eliminar · Ctrl+Z = deshacer</li>
                        <li>Click derecho = menú contextual</li>
                    </ul>
                </div>
            </section>
        );
    }

    if (selectedElements.length > 1) {
        const firstKind = selectedElements[0].kind;
        const allSameKind = selectedElements.every((el) => el.kind === firstKind);
        // Shared value across the whole selection, or "" when they differ —
        // mirrors the reference app's multi-select panel (shows the common
        // value when every selected element agrees, blank otherwise).
        const commonValue = (field) => {
            const first = selectedElements[0][field];
            return selectedElements.every((el) => el[field] === first) ? first : "";
        };
        const batchUpdate = (field, value) => {
            selectedElements.forEach((el) => onUpdate(el.id, { [field]: value }));
        };
        const sizeFieldByKind = {
            unnumbered_zone: { field: "capacity", label: "Capacidad", min: 1 },
            seat_row_straight: { field: "seats_count", label: "Asientos por fila", min: 1, max: 200 },
            seat_row_curved: { field: "seats_count", label: "Asientos por fila", min: 1, max: 200 },
            table_round: { field: "chairs_count", label: "Sillas", min: 2, max: 12 },
        };
        const sizeField = allSameKind ? sizeFieldByKind[firstKind] : null;
        const isRowSelection = allSameKind
            && (firstKind === "seat_row_straight" || firstKind === "seat_row_curved");

        return (
            <section className="rounded-xl border bg-card overflow-hidden" data-testid="properties-panel-multi">
                <header className="venue-brand-gradient px-4 py-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">Propiedades</h3>
                    <span className="text-[11px] text-white/85 bg-white/15 rounded-full px-2 py-0.5 shrink-0">
                        {selectedElements.length} elementos
                    </span>
                </header>
                <div className="p-4 space-y-3">
                    <Field label="Nombre">
                        <Input value="" disabled placeholder="Selección múltiple" className="h-8" />
                    </Field>
                    <p className="text-[11px] text-muted-foreground -mt-2">
                        El nombre es individual. Seleccioná un solo elemento para editarlo.
                    </p>

                    {sizeField && (
                        <Field label={sizeField.label}>
                            <ClampedNumberInput
                                value={commonValue(sizeField.field) || sizeField.min}
                                min={sizeField.min}
                                max={sizeField.max}
                                disabled={readOnly}
                                onCommit={(n) => batchUpdate(sizeField.field, n)}
                            />
                        </Field>
                    )}

                    <Field label="Rotación (°)">
                        <Input
                            type="number"
                            disabled={readOnly}
                            value={commonValue("rotation")}
                            placeholder="Distintos"
                            className="h-8"
                            onChange={(e) => {
                                if (e.target.value === "") return;
                                batchUpdate("rotation", Number(e.target.value));
                            }}
                        />
                    </Field>

                    {isRowSelection && (
                        <>
                            <div className="pt-1">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Configuración de fila
                                </Label>
                            </div>
                            <Field label="Inicia conteo en">
                                <Input
                                    type="number"
                                    min={0}
                                    disabled={readOnly}
                                    value={commonValue("numbering_start")}
                                    placeholder="Distintos"
                                    className="h-8"
                                    onChange={(e) => {
                                        if (e.target.value === "") return;
                                        batchUpdate("numbering_start", Math.max(0, Number(e.target.value)));
                                    }}
                                />
                            </Field>
                            <Field label="Incremento de numeración">
                                <Input
                                    type="number"
                                    min={1}
                                    max={100}
                                    disabled={readOnly}
                                    value={commonValue("numbering_step")}
                                    placeholder="Distintos"
                                    className="h-8"
                                    onChange={(e) => {
                                        if (e.target.value === "") return;
                                        batchUpdate("numbering_step", Math.max(1, Math.min(100, Number(e.target.value))));
                                    }}
                                />
                            </Field>
                        </>
                    )}

                    <p className="text-xs text-muted-foreground">
                        Tipo: {allSameKind ? (titleByKind[firstKind] || firstKind) : "Elementos mixtos"}
                    </p>

                    {selectedElements.some((el) => NO_DRAG_RESIZE_KINDS.has(el.kind)) ? (
                        <p className="text-xs text-muted-foreground rounded-lg border border-dashed p-2.5">
                            La selección incluye filas y/o mesas: se pueden rotar todas
                            juntas arrastrando el recuadro del canvas, pero el tamaño
                            (asientos, sillas, radio) se ajusta una por una desde su
                            propio panel de propiedades.
                        </p>
                    ) : (
                        <p className="text-xs text-muted-foreground rounded-lg border border-dashed p-2.5">
                            Arrastrá cualquiera de las esquinas del recuadro punteado en el
                            canvas para escalar todo el grupo junto (mantené presionado{" "}
                            <kbd className="px-1 py-0.5 rounded border bg-secondary/50 text-[10px]">Shift</kbd>{" "}
                            para escalar proporcionalmente).
                        </p>
                    )}
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
                        <Button variant="outline" size="sm" onClick={() => onDelete(selection)}
                                disabled={readOnly} data-testid="multi-delete"
                                className="text-red-600 hover:bg-red-50">
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Eliminar
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Usá el panel de Localidades para asignar la misma localidad a todos.
                    </p>
                </div>
            </section>
        );
    }

    const el = selectedElements[0];
    const curvature = el.kind === "seat_row_curved"
        ? clampCurvature(el.curvature ?? arcFieldsToCurvature(el.curve_arc_degrees))
        : 0;

    return (
        <section className="rounded-xl border bg-card overflow-hidden" data-testid="properties-panel">
            <header className="venue-brand-gradient px-4 py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white">{titleByKind[el.kind] || el.kind}</h3>
                    <p className="text-xs text-white/75 truncate">{el.label || "Sin etiqueta"}</p>
                </div>
                {!readOnly && (
                    <div className="flex gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/20 hover:text-white"
                                onClick={onBringFront} title="Traer al frente">
                            <ArrowUpToLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/20 hover:text-white"
                                onClick={onSendBack} title="Enviar al fondo">
                            <ArrowDownToLine className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/20 hover:text-white"
                                onClick={onDuplicate} title="Duplicar">
                            <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/20 hover:text-white"
                                onClick={() => onDelete(el.id)} data-testid="properties-delete">
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                )}
            </header>

            <div className="p-4 space-y-3">
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
                        <Field label="Ancho">
                            <ClampedNumberInput
                                value={el.width || 100}
                                min={20}
                                max={MAX_ELEMENT_SIZE}
                                disabled={readOnly}
                                onCommit={(n) => onUpdate(el.id, { width: n })}
                            />
                        </Field>
                        <Field label="Alto">
                            <ClampedNumberInput
                                value={el.height || 80}
                                min={20}
                                max={MAX_ELEMENT_SIZE}
                                disabled={readOnly}
                                onCommit={(n) => onUpdate(el.id, { height: n })}
                            />
                        </Field>
                    </div>
                )}

                {el.kind === "unnumbered_zone" && (
                    <Field label="Capacidad">
                        <ClampedNumberInput
                            value={el.capacity ?? 1}
                            min={1}
                            disabled={readOnly}
                            testid="prop-capacity"
                            onCommit={(n) => onUpdate(el.id, { capacity: n })}
                        />
                    </Field>
                )}

                {(el.kind === "seat_row_straight" || el.kind === "seat_row_curved") && (
                    <>
                        <Field label="Etiqueta de fila">
                            <Input value={el.row_label || ""} disabled={readOnly} className="h-8"
                                   onChange={(e) => onUpdate(el.id, { row_label: e.target.value })} />
                        </Field>
                        <Field label={`Asientos (1-200): ${el.seats_count}`}>
                            <ClampedNumberInput
                                value={el.seats_count || 1}
                                min={1}
                                max={200}
                                disabled={readOnly}
                                testid="prop-seats-count"
                                onCommit={(n) => onUpdate(el.id, { seats_count: n })}
                            />
                        </Field>
                        <Field label="Separación (px)">
                            <ClampedNumberInput
                                value={el.seat_spacing || 24}
                                min={16}
                                max={64}
                                disabled={readOnly}
                                onCommit={(n) => onUpdate(el.id, { seat_spacing: n })}
                            />
                        </Field>
                        {el.kind === "seat_row_curved" && (
                            <Field label="Curvatura">
                                <div className="flex items-center gap-2.5">
                                    <input
                                        type="range"
                                        min={CURVATURE_MIN}
                                        max={CURVATURE_MAX}
                                        step={0.1}
                                        value={curvature}
                                        disabled={readOnly}
                                        onChange={(e) => onUpdate(el.id, {
                                            curvature: clampCurvature(Number(e.target.value)),
                                            ...curvatureToArcFields(Number(e.target.value)),
                                        })}
                                        className="curvature-slider flex-1"
                                        data-testid="prop-curvature"
                                    />
                                    <Input
                                        type="number"
                                        min={CURVATURE_MIN}
                                        max={CURVATURE_MAX}
                                        step={0.1}
                                        value={curvature}
                                        disabled={readOnly}
                                        className="h-8 w-16 text-center"
                                        onChange={(e) => onUpdate(el.id, {
                                            curvature: clampCurvature(Number(e.target.value)),
                                            ...curvatureToArcFields(Number(e.target.value)),
                                        })}
                                    />
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                    Positivo: curva hacia arriba · Negativo: hacia abajo · 0: recta
                                </p>
                            </Field>
                        )}
                        <Field label="Incremento de numeración">
                            <ClampedNumberInput
                                value={el.numbering_step || 1}
                                min={1}
                                max={100}
                                disabled={readOnly}
                                testid="prop-numbering-step"
                                onCommit={(n) => onUpdate(el.id, { numbering_step: n })}
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Define el salto en la numeración (1 = 1,2,3... · 2 = 1,3,5... · 3 = 1,4,7...)
                            </p>
                        </Field>
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
                        {!readOnly && onExplodeRows && (
                            <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    La fila se selecciona completa. Para editar o borrar solo algunos
                                    asientos, convertíla en individuales.
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => onExplodeRows([el.id])}
                                    data-testid="prop-explode-row"
                                >
                                    <Ungroup className="h-3.5 w-3.5 mr-1.5" />
                                    Convertir en asientos individuales
                                </Button>
                            </div>
                        )}
                    </>
                )}

                {el.kind === "table_round" && (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            <Field label="Sillas (2-12)">
                                <ClampedNumberInput
                                    value={el.chairs_count || 6}
                                    min={2}
                                    max={12}
                                    disabled={readOnly}
                                    testid="prop-chairs-count"
                                    onCommit={(n) => onUpdate(el.id, { chairs_count: n })}
                                />
                            </Field>
                            <Field label="Radio mesa">
                                <ClampedNumberInput
                                    value={el.table_radius || 40}
                                    min={20}
                                    max={MAX_TABLE_RADIUS}
                                    disabled={readOnly}
                                    onCommit={(n) => onUpdate(el.id, { table_radius: n })}
                                />
                            </Field>
                        </div>
                        <Field label="Distancia silla → mesa">
                            <ClampedNumberInput
                                value={el.chair_distance || 22}
                                min={6}
                                max={MAX_CHAIR_DISTANCE}
                                disabled={readOnly}
                                onCommit={(n) => onUpdate(el.id, { chair_distance: n })}
                            />
                        </Field>
                    </>
                )}

                {el.kind === "table_rect" && (
                    <div className="grid grid-cols-2 gap-2">
                        <Field label="Sillas arriba">
                            <ClampedNumberInput
                                value={el.chairs_per_side?.top || 0}
                                min={0}
                                max={12}
                                disabled={readOnly}
                                onCommit={(n) => onUpdate(el.id, {
                                    chairs_per_side: { ...el.chairs_per_side, top: n },
                                })}
                            />
                        </Field>
                        <Field label="Sillas abajo">
                            <ClampedNumberInput
                                value={el.chairs_per_side?.bottom || 0}
                                min={0}
                                max={12}
                                disabled={readOnly}
                                onCommit={(n) => onUpdate(el.id, {
                                    chairs_per_side: { ...el.chairs_per_side, bottom: n },
                                })}
                            />
                        </Field>
                        <Field label="Sillas izquierda">
                            <ClampedNumberInput
                                value={el.chairs_per_side?.left || 0}
                                min={0}
                                max={8}
                                disabled={readOnly}
                                onCommit={(n) => onUpdate(el.id, {
                                    chairs_per_side: { ...el.chairs_per_side, left: n },
                                })}
                            />
                        </Field>
                        <Field label="Sillas derecha">
                            <ClampedNumberInput
                                value={el.chairs_per_side?.right || 0}
                                min={0}
                                max={8}
                                disabled={readOnly}
                                onCommit={(n) => onUpdate(el.id, {
                                    chairs_per_side: { ...el.chairs_per_side, right: n },
                                })}
                            />
                        </Field>
                    </div>
                )}

                {el.kind === "seat_individual" && (
                    <Field label="Radio">
                        <ClampedNumberInput
                            value={el.seat_radius || 12}
                            min={6}
                            max={24}
                            disabled={readOnly}
                            onCommit={(n) => onUpdate(el.id, { seat_radius: n })}
                        />
                    </Field>
                )}

                {FULL_PURCHASE_KINDS.includes(el.kind) && (
                    <div className="flex items-center justify-between rounded-md border p-2">
                        <div>
                            <div className="text-xs font-medium">
                                {el.kind.startsWith("table") ? "Comprar mesa completa" : "Comprar fila completa"}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                El comprador debe llevarse todos los asientos disponibles.
                            </p>
                        </div>
                        <Switch
                            checked={!!el.require_full_purchase}
                            disabled={readOnly}
                            data-testid="prop-require-full-purchase"
                            onCheckedChange={(v) => onUpdate(el.id, { require_full_purchase: v })}
                        />
                    </div>
                )}

                {el.kind !== "stage" && localities.length > 0 && (
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
            </div>
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
