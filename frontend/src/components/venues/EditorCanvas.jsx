/**
 * Canvas — react-konva Stage with elements + grid + zoom/pan.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Stage, Layer, Rect, Line, Group } from "react-konva";
import ElementShape from "./ElementShape";
import { GRID } from "@/lib/venues";

export default function EditorCanvas({
    canvas,
    elements,
    localitiesById,
    selection,
    onSelect,
    onUpdate,
    tool,
    onCanvasClick,
    readOnly = false,
    height = 600,
}) {
    const containerRef = useRef(null);
    const stageRef = useRef(null);
    const [containerSize, setContainerSize] = useState({ width: 800, height });
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });

    // Track container size
    useEffect(() => {
        const update = () => {
            if (containerRef.current) {
                setContainerSize({
                    width: containerRef.current.offsetWidth,
                    height,
                });
            }
        };
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, [height]);

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

    const resetView = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    const handleStageMouseDown = (e) => {
        // Click on empty area (Stage or background Rect) → deselect / tool placement
        const clickedEmpty = e.target === e.target.getStage()
            || e.target.attrs.id === "bg-rect";
        if (!clickedEmpty) return;
        if (readOnly) return;
        const stage = stageRef.current;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        // Convert to local coords using current pan/zoom
        const x = (pointer.x - pan.x) / zoom;
        const y = (pointer.y - pan.y) / zoom;
        if (tool && tool !== "select") {
            onCanvasClick?.(tool, { x, y });
        } else {
            onSelect([], { additive: false });
        }
    };

    const gridLines = [];
    if (!readOnly) {
        for (let i = 0; i <= canvas.width; i += GRID) {
            gridLines.push(
                <Line
                    key={`v-${i}`}
                    points={[i, 0, i, canvas.height]}
                    stroke="#E5E7EB"
                    strokeWidth={i % (GRID * 5) === 0 ? 0.8 : 0.3}
                />,
            );
        }
        for (let j = 0; j <= canvas.height; j += GRID) {
            gridLines.push(
                <Line
                    key={`h-${j}`}
                    points={[0, j, canvas.width, j]}
                    stroke="#E5E7EB"
                    strokeWidth={j % (GRID * 5) === 0 ? 0.8 : 0.3}
                />,
            );
        }
    }

    return (
        <div ref={containerRef} className="w-full bg-slate-50 rounded-lg border relative overflow-hidden" data-testid="venue-canvas-wrap">
            <Stage
                ref={stageRef}
                width={containerSize.width}
                height={containerSize.height}
                scaleX={zoom}
                scaleY={zoom}
                x={pan.x}
                y={pan.y}
                onWheel={handleWheel}
                onMouseDown={handleStageMouseDown}
                onTouchStart={handleStageMouseDown}
                style={{ cursor: tool && tool !== "select" ? "crosshair" : "default" }}
            >
                <Layer>
                    <Rect
                        id="bg-rect"
                        x={0}
                        y={0}
                        width={canvas.width}
                        height={canvas.height}
                        fill={canvas.background_color || "#FAFAFA"}
                        stroke="#94A3B8"
                        strokeWidth={1}
                        listening={true}
                    />
                    <Group listening={false}>{gridLines}</Group>
                    {elements.map((el) => (
                        <ElementShape
                            key={el.id}
                            element={el}
                            locality={localitiesById[el.locality_id]}
                            selected={selection.includes(el.id)}
                            draggable={!readOnly && (!tool || tool === "select")}
                            onClick={(e) => {
                                e.cancelBubble = true;
                                const additive = e.evt?.ctrlKey || e.evt?.metaKey || e.evt?.shiftKey;
                                onSelect([el.id], { additive });
                            }}
                            onDragEnd={(nx, ny) => onUpdate(el.id, { x: nx, y: ny })}
                            zoom={zoom}
                        />
                    ))}
                </Layer>
            </Stage>
            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs bg-white rounded-md border px-2 py-1 shadow-sm">
                <button
                    onClick={() => setZoom((z) => Math.max(0.25, z / 1.15))}
                    className="px-2 hover:bg-slate-100 rounded"
                    data-testid="zoom-out"
                >
                    −
                </button>
                <span className="font-mono w-12 text-center" data-testid="zoom-level">
                    {Math.round(zoom * 100)}%
                </span>
                <button
                    onClick={() => setZoom((z) => Math.min(3, z * 1.15))}
                    className="px-2 hover:bg-slate-100 rounded"
                    data-testid="zoom-in"
                >
                    +
                </button>
                <button
                    onClick={resetView}
                    className="px-2 hover:bg-slate-100 rounded ml-1"
                    data-testid="zoom-reset"
                >
                    Reset
                </button>
            </div>
        </div>
    );
}
