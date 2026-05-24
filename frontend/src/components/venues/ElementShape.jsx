/**
 * Element rendering on the venue canvas (react-konva).
 * Phase 6b — added 4 new kinds: seat_row_curved, seat_individual,
 * table_round, table_rect.
 *
 * Each shape returns a Konva.Group attached to a ref so the Transformer
 * can manipulate it.
 */
import { forwardRef } from "react";
import { Group, Rect, Text, Circle, Arc } from "react-konva";

function snapVal(v, GRID = 20) {
    return Math.round(v / GRID) * GRID;
}

// ── stage ────────────────────────────────────────────────────────────────
const StageShape = forwardRef(function StageShape(
    { element, selected, onClick, onContextMenu, onDragEnd, onDragMove, draggable }, ref,
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
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
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
const ZoneShape = forwardRef(function ZoneShape(
    { element, locality, selected, onClick, onContextMenu, onDragEnd, onDragMove, draggable }, ref,
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
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
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
function showSeatLabel(zoom, spacing) {
    return zoom * spacing >= 22;
}

// ── seat row straight ────────────────────────────────────────────────────
const RowShape = forwardRef(function RowShape(
    { element, locality, selected, onClick, onContextMenu, onDragEnd, onDragMove, draggable, zoom = 1 }, ref,
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
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
        >
            {selected && (
                <Rect x={-6} y={-6} width={w + 12} height={h + 12}
                      stroke="#6366F1" strokeWidth={2} dash={[6, 4]} cornerRadius={6} />
            )}
            {element.row_label && (
                <Text x={-28} y={radius - 7} text={element.row_label}
                      fontStyle="bold" fontSize={13} fill="#374151" />
            )}
            {Array.from({ length: seats }).map((_, i) => {
                const num = element.numbering_direction === "rtl"
                    ? seats - i + (element.numbering_start || 1) - 1
                    : (element.numbering_start || 1) + i;
                return (
                    <Group key={i} x={i * spacing} y={0}>
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
const CurvedRowShape = forwardRef(function CurvedRowShape(
    { element, locality, selected, onClick, onContextMenu, onDragEnd, onDragMove, draggable, zoom = 1 }, ref,
) {
    const seats = element.seats_count || 0;
    const radius = element.seat_radius || 10;
    const cr = element.curve_radius || 240;
    const arcDeg = element.curve_arc_degrees || 60;
    const color = locality?.color || "#94A3B8";
    const spacing = element.seat_spacing || 24;
    const showLabels = showSeatLabel(zoom, spacing) && seats <= 60;

    // Distribute seats along an arc whose CENTER is above the anchor.
    // The bottom of the circle touches the anchor (x, y), so seats sit
    // just above the anchor when the arc is small. We sweep from LEFT to
    // RIGHT so LTR numbering reads naturally in screen space.
    const arcRad = (arcDeg * Math.PI) / 180;
    const startAngle = Math.PI / 2 + arcRad / 2; // bottom-LEFT of arc
    const stepAngle = seats > 1 ? -arcRad / (seats - 1) : 0; // sweep clockwise (toward right)
    const cy = -cr; // center above the anchor
    const cx = 0;

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
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
        >
            {selected && (
                <Arc
                    x={cx} y={cy}
                    innerRadius={cr - radius - 4}
                    outerRadius={cr + radius + 4}
                    angle={arcDeg}
                    rotation={-90 - arcDeg / 2}
                    fill="rgba(99,102,241,0.08)"
                    stroke="#6366F1"
                    strokeWidth={1.5}
                    dash={[4, 4]}
                />
            )}
            {element.row_label && (
                <Text x={-30} y={-12} text={element.row_label}
                      fontStyle="bold" fontSize={13} fill="#374151" />
            )}
            {Array.from({ length: seats }).map((_, i) => {
                const a = startAngle + i * stepAngle;
                const sx = cx + cr * Math.cos(a);
                const sy = cy + cr * Math.sin(a);
                const num = element.numbering_direction === "rtl"
                    ? seats - i + (element.numbering_start || 1) - 1
                    : (element.numbering_start || 1) + i;
                return (
                    <Group key={i}>
                        <Circle x={sx} y={sy} radius={radius}
                                fill={color} stroke="#fff" strokeWidth={1} />
                        {showLabels && (
                            <Text x={sx - radius} y={sy - 5} width={radius * 2}
                                  align="center" fontSize={9} fill="#fff" text={String(num)} />
                        )}
                    </Group>
                );
            })}
        </Group>
    );
});

// ── individual seat ──────────────────────────────────────────────────────
const SeatShape = forwardRef(function SeatShape(
    { element, locality, selected, onClick, onContextMenu, onDragEnd, onDragMove, draggable, zoom = 1 }, ref,
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
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
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
const TableRoundShape = forwardRef(function TableRoundShape(
    { element, locality, selected, onClick, onContextMenu, onDragEnd, onDragMove, draggable, zoom = 1 }, ref,
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
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
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
                            fill={color} stroke="#fff" strokeWidth={1} />
                );
            })}
        </Group>
    );
});

// ── rect table ───────────────────────────────────────────────────────────
const TableRectShape = forwardRef(function TableRectShape(
    { element, locality, selected, onClick, onContextMenu, onDragEnd, onDragMove, draggable, zoom = 1 }, ref,
) {
    const w = element.width || 200;
    const h = element.height || 100;
    const cr = element.chair_radius || 10;
    const cd = element.chair_distance || 18;
    const cps = element.chairs_per_side || { top: 0, right: 0, bottom: 0, left: 0 };
    const color = locality?.color || "#94A3B8";

    const sideChairs = (count, axis, fixed) => {
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
    const allChairs = [...topChairs, ...bottomChairs, ...leftChairs, ...rightChairs];

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
            onDragMove={onDragMove}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
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
                        fill={color} stroke="#fff" strokeWidth={1} />
            ))}
        </Group>
    );
});

// ── dispatcher ───────────────────────────────────────────────────────────
const ElementShape = forwardRef(function ElementShape(props, ref) {
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

export default ElementShape;
