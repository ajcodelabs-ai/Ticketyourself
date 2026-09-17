/**
 * Element rendering on the venue canvas (react-konva).
 * Phase 6b — added 4 new kinds: seat_row_curved, seat_individual,
 * table_round, table_rect.
 *
 * Each shape returns a Konva.Group attached to a ref so the Transformer
 * can manipulate it.
 */
import { forwardRef, memo } from "react";
import { Group, Rect, Text, Circle } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";

/** Mirrors backend/services/seats.py::_row_seat_label numbering. */
function rowSeatNumber(element, i, seats) {
    const start = element.numbering_start || 1;
    const step = element.numbering_step || 1;
    const effectiveIndex = element.numbering_direction === "rtl" ? seats - 1 - i : i;
    return start + effectiveIndex * step;
}

/** Hover-tooltip text for a row seat — mirrors backend/services/seats.py's label. */
function rowSeatLabel(element, i, seats) {
    return `${element.row_label || element.label || "?"}-${rowSeatNumber(element, i, seats)}`;
}

interface VenueElement {
    id: string;
    kind: string;
    x: number;
    y: number;
    rotation?: number;
    label?: string;
    width?: number;
    height?: number;
    color?: string;
    capacity?: number;
    seats_count?: number;
    seat_spacing?: number;
    seat_radius?: number;
    row_label?: string;
    numbering_direction?: string;
    numbering_start?: number;
    curve_radius?: number;
    curve_arc_degrees?: number;
    table_radius?: number;
    chair_radius?: number;
    chair_distance?: number;
    chairs_count?: number;
    chairs_per_side?: { top?: number; right?: number; bottom?: number; left?: number };
    [key: string]: unknown;
}

interface VenueLocality {
    color?: string;
    [key: string]: unknown;
}

export interface ShapeProps {
    element: VenueElement;
    locality?: VenueLocality | null;
    selected?: boolean;
    draggable?: boolean;
    zoom?: number;
    onClick?: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void;
    onContextMenu?: (e: KonvaEventObject<PointerEvent>) => void;
    onDragStart?: (e: KonvaEventObject<DragEvent>) => void;
    onDragMove?: (e: KonvaEventObject<DragEvent>) => void;
    onDragEnd?: (x: number, y: number) => void;
    /** Hover a single seat/chair — reports its computed label + the raw
     * mouse event (so the caller can position an HTML tooltip). `null` on
     * mouse-leave. Mirrors the reference app's per-seat hover tooltip. */
    onSeatHover?: (label: string | null, e?: KonvaEventObject<MouseEvent>) => void;
}

// ── stage ────────────────────────────────────────────────────────────────
const StageShape = forwardRef<Konva.Group, ShapeProps>(function StageShape(
    { element, selected, onClick, onContextMenu, onDragStart, onDragEnd, onDragMove, draggable }, ref,
) {
    const w = element.width || 200;
    const h = element.height || 80;
    return (
        <Group
            ref={ref}
            id={element.id}
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd?.(e.target.x(), e.target.y())}
        >
            <Rect
                width={w}
                height={h}
                fill={element.color || "#9CA3AF"}
                cornerRadius={4}
                stroke={selected ? "#6366F1" : "transparent"}
                strokeWidth={selected ? 2 : 0}
            />
            <Text x={0} y={h / 2 - 8} width={w} align="center" fontStyle="bold"
                  fontSize={14} fill="#fff" text={element.label || "Escenario"} />
        </Group>
    );
});

// ── unnumbered zone ──────────────────────────────────────────────────────
const ZoneShape = forwardRef<Konva.Group, ShapeProps>(function ZoneShape(
    { element, locality, selected, onClick, onContextMenu, onDragStart, onDragEnd, onDragMove, draggable }, ref,
) {
    const w = element.width || 200;
    const h = element.height || 100;
    const color = locality?.color || "#94A3B8";
    return (
        <Group
            ref={ref}
            id={element.id}
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd?.(e.target.x(), e.target.y())}
        >
            <Rect
                width={w}
                height={h}
                fill={color}
                opacity={0.32}
                cornerRadius={6}
                stroke={selected ? "#6366F1" : color}
                strokeWidth={selected ? 2 : 2}
                dash={[4, 4]}
            />
            <Text x={0} y={h / 2 - 16} width={w} align="center" fontStyle="bold"
                  fontSize={13} fill="#1F2937" text={element.label || "Zona"} />
            <Text x={0} y={h / 2 + 2} width={w} align="center" fontSize={11}
                  fill="#475569" text={`Cap: ${element.capacity || 0}`} />
        </Group>
    );
});

// Helper to render seat labels conditional on zoom
function showSeatLabel(zoom: number, spacing: number) {
    return zoom * spacing >= 22;
}

// ── seat row straight ────────────────────────────────────────────────────
const RowShape = forwardRef<Konva.Group, ShapeProps>(function RowShape(
    { element, locality, selected, onClick, onContextMenu, onDragStart, onDragEnd, onDragMove, draggable, zoom = 1, onSeatHover }, ref,
) {
    const seats = element.seats_count || 0;
    const spacing = element.seat_spacing || 24;
    const radius = element.seat_radius || 10;
    const w = (seats - 1) * spacing + radius * 2;
    const h = radius * 2;
    const color = locality?.color || "#94A3B8";
    const showLabels = showSeatLabel(zoom, spacing) && seats <= 60;

    return (
        <Group
            ref={ref}
            id={element.id}
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd?.(e.target.x(), e.target.y())}
        >
            {selected && (
                <Rect x={-6} y={-6} width={w + 12} height={h + 12}
                      stroke="#6366F1" strokeWidth={2} dash={[6, 4]} cornerRadius={6} />
            )}
            {element.row_label && (
                <>
                    <Text x={-28} y={radius - 7} text={element.row_label}
                          fontStyle="bold" fontSize={13} fill="#374151" />
                    <Text x={w + 8} y={radius - 7} text={element.row_label}
                          fontStyle="bold" fontSize={13} fill="#374151" />
                </>
            )}
            {Array.from({ length: seats }).map((_, i) => {
                const num = rowSeatNumber(element, i, seats);
                return (
                    <Group
                        key={i}
                        x={i * spacing}
                        y={0}
                        onMouseEnter={(e) => onSeatHover?.(rowSeatLabel(element, i, seats), e)}
                        onMouseLeave={() => onSeatHover?.(null)}
                    >
                        <Circle x={radius} y={radius} radius={radius}
                                fill={color} stroke="#fff" strokeWidth={1} />
                        {showLabels && (
                            <Text x={0} y={radius - 5} width={radius * 2}
                                  align="center" fontSize={9} fill="#fff" text={String(num)} />
                        )}
                    </Group>
                );
            })}
        </Group>
    );
});

// ── seat row curved ──────────────────────────────────────────────────────
// Matches the reference app's model exactly (venue-designer.component.ts
// `_applyCurvatureToRow`): seats sit on the SAME straight baseline as a
// straight row (baseX = i*spacing), with a parabolic Y offset that's 0 at
// the center seat and grows toward the edges — `curvature * 30 *
// normalizedDistance²`. Bounded (±curvature*30 at most, at the row's own
// edges) and simple, unlike a circular arc whose depth depends on a
// separate radius+angle and can balloon far past the anchor.
function curvedRowYOffset(curvature: number, i: number, seats: number) {
    if (!curvature || seats <= 1) return 0;
    const centerIndex = (seats - 1) / 2;
    const normalized = (i - centerIndex) / (seats / 2);
    return curvature * 30 * normalized * normalized;
}

const CurvedRowShape = forwardRef<Konva.Group, ShapeProps>(function CurvedRowShape(
    { element, locality, selected, onClick, onContextMenu, onDragStart, onDragEnd, onDragMove, draggable, zoom = 1, onSeatHover }, ref,
) {
    const seats = element.seats_count || 0;
    const radius = element.seat_radius || 10;
    const spacing = element.seat_spacing || 24;
    const curvature = Number(element.curvature) || 0;
    const color = locality?.color || "#94A3B8";
    const showLabels = showSeatLabel(zoom, spacing) && seats <= 60;

    const w = (seats - 1) * spacing + radius * 2;
    const firstY = curvedRowYOffset(curvature, 0, seats);
    const maxAbsY = Math.max(...Array.from({ length: seats }, (_, i) => Math.abs(curvedRowYOffset(curvature, i, seats))), 0);
    const minY = Math.min(0, curvature < 0 ? 0 : -maxAbsY);
    const boxTop = curvature < 0 ? -radius - 6 : minY - radius - 6;
    const boxHeight = maxAbsY + radius * 2 + 12;

    return (
        <Group
            ref={ref}
            id={element.id}
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd?.(e.target.x(), e.target.y())}
        >
            {selected && (
                <Rect x={-6} y={boxTop} width={w + 12} height={boxHeight}
                      stroke="#6366F1" strokeWidth={2} dash={[6, 4]} cornerRadius={6} />
            )}
            {element.row_label && (
                <>
                    <Text x={-28} y={firstY + radius - 7} text={element.row_label}
                          fontStyle="bold" fontSize={13} fill="#374151" />
                    {/* Symmetric parabola: the last seat sits at the same Y
                        offset as the first, so the right label reuses firstY. */}
                    <Text x={w + 8} y={firstY + radius - 7} text={element.row_label}
                          fontStyle="bold" fontSize={13} fill="#374151" />
                </>
            )}
            {Array.from({ length: seats }).map((_, i) => {
                const y = curvedRowYOffset(curvature, i, seats);
                const num = rowSeatNumber(element, i, seats);
                return (
                    <Group
                        key={i}
                        x={i * spacing}
                        y={y}
                        onMouseEnter={(e) => onSeatHover?.(rowSeatLabel(element, i, seats), e)}
                        onMouseLeave={() => onSeatHover?.(null)}
                    >
                        <Circle x={radius} y={radius} radius={radius}
                                fill={color} stroke="#fff" strokeWidth={1} />
                        {showLabels && (
                            <Text x={0} y={radius - 5} width={radius * 2}
                                  align="center" fontSize={9} fill="#fff" text={String(num)} />
                        )}
                    </Group>
                );
            })}
        </Group>
    );
});

// ── individual seat ──────────────────────────────────────────────────────
const SeatShape = forwardRef<Konva.Group, ShapeProps>(function SeatShape(
    { element, locality, selected, onClick, onContextMenu, onDragStart, onDragEnd, onDragMove, draggable, zoom = 1 }, ref,
) {
    const r = element.seat_radius || 12;
    const color = locality?.color || "#94A3B8";
    return (
        <Group
            ref={ref}
            id={element.id}
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd?.(e.target.x(), e.target.y())}
        >
            {selected && (
                <Circle radius={r + 6} stroke="#6366F1" strokeWidth={2} dash={[4, 4]} />
            )}
            <Circle radius={r} fill={color} stroke="#fff" strokeWidth={1.5} />
            {zoom >= 0.8 && (
                <Text x={-r} y={-5} width={r * 2} align="center"
                      fontSize={9} fill="#fff" text={element.label || ""} />
            )}
        </Group>
    );
});

// ── round table ──────────────────────────────────────────────────────────
const TableRoundShape = forwardRef<Konva.Group, ShapeProps>(function TableRoundShape(
    { element, locality, selected, onClick, onContextMenu, onDragStart, onDragEnd, onDragMove, draggable, zoom = 1, onSeatHover }, ref,
) {
    const tr = element.table_radius || 40;
    const cr = element.chair_radius || 10;
    const cd = element.chair_distance || 20;
    const n = element.chairs_count || 6;
    const ring = tr + cd + cr;
    const color = locality?.color || "#94A3B8";

    return (
        <Group
            ref={ref}
            id={element.id}
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd?.(e.target.x(), e.target.y())}
        >
            {selected && (
                <Circle radius={ring + 4} stroke="#6366F1" strokeWidth={2} dash={[6, 4]} />
            )}
            <Circle radius={tr} fill="#E2E8F0" stroke="#94A3B8" strokeWidth={1.5} />
            <Text x={-tr} y={-6} width={tr * 2} align="center"
                  fontSize={11} fontStyle="bold" fill="#475569"
                  text={element.label || ""} />
            {Array.from({ length: n }).map((_, i) => {
                const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
                const sx = (tr + cd) * Math.cos(a);
                const sy = (tr + cd) * Math.sin(a);
                return (
                    <Circle key={i} x={sx} y={sy} radius={cr}
                            fill={color} stroke="#fff" strokeWidth={1}
                            onMouseEnter={(e) => onSeatHover?.(`${element.label || "Mesa"}-${i + 1}`, e)}
                            onMouseLeave={() => onSeatHover?.(null)} />
                );
            })}
        </Group>
    );
});

// ── rect table ───────────────────────────────────────────────────────────
const TableRectShape = forwardRef<Konva.Group, ShapeProps>(function TableRectShape(
    { element, locality, selected, onClick, onContextMenu, onDragStart, onDragEnd, onDragMove, draggable, zoom = 1, onSeatHover }, ref,
) {
    const w = element.width || 200;
    const h = element.height || 100;
    const cr = element.chair_radius || 10;
    const cd = element.chair_distance || 18;
    const cps = element.chairs_per_side || { top: 0, right: 0, bottom: 0, left: 0 };
    const color = locality?.color || "#94A3B8";

    const sideChairs = (count: number, axis: "x" | "y", fixed: number) => {
        // axis: "x" → top/bottom (varies in x, y fixed); "y" → left/right
        const out = [];
        for (let i = 0; i < count; i += 1) {
            const t = count === 1 ? 0.5 : i / (count - 1);
            if (axis === "x") {
                const x = t * w;
                out.push({ x, y: fixed });
            } else {
                const y = t * h;
                out.push({ x: fixed, y });
            }
        }
        return out;
    };

    const topChairs = sideChairs(cps.top || 0, "x", -cd - cr);
    const bottomChairs = sideChairs(cps.bottom || 0, "x", h + cd + cr);
    const leftChairs = sideChairs(cps.left || 0, "y", -cd - cr);
    const rightChairs = sideChairs(cps.right || 0, "y", w + cd + cr);
    // Order must match backend/services/seats.py::expand_venue_seats — it
    // walks top→right→bottom→left when assigning each chair's seat_id/label,
    // so the tooltip/label shown here has to line up with the same index.
    const allChairs = [...topChairs, ...rightChairs, ...bottomChairs, ...leftChairs];

    return (
        <Group
            ref={ref}
            id={element.id}
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd?.(e.target.x(), e.target.y())}
        >
            {selected && (
                <Rect x={-cd - cr - 4} y={-cd - cr - 4}
                      width={w + (cd + cr + 4) * 2}
                      height={h + (cd + cr + 4) * 2}
                      stroke="#6366F1" strokeWidth={2} dash={[6, 4]} cornerRadius={4} />
            )}
            <Rect width={w} height={h} fill="#E2E8F0"
                  stroke="#94A3B8" strokeWidth={1.5} cornerRadius={4} />
            <Text x={0} y={h / 2 - 6} width={w} align="center"
                  fontSize={11} fontStyle="bold" fill="#475569"
                  text={element.label || ""} />
            {allChairs.map((c, i) => (
                <Circle key={i} x={c.x} y={c.y} radius={cr}
                        fill={color} stroke="#fff" strokeWidth={1}
                        onMouseEnter={(e) => onSeatHover?.(`${element.label || "Mesa"}-${i + 1}`, e)}
                        onMouseLeave={() => onSeatHover?.(null)} />
            ))}
        </Group>
    );
});

// ── dispatcher ───────────────────────────────────────────────────────────
const ElementShape = forwardRef<Konva.Group, ShapeProps>(function ElementShape(props, ref) {
    const { element } = props;
    if (element.kind === "stage") return <StageShape {...props} ref={ref} />;
    if (element.kind === "unnumbered_zone") return <ZoneShape {...props} ref={ref} />;
    if (element.kind === "seat_row_straight") return <RowShape {...props} ref={ref} />;
    if (element.kind === "seat_row_curved") return <CurvedRowShape {...props} ref={ref} />;
    if (element.kind === "seat_individual") return <SeatShape {...props} ref={ref} />;
    if (element.kind === "table_round") return <TableRoundShape {...props} ref={ref} />;
    if (element.kind === "table_rect") return <TableRectShape {...props} ref={ref} />;
    return null;
});

// Memoized so panning/dragging (which update EditorCanvas-local state on
// every pointer-move) don't force React to reconcile every element on the
// canvas each frame — only the ones whose own props actually changed. With
// hundreds of seats, un-memoized reconciliation was the dominant cost of
// drag/pan interactions (confirmed via profiling). Zoom still reconciles
// every element by design: seat-label visibility depends on `zoom`.
export default memo(ElementShape);
