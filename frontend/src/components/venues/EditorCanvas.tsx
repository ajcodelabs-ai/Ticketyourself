/**
 * Canvas — react-konva Stage with elements, Transformer, marquee select,
 * group drag, alignment guides, zoom/pan.
 *
 * Phase 6b changes vs 6a:
 *  - Konva Transformer attached to selected elements (resize + rotate).
 *  - Marquee selection (click + drag on empty area).
 *  - Group drag (moving one selected moves all selected by the same delta).
 *  - Alignment guides during drag (snap to neighboring centers/edges).
 *  - Right-click → onContextMenu callback (with element id + screen pos).
 *  - Grid lines moved to its own Layer for performance (listening=false).
 *  - Pan: Space+drag (hand cursor) or middle-mouse drag. Empty drag does not pan
 *    so clicks can select / assign localities.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Rect, Line, Group, Transformer } from "react-konva";
import type Konva from "konva";
import { Maximize2 } from "lucide-react";
import ElementShape from "./ElementShape";
import { GRID, elementBBox, bboxIntersects } from "@/lib/venues";

const ALIGN_TOLERANCE = 5; // px in world space — must be reachable visually

interface DragSnapInfo {
    startX: number;
    startY: number;
}

interface DragSnapshot {
    anchorId: string;
    anchorStartX: number;
    anchorStartY: number;
    snap: Record<string, DragSnapInfo>;
}

interface MarqueeState {
    x: number;
    y: number;
    w: number;
    h: number;
    additive: boolean;
}

interface GuideLine {
    type: "v" | "h";
    pos: number;
}

interface SelectOptions {
    additive?: boolean;
    replace?: boolean;
}

interface ContextMenuPayload {
    elementId: string;
    screenX: number;
    screenY: number;
}

interface VenueCanvasElement {
    id: string;
    kind: string;
    x: number;
    y: number;
    locality_id?: string | null;
    width?: number;
    height?: number;
    table_radius?: number;
    seats_count?: number;
    seat_spacing?: number;
    seat_radius?: number;
    curve_radius?: number;
    rotation?: number;
    [key: string]: unknown;
}

interface EditorCanvasProps {
    canvas: { width: number; height: number; background_color?: string };
    elements: VenueCanvasElement[];
    localitiesById: Record<string, Record<string, unknown>>;
    selection: string[];
    onSelect: (ids: string[], options?: SelectOptions) => void;
    onUpdate: (id: string, patch: Record<string, unknown>) => void;
    onBatchUpdate?: (patches: Record<string, Record<string, unknown>>) => void;
    onTransform?: (id: string, patch: Record<string, unknown>) => void;
    onContextMenu?: (payload: ContextMenuPayload) => void;
    tool?: string;
    onCanvasClick?: (tool: string, world: { x: number; y: number }) => void;
    readOnly?: boolean;
    height?: number;
    /** When this value changes (venue/event id), auto fit-to-view once after layout loads. */
    autoFitKey?: string;
}

function snapVal(v) {
    return Math.round(v / GRID) * GRID;
}

/**
 * Aggregate the bounding box of a list of elements. Returns null when empty.
 * Used by fit-to-view to compute the zoom + pan that frames everything.
 */
function computeBoundingBox(elements) {
    if (!elements || elements.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
        const b = elementBBox(el);
        if (b.minX < minX) minX = b.minX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.maxY > maxY) maxY = b.maxY;
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export default function EditorCanvas({
    canvas,
    elements,
    localitiesById,
    selection,
    onSelect,
    onUpdate,
    onBatchUpdate,
    onTransform,
    onContextMenu,
    tool,
    onCanvasClick,
    readOnly = false,
    height = 600,
    autoFitKey,
}: EditorCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<Konva.Stage>(null);
    const transformerRef = useRef<Konva.Transformer>(null);
    const elementRefs = useRef<Record<string, Konva.Group>>({});
    const elementsRef = useRef(elements);
    useEffect(() => { elementsRef.current = elements; }, [elements]);
    const fittedKeyRef = useRef<string | null>(null);

    const [containerSize, setContainerSize] = useState({ width: 0, height });
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const panRef = useRef({ x: 0, y: 0 });
    useEffect(() => { panRef.current = pan; }, [pan]);
    const [spaceHeld, setSpaceHeld] = useState(false);
    const [panning, setPanning] = useState(false);
    const spaceHeldRef = useRef(false);
    const spaceDownRef = useRef(false);
    const hoveringRef = useRef(false);
    const panDragRef = useRef<{
        startX: number;
        startY: number;
        originPan: { x: number; y: number };
        moved: boolean;
    } | null>(null);
    const [marquee, setMarquee] = useState<MarqueeState | null>(null);
    const [guides, setGuides] = useState<GuideLine[]>([]);
    const dragSnapshot = useRef<DragSnapshot | null>(null);

    // Measure available width from the parent (not self) to avoid a
    // Stage↔container ResizeObserver feedback loop that grows forever.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return undefined;
        const target = el.parentElement || el;

        const update = () => {
            const width = Math.floor(target.getBoundingClientRect().width);
            if (width < 1) return;
            setContainerSize((prev) => {
                if (Math.abs(prev.width - width) < 1 && prev.height === height) return prev;
                return { width, height };
            });
        };

        update();
        const ro = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(update)
            : null;
        ro?.observe(target);
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("resize", update);
            ro?.disconnect();
        };
    }, [height]);

    // Prevent the browser from stealing middle-click for autoscroll.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return undefined;
        const blockMiddle = (ev: MouseEvent) => {
            if (ev.button === 1) ev.preventDefault();
        };
        el.addEventListener("mousedown", blockMiddle);
        el.addEventListener("auxclick", blockMiddle);
        const onWheel = (ev: WheelEvent) => {
            ev.stopPropagation();
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            el.removeEventListener("mousedown", blockMiddle);
            el.removeEventListener("auxclick", blockMiddle);
            el.removeEventListener("wheel", onWheel);
        };
    }, []);

    // Sync Transformer — only on single selection (multi-select uses group drag).
    useEffect(() => {
        const tr = transformerRef.current;
        if (!tr) return;
        if (selection.length !== 1) {
            tr.nodes([]);
            tr.getLayer()?.batchDraw();
            return;
        }
        const node = elementRefs.current[selection[0]];
        tr.nodes(node ? [node] : []);
        tr.getLayer()?.batchDraw();
    }, [selection, elements]);

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

    const resetView = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    /**
     * Compute bounding box of all elements and fit into the visible viewport,
     * leaving a 40px margin on each side. Falls back to resetView when the
     * canvas is empty. Triggered by toolbar button + keyboard `F` / `0`.
     */
    const fitToView = useCallback(() => {
        if (!elements || elements.length === 0) {
            resetView();
            return;
        }
        const bbox = computeBoundingBox(elements);
        if (!bbox) {
            resetView();
            return;
        }
        const margin = 40;
        const cw = containerSize.width;
        const ch = containerSize.height;
        const scaleX = (cw - margin * 2) / Math.max(1, bbox.width);
        const scaleY = (ch - margin * 2) / Math.max(1, bbox.height);
        const next = Math.min(3, Math.max(0.25, Math.min(scaleX, scaleY)));
        setZoom(next);
        setPan({
            x: cw / 2 - (bbox.x + bbox.width / 2) * next,
            y: ch / 2 - (bbox.y + bbox.height / 2) * next,
        });
    }, [elements, containerSize.width, containerSize.height, resetView]);

    // Auto-center when a venue/layout loads (same as clicking "Centrar").
    useEffect(() => {
        const key = autoFitKey ?? "__default__";
        if (fittedKeyRef.current === key) return;
        if (!elements?.length || containerSize.width < 50) return;
        const raf = requestAnimationFrame(() => {
            fitToView();
            fittedKeyRef.current = key;
        });
        return () => cancelAnimationFrame(raf);
    }, [autoFitKey, elements, containerSize.width, containerSize.height, fitToView]);

    // Keyboard: Space = temporary hand tool. `F` / `0` only in the editor.
    useEffect(() => {
        const isTyping = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            return tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === "Space" || e.key === " ") {
                spaceDownRef.current = true;
                // Hovering the map wins even if an input in a dialog still has focus.
                if (!hoveringRef.current && !panDragRef.current) return;
                e.preventDefault();
                e.stopPropagation();
                (e as KeyboardEvent & { stopImmediatePropagation?: () => void })
                    .stopImmediatePropagation?.();
                if (isTyping(e)) (e.target as HTMLElement)?.blur?.();
                if (e.repeat) return;
                spaceHeldRef.current = true;
                setSpaceHeld(true);
                return;
            }
            if (isTyping(e)) return;
            if (readOnly) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === "f" || e.key === "F") {
                e.preventDefault();
                fitToView();
            } else if (e.key === "0") {
                e.preventDefault();
                resetView();
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code !== "Space" && e.key !== " ") return;
            spaceDownRef.current = false;
            spaceHeldRef.current = false;
            setSpaceHeld(false);
            panDragRef.current = null;
            setPanning(false);
        };
        const onBlur = () => {
            spaceDownRef.current = false;
            spaceHeldRef.current = false;
            setSpaceHeld(false);
            panDragRef.current = null;
            setPanning(false);
        };
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, [fitToView, resetView, readOnly]);

    const startPan = (clientX: number, clientY: number) => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        panDragRef.current = {
            startX: clientX - rect.left,
            startY: clientY - rect.top,
            originPan: { ...panRef.current },
            moved: false,
        };
        setPanning(true);
    };

    const movePan = (clientX: number, clientY: number) => {
        const drag = panDragRef.current;
        const el = containerRef.current;
        if (!drag || !el) return;
        const rect = el.getBoundingClientRect();
        const dx = clientX - rect.left - drag.startX;
        const dy = clientY - rect.top - drag.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        setPan({
            x: drag.originPan.x + dx,
            y: drag.originPan.y + dy,
        });
    };

    const endPan = () => {
        const drag = panDragRef.current;
        if (!drag) return;
        const wasClick = !drag.moved;
        panDragRef.current = null;
        setPanning(false);
        if (wasClick && !readOnly && !spaceHeldRef.current) {
            onSelect([], { additive: false });
        }
    };

    useEffect(() => {
        if (!panning) return undefined;
        const onMove = (ev: PointerEvent) => movePan(ev.clientX, ev.clientY);
        const onUp = () => endPan();
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, [panning]);

    const screenToWorld = (sx, sy) => ({
        x: (sx - pan.x) / zoom,
        y: (sy - pan.y) / zoom,
    });

    const isEmptyTarget = (target: Konva.Node | undefined) => {
        if (!target) return false;
        const stage = target.getStage?.();
        return target === stage || target.attrs?.id === "bg-rect";
    };

    // Pan only with Space or middle-click. Empty click stays select / assign / marquee.
    const handleStageMouseDown = (e) => {
        const evt = e.evt as MouseEvent & TouchEvent;
        const button = evt.button ?? 0;
        const shift = !!evt.shiftKey;
        const clickedEmpty = isEmptyTarget(e.target);
        const touch = evt.touches?.[0];
        const clientX = touch?.clientX ?? evt.clientX;
        const clientY = touch?.clientY ?? evt.clientY;

        if (button === 1 || spaceHeldRef.current) {
            evt.preventDefault?.();
            startPan(clientX, clientY);
            return;
        }

        if (!clickedEmpty || readOnly) return;
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();
        if (!pointer) return;
        const world = screenToWorld(pointer.x, pointer.y);
        if (tool && tool !== "select") {
            onCanvasClick?.(tool, world);
            return;
        }
        setMarquee({
            x: world.x, y: world.y, w: 0, h: 0,
            additive: shift,
        });
    };

    const handleStageMouseMove = () => {
        if (panDragRef.current) return;
        if (!marquee) return;
        const stage = stageRef.current;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const world = screenToWorld(pointer.x, pointer.y);
        setMarquee((m) => ({ ...m, w: world.x - m.x, h: world.y - m.y }));
    };

    const handleStageMouseUp = () => {
        if (panDragRef.current) return;
        if (!marquee) return;
        const { x, y, w, h, additive } = marquee;
        setMarquee(null);
        // Only treat as marquee if dragged > 3px
        if (Math.abs(w) < 3 && Math.abs(h) < 3) {
            if (!additive) onSelect([], { additive: false });
            return;
        }
        const rect = {
            minX: Math.min(x, x + w),
            minY: Math.min(y, y + h),
            maxX: Math.max(x, x + w),
            maxY: Math.max(y, y + h),
        };
        const hit = elements
            .filter((el) => bboxIntersects(rect, elementBBox(el)))
            .map((el) => el.id);
        onSelect(hit, { additive, replace: !additive });
    };

    // ── Group drag handling ──────────────────────────────────────────────
    const handleElementDragStart = (el: VenueCanvasElement, node: Konva.Node) => {
        if (spaceHeldRef.current || panDragRef.current) {
            node.stopDrag?.();
            return;
        }
        // Multi-select + Transformer causes position desync; detach while dragging.
        const tr = transformerRef.current;
        if (tr && selection.length > 1) {
            tr.nodes([]);
            tr.getLayer()?.batchDraw();
        }
        const selectedIds = selection.includes(el.id) ? selection : [el.id];
        const snap: Record<string, DragSnapInfo> = {};
        selectedIds.forEach((id) => {
            const other = elements.find((x) => x.id === id);
            if (other) snap[id] = { startX: other.x, startY: other.y };
        });
        dragSnapshot.current = {
            anchorId: el.id,
            anchorStartX: node.x(),
            anchorStartY: node.y(),
            snap,
        };
        setGuides([]);
    };

    const handleElementDragMove = (el: VenueCanvasElement, node: Konva.Node) => {
        if (spaceHeldRef.current || panDragRef.current) {
            node.stopDrag?.();
            return;
        }
        if (!dragSnapshot.current) {
            handleElementDragStart(el, node);
        }
        const dx = node.x() - dragSnapshot.current.anchorStartX;
        const dy = node.y() - dragSnapshot.current.anchorStartY;

        // Alignment snap (anchor element to neighbors)
        let snappedDx = dx;
        let snappedDy = dy;
        const activeGuides: GuideLine[] = [];
        const anchorEl = el;
        const anchorWorldX = anchorEl.x + dx;
        const anchorWorldY = anchorEl.y + dy;
        const myBox = elementBBox({ ...anchorEl, x: anchorWorldX, y: anchorWorldY });
        const currentElements = elementsRef.current;
        const targets = currentElements.filter((o) => !selection.includes(o.id) && o.id !== el.id);
        for (const o of targets) {
            const ob = elementBBox(o);
            const lines = [
                { type: "v", pos: ob.cx },
                { type: "v", pos: ob.minX },
                { type: "v", pos: ob.maxX },
                { type: "h", pos: ob.cy },
                { type: "h", pos: ob.minY },
                { type: "h", pos: ob.maxY },
            ];
            const myV = [myBox.cx, myBox.minX, myBox.maxX];
            const myH = [myBox.cy, myBox.minY, myBox.maxY];
            for (const l of lines) {
                if (l.type === "v") {
                    for (const mx of myV) {
                        if (Math.abs(mx - l.pos) <= ALIGN_TOLERANCE) {
                            snappedDx = dx + (l.pos - mx);
                            activeGuides.push({ type: "v", pos: l.pos });
                            break;
                        }
                    }
                } else {
                    for (const my of myH) {
                        if (Math.abs(my - l.pos) <= ALIGN_TOLERANCE) {
                            snappedDy = dy + (l.pos - my);
                            activeGuides.push({ type: "h", pos: l.pos });
                            break;
                        }
                    }
                }
            }
        }
        setGuides(activeGuides);

        // Move all selected nodes visually (in Konva) by snappedDx/Dy.
        // We adjust the anchor node first and let the others piggyback via refs.
        const ndx = snappedDx;
        const ndy = snappedDy;
        Object.entries(dragSnapshot.current.snap).forEach(([id, info]) => {
            if (id === el.id) return;
            const otherNode = elementRefs.current[id];
            if (otherNode) {
                otherNode.x(info.startX + ndx);
                otherNode.y(info.startY + ndy);
            }
        });
        // Also clamp the anchor itself to the snapped position
        node.x(dragSnapshot.current.anchorStartX + ndx);
        node.y(dragSnapshot.current.anchorStartY + ndy);
        node.getLayer()?.batchDraw();
    };

    const handleElementDragEnd = (el: VenueCanvasElement, x: number, y: number) => {
        const snap = dragSnapshot.current?.snap;
        const multi = snap && Object.keys(snap).length > 1;

        if (multi) {
            // Snap the *delta* (via the dragged anchor), then apply the same
            // offset to every selected element. Snapping each absolute x/y
            // independently destroys relative spacing (e.g. seats from an
            // exploded row with 30px gaps on a 20px grid).
            const origin = snap[el.id] || { startX: el.x, startY: el.y };
            const dx = snapVal(x) - origin.startX;
            const dy = snapVal(y) - origin.startY;
            const patches: Record<string, Record<string, unknown>> = {};
            Object.entries(snap).forEach(([id, info]) => {
                patches[id] = {
                    x: Math.round((info.startX + dx) * 10) / 10,
                    y: Math.round((info.startY + dy) * 10) / 10,
                };
            });
            if (onBatchUpdate) {
                onBatchUpdate(patches);
            } else {
                Object.entries(patches).forEach(([id, patch]) => onUpdate(id, patch));
            }
        } else {
            onUpdate(el.id, { x: snapVal(x), y: snapVal(y) });
        }

        dragSnapshot.current = null;
        setGuides([]);
    };

    // ── Transformer commit ───────────────────────────────────────────────
    const handleTransformEnd = () => {
        const tr = transformerRef.current;
        if (!tr) return;
        const nodes = tr.nodes();
        for (const node of nodes) {
            const id = node.attrs.id;
            const el = elements.find((e) => e.id === id);
            if (!el) continue;
            const sx = node.scaleX();
            const sy = node.scaleY();
            const rot = node.rotation();
            const x = node.x();
            const y = node.y();
            // Reset visual scale (we encode it in width/seats_count instead).
            node.scaleX(1);
            node.scaleY(1);
            const patch: Record<string, unknown> = { x: snapVal(x), y: snapVal(y), rotation: rot };
            if (el.kind === "stage" || el.kind === "unnumbered_zone") {
                patch.width = Math.max(20, Math.round((el.width || 100) * sx));
                patch.height = Math.max(20, Math.round((el.height || 100) * sy));
            } else if (el.kind === "table_rect") {
                patch.width = Math.max(80, Math.round((el.width || 200) * sx));
                patch.height = Math.max(60, Math.round((el.height || 100) * sy));
            } else if (el.kind === "table_round") {
                const sAvg = (sx + sy) / 2;
                patch.table_radius = Math.max(20, Math.round((el.table_radius || 40) * sAvg));
            } else if (el.kind === "seat_row_straight") {
                // Resize horizontally → more/less seats; keep spacing.
                const oldWidth = ((el.seats_count || 1) - 1) * (el.seat_spacing || 24)
                    + (el.seat_radius || 10) * 2;
                const newWidth = oldWidth * sx;
                const spacing = el.seat_spacing || 24;
                const radius = el.seat_radius || 10;
                const nextCount = Math.max(1, Math.min(200,
                    Math.round((newWidth - radius * 2) / spacing) + 1));
                patch.seats_count = nextCount;
            } else if (el.kind === "seat_row_curved") {
                // Scale only the radius; keep seats_count.
                patch.curve_radius = Math.max(60, Math.round((el.curve_radius || 240) * sx));
            } else if (el.kind === "seat_individual") {
                patch.seat_radius = Math.max(6, Math.round((el.seat_radius || 12) * ((sx + sy) / 2)));
            }
            onTransform?.(id, patch);
        }
    };

    // ── Grid lines (separate layer, listening=false) ─────────────────────
    const gridLines = [];
    if (!readOnly) {
        for (let i = 0; i <= canvas.width; i += GRID) {
            gridLines.push(
                <Line key={`v-${i}`} points={[i, 0, i, canvas.height]}
                      stroke="#E5E7EB"
                      strokeWidth={i % (GRID * 5) === 0 ? 0.8 : 0.3} />,
            );
        }
        for (let j = 0; j <= canvas.height; j += GRID) {
            gridLines.push(
                <Line key={`h-${j}`} points={[0, j, canvas.width, j]}
                      stroke="#E5E7EB"
                      strokeWidth={j % (GRID * 5) === 0 ? 0.8 : 0.3} />,
            );
        }
    }

    const handleContextMenu = (e: Konva.KonvaEventObject<PointerEvent>, el: VenueCanvasElement) => {
        e.evt.preventDefault();
        const stage = stageRef.current;
        const container = containerRef.current;
        if (!stage || !container) return;
        // Select element first if not selected
        if (!selection.includes(el.id)) {
            onSelect([el.id], { additive: false });
        }
        const rect = container.getBoundingClientRect();
        const ptr = stage.getPointerPosition();
        onContextMenu?.({
            elementId: el.id,
            screenX: rect.left + ptr.x,
            screenY: rect.top + ptr.y,
        });
    };

    return (
        <div
            ref={containerRef}
            className="w-full max-w-full min-w-0 bg-slate-50 rounded-lg border relative overflow-hidden outline-none"
            style={{ height, maxWidth: "100%", userSelect: "none", overscrollBehavior: "contain" }}
            data-testid="venue-canvas-wrap"
            onContextMenu={(e) => e.preventDefault()}
            onMouseEnter={() => {
                hoveringRef.current = true;
                if (spaceDownRef.current) {
                    spaceHeldRef.current = true;
                    setSpaceHeld(true);
                }
            }}
            onMouseLeave={() => { hoveringRef.current = false; }}
            onPointerDown={(e) => {
                hoveringRef.current = true;
                e.stopPropagation();
                (e.currentTarget as HTMLElement).focus({ preventScroll: true });
            }}
            onWheel={(e) => e.stopPropagation()}
            tabIndex={0}
            title="Espacio + arrastrar para mover el mapa"
        >
            <Stage
                ref={stageRef}
                width={Math.max(1, containerSize.width)}
                height={Math.max(1, containerSize.height)}
                scaleX={zoom}
                scaleY={zoom}
                x={pan.x}
                y={pan.y}
                onWheel={handleWheel}
                onMouseDown={handleStageMouseDown}
                onMouseMove={handleStageMouseMove}
                onMouseUp={handleStageMouseUp}
                onTouchStart={handleStageMouseDown}
                style={{
                    cursor: spaceHeld
                        ? (panning ? "grabbing" : "grab")
                        : tool && tool !== "select" && !readOnly
                          ? "crosshair"
                          : "default",
                    display: "block",
                    maxWidth: "100%",
                    touchAction: "none",
                }}
            >
                {/* Background + grid layer (no listening) */}
                <Layer listening={true}>
                    <Rect
                        id="bg-rect"
                        x={0}
                        y={0}
                        width={canvas.width}
                        height={canvas.height}
                        fill={canvas.background_color || "#FAFAFA"}
                        stroke="#94A3B8"
                        strokeWidth={1}
                    />
                </Layer>
                <Layer listening={false}>{gridLines}</Layer>

                {/* Elements + Transformer */}
                <Layer>
                    {elements.map((el) => (
                        <ElementShape
                            key={el.id}
                            ref={(node) => {
                                if (node) elementRefs.current[el.id] = node;
                                else delete elementRefs.current[el.id];
                            }}
                            element={el}
                            locality={el.locality_id ? localitiesById[el.locality_id] : undefined}
                            selected={selection.includes(el.id)}
                            draggable={!readOnly && (!tool || tool === "select") && !spaceHeld && !panning}
                            onClick={(e) => {
                                if (spaceHeldRef.current || panDragRef.current) return;
                                e.cancelBubble = true;
                                const additive = e.evt?.ctrlKey || e.evt?.metaKey || e.evt?.shiftKey;
                                onSelect([el.id], { additive });
                            }}
                            onContextMenu={(e) => handleContextMenu(e, el)}
                            onDragStart={(e) => handleElementDragStart(el, e.target)}
                            onDragMove={(e) => handleElementDragMove(el, e.target)}
                            onDragEnd={(x, y) => handleElementDragEnd(el, x, y)}
                            zoom={zoom}
                        />
                    ))}
                    {!readOnly && (
                        <Transformer
                            ref={transformerRef}
                            rotateEnabled
                            keepRatio={false}
                            anchorSize={8}
                            borderStroke="#6366F1"
                            anchorStroke="#6366F1"
                            anchorFill="#fff"
                            rotationSnaps={[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, -15, -30, -45, -60, -75, -90, -105, -120, -135, -150, -165]}
                            onTransformEnd={handleTransformEnd}
                        />
                    )}
                    {/* Alignment guides during drag */}
                    {guides.map((g, i) => (
                        g.type === "v"
                            ? <Line key={`g${i}`} points={[g.pos, 0, g.pos, canvas.height]}
                                    stroke="#10B981" strokeWidth={1 / zoom} dash={[6, 4]} />
                            : <Line key={`g${i}`} points={[0, g.pos, canvas.width, g.pos]}
                                    stroke="#10B981" strokeWidth={1 / zoom} dash={[6, 4]} />
                    ))}
                    {/* Marquee box */}
                    {marquee && (
                        <Rect
                            x={Math.min(marquee.x, marquee.x + marquee.w)}
                            y={Math.min(marquee.y, marquee.y + marquee.h)}
                            width={Math.abs(marquee.w)}
                            height={Math.abs(marquee.h)}
                            fill="rgba(99,102,241,0.10)"
                            stroke="#6366F1"
                            strokeWidth={1 / zoom}
                            dash={[6, 4]}
                        />
                    )}
                </Layer>
            </Stage>

            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs bg-white rounded-md border px-2 py-1 shadow-sm">
                <button onClick={() => setZoom((z) => Math.max(0.25, z / 1.15))}
                        className="px-2 hover:bg-slate-100 rounded" data-testid="zoom-out">−</button>
                <span className="font-mono w-12 text-center" data-testid="zoom-level">
                    {Math.round(zoom * 100)}%
                </span>
                <button onClick={() => setZoom((z) => Math.min(3, z * 1.15))}
                        className="px-2 hover:bg-slate-100 rounded" data-testid="zoom-in">+</button>
                <button
                    onClick={fitToView}
                    className="px-2 py-0.5 hover:bg-slate-100 rounded ml-1 flex items-center gap-1"
                    data-testid="zoom-fit"
                    title="Centrar y ajustar todo (F)"
                >
                    <Maximize2 className="h-3 w-3" />
                    Centrar
                </button>
                <button onClick={resetView}
                        className="px-2 hover:bg-slate-100 rounded"
                        data-testid="zoom-reset"
                        title="Volver a zoom 1:1 (0)">Reset</button>
                <span className="hidden sm:inline text-muted-foreground pl-1" title="Espacio = mano">
                    Espacio
                </span>
            </div>
        </div>
    );
}
