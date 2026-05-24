/**
 * Read-only interactive canvas used by the public seat-picker (Phase 7).
 *
 * Renders stages + zones for context, then overlays the live `seats_status`
 * as individually clickable circles.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Rect, Group, Circle, Text } from "react-konva";
import { seatWorldPos, seatRadius, SEAT_STATUS_COLORS } from "@/lib/seats";

export default function SeatPickerCanvas({
    venue,
    seatsStatus,
    localitiesById,
    selectedIds,
    onToggleSeat,
    height = 520,
}) {
    const containerRef = useRef(null);
    const stageRef = useRef(null);
    const [containerSize, setContainerSize] = useState({ width: 800, height });
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [draggingPan, setDraggingPan] = useState(null);

    useEffect(() => {
        const update = () => {
            if (containerRef.current) {
                setContainerSize({ width: containerRef.current.offsetWidth, height });
            }
        };
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, [height]);

    // Auto-fit: scale to fit canvas width on first load
    useEffect(() => {
        if (!venue?.canvas || !containerRef.current) return;
        const containerW = containerRef.current.offsetWidth;
        const scale = Math.min(1, (containerW - 40) / venue.canvas.width);
        setZoom(scale);
        setPan({
            x: (containerW - venue.canvas.width * scale) / 2,
            y: 20,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [venue?.id]);

    const handleWheel = useCallback((e) => {
        e.evt.preventDefault();
        const stage = stageRef.current;
        if (!stage) return;
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };
        const dir = e.evt.deltaY > 0 ? -1 : 1;
        const scaleBy = 1.08;
        const newScale = dir > 0 ? oldScale * scaleBy : oldScale / scaleBy;
        const clamped = Math.max(0.25, Math.min(3, newScale));
        setZoom(clamped);
        setPan({
            x: pointer.x - mousePointTo.x * clamped,
            y: pointer.y - mousePointTo.y * clamped,
        });
    }, []);

    // Drag-to-pan (when clicking empty area)
    const handleMouseDown = (e) => {
        const clickedEmpty = e.target === e.target.getStage()
            || e.target.attrs.id === "bg-rect";
        if (!clickedEmpty) return;
        const stage = stageRef.current;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        setDraggingPan({ startX: pointer.x, startY: pointer.y, originPan: { ...pan } });
    };
    const handleMouseMove = () => {
        if (!draggingPan) return;
        const stage = stageRef.current;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        setPan({
            x: draggingPan.originPan.x + (pointer.x - draggingPan.startX),
            y: draggingPan.originPan.y + (pointer.y - draggingPan.startY),
        });
    };
    const handleMouseUp = () => setDraggingPan(null);

    if (!venue) return null;
    const canvas = venue.canvas || { width: 1200, height: 800, background_color: "#FAFAFA" };

    // Build a lookup map element_id → element to read positions
    const elementsById = Object.fromEntries((venue.elements || []).map((e) => [e.id, e]));

    return (
        <div
            ref={containerRef}
            className="w-full bg-slate-50 rounded-lg border relative overflow-hidden"
            data-testid="seat-picker"
        >
            <Stage
                ref={stageRef}
                width={containerSize.width}
                height={containerSize.height}
                scaleX={zoom}
                scaleY={zoom}
                x={pan.x}
                y={pan.y}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ cursor: draggingPan ? "grabbing" : "default" }}
            >
                <Layer listening={true}>
                    <Rect
                        id="bg-rect" x={0} y={0}
                        width={canvas.width} height={canvas.height}
                        fill={canvas.background_color || "#FAFAFA"}
                        stroke="#CBD5E1" strokeWidth={1}
                    />
                </Layer>

                {/* Context elements (stages, zones, table bodies) — non-interactive */}
                <Layer listening={false}>
                    {(venue.elements || []).map((el) => {
                        if (el.kind === "stage") {
                            const w = el.width || 200;
                            const h = el.height || 80;
                            return (
                                <Group key={el.id} x={el.x} y={el.y} rotation={el.rotation || 0}>
                                    <Rect width={w} height={h} fill={el.color || "#9CA3AF"} cornerRadius={4} />
                                    <Text x={0} y={h / 2 - 8} width={w} align="center"
                                          fontStyle="bold" fontSize={14} fill="#fff"
                                          text={el.label || "Escenario"} />
                                </Group>
                            );
                        }
                        if (el.kind === "unnumbered_zone") {
                            const w = el.width || 200;
                            const h = el.height || 100;
                            const color = localitiesById[el.locality_id]?.color || "#94A3B8";
                            return (
                                <Group key={el.id} x={el.x} y={el.y} rotation={el.rotation || 0}>
                                    <Rect width={w} height={h} fill={color} opacity={0.32}
                                          cornerRadius={6} stroke={color} strokeWidth={2} dash={[4, 4]} />
                                    <Text x={0} y={h / 2 - 8} width={w} align="center"
                                          fontStyle="bold" fontSize={13} fill="#1F2937"
                                          text={el.label || "Zona"} />
                                </Group>
                            );
                        }
                        if (el.kind === "table_round") {
                            const tr = el.table_radius || 40;
                            return (
                                <Group key={el.id} x={el.x} y={el.y} rotation={el.rotation || 0}>
                                    <Circle radius={tr} fill="#E2E8F0" stroke="#94A3B8" strokeWidth={1.5} />
                                    <Text x={-tr} y={-6} width={tr * 2} align="center"
                                          fontSize={11} fontStyle="bold" fill="#475569"
                                          text={el.label || ""} />
                                </Group>
                            );
                        }
                        if (el.kind === "table_rect") {
                            const w = el.width || 200;
                            const h = el.height || 100;
                            return (
                                <Group key={el.id} x={el.x} y={el.y} rotation={el.rotation || 0}>
                                    <Rect width={w} height={h} fill="#E2E8F0"
                                          stroke="#94A3B8" strokeWidth={1.5} cornerRadius={4} />
                                    <Text x={0} y={h / 2 - 6} width={w} align="center"
                                          fontSize={11} fontStyle="bold" fill="#475569"
                                          text={el.label || ""} />
                                </Group>
                            );
                        }
                        // seat_row_*: render the row label only (seats come from seats_status layer)
                        if (el.kind === "seat_row_straight" || el.kind === "seat_row_curved") {
                            if (!el.row_label) return null;
                            return (
                                <Text key={el.id} x={el.x - 30} y={el.y - 6}
                                      text={el.row_label} fontStyle="bold" fontSize={13} fill="#374151"
                                      rotation={el.rotation || 0} />
                            );
                        }
                        return null;
                    })}
                </Layer>

                {/* Clickable seats layer */}
                <Layer>
                    {seatsStatus.map((seat) => {
                        const el = elementsById[seat.element_id];
                        if (!el) return null;
                        const pos = seatWorldPos(el, seat.sub_index);
                        const r = seatRadius(el);
                        const localityColor = localitiesById[seat.locality_id]?.color || "#94A3B8";
                        const isSelected = selectedIds.includes(seat.seat_id);
                        let fill = localityColor;
                        let opacity = 1;
                        if (seat.status === "sold") {
                            fill = SEAT_STATUS_COLORS.sold;
                        } else if (seat.status === "held") {
                            fill = SEAT_STATUS_COLORS.held;
                        }
                        if (isSelected) {
                            fill = SEAT_STATUS_COLORS.selected;
                        }
                        const clickable = seat.status === "available";
                        return (
                            <Group key={seat.seat_id}>
                                {isSelected && (
                                    <Circle x={pos.x} y={pos.y} radius={r + 4}
                                            stroke="#0EA5E9" strokeWidth={2} />
                                )}
                                <Circle
                                    x={pos.x} y={pos.y} radius={r}
                                    fill={fill} opacity={opacity}
                                    stroke="#fff" strokeWidth={1}
                                    onClick={() => clickable && onToggleSeat(seat)}
                                    onTap={() => clickable && onToggleSeat(seat)}
                                    onMouseEnter={(e) => {
                                        if (clickable) {
                                            e.target.getStage().container().style.cursor = "pointer";
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.getStage().container().style.cursor = "default";
                                    }}
                                />
                                {zoom >= 0.8 && r >= 8 && (
                                    <Text x={pos.x - r} y={pos.y - 5} width={r * 2}
                                          align="center" fontSize={9} fill="#fff"
                                          text={seat.label.split("-").pop()}
                                          listening={false} />
                                )}
                            </Group>
                        );
                    })}
                </Layer>
            </Stage>

            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs bg-white rounded-md border px-2 py-1 shadow-sm">
                <button onClick={() => setZoom((z) => Math.max(0.25, z / 1.15))}
                        className="px-2 hover:bg-slate-100 rounded">−</button>
                <span className="font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((z) => Math.min(3, z * 1.15))}
                        className="px-2 hover:bg-slate-100 rounded">+</button>
            </div>
            <div className="absolute top-2 left-2 text-xs text-muted-foreground bg-white/80 rounded px-2 py-1">
                Click = elegir asiento · Drag = mover el mapa · Wheel = zoom
            </div>
        </div>
    );
}
