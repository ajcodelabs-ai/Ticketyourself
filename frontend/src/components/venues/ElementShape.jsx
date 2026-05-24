/**
 * Renders a single venue element on the canvas (react-konva).
 * Pure presentational: receives `element`, `locality`, `selected`, `onClick`, `onDragEnd`.
 */
import { Group, Rect, Text, Circle } from "react-konva";
import { rowSize, GRID } from "@/lib/venues";

function snapVal(v) {
    return Math.round(v / GRID) * GRID;
}

function StageShape({ element, locality, selected, onClick, onDragEnd, draggable }) {
    const w = element.width || 200;
    const h = element.height || 80;
    return (
        <Group
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
        >
            <Rect
                width={w}
                height={h}
                fill={element.color || "#9CA3AF"}
                cornerRadius={4}
                stroke={selected ? "#6366F1" : "transparent"}
                strokeWidth={selected ? 3 : 0}
                dash={selected ? [6, 4] : undefined}
            />
            <Text
                x={0}
                y={h / 2 - 8}
                width={w}
                align="center"
                fontStyle="bold"
                fontSize={14}
                fill="#fff"
                text={element.label || "Escenario"}
            />
        </Group>
    );
}

function ZoneShape({ element, locality, selected, onClick, onDragEnd, draggable }) {
    const w = element.width || 200;
    const h = element.height || 100;
    const color = locality?.color || "#94A3B8";
    return (
        <Group
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
        >
            <Rect
                width={w}
                height={h}
                fill={color}
                opacity={0.32}
                cornerRadius={6}
                stroke={selected ? "#6366F1" : color}
                strokeWidth={selected ? 3 : 2}
                dash={selected ? [6, 4] : [4, 4]}
            />
            <Text
                x={0}
                y={h / 2 - 16}
                width={w}
                align="center"
                fontStyle="bold"
                fontSize={13}
                fill="#1F2937"
                text={element.label || "Zona"}
            />
            <Text
                x={0}
                y={h / 2 + 2}
                width={w}
                align="center"
                fontSize={11}
                fill="#475569"
                text={`Cap: ${element.capacity || 0}`}
            />
        </Group>
    );
}

function RowShape({ element, locality, selected, onClick, onDragEnd, draggable, zoom = 1 }) {
    const seats = element.seats_count || 0;
    const spacing = element.seat_spacing || 24;
    const radius = element.seat_radius || 10;
    const { w, h } = rowSize(element);
    const color = locality?.color || "#94A3B8";
    const showLabels = zoom * spacing >= 22 && seats <= 40;

    return (
        <Group
            x={element.x}
            y={element.y}
            rotation={element.rotation || 0}
            draggable={draggable}
            onClick={onClick}
            onTap={onClick}
            onDragEnd={(e) => onDragEnd(snapVal(e.target.x()), snapVal(e.target.y()))}
        >
            {selected && (
                <Rect
                    x={-6}
                    y={-6}
                    width={w + 12}
                    height={h + 12}
                    stroke="#6366F1"
                    strokeWidth={2}
                    dash={[6, 4]}
                    cornerRadius={6}
                />
            )}
            {element.row_label && (
                <Text
                    x={-28}
                    y={radius - 7}
                    text={element.row_label}
                    fontStyle="bold"
                    fontSize={13}
                    fill="#374151"
                />
            )}
            {Array.from({ length: seats }).map((_, i) => {
                const num = element.numbering_direction === "rtl"
                    ? seats - i + (element.numbering_start || 1) - 1
                    : (element.numbering_start || 1) + i;
                return (
                    <Group key={i} x={i * spacing} y={0}>
                        <Circle
                            x={radius}
                            y={radius}
                            radius={radius}
                            fill={color}
                            stroke="#fff"
                            strokeWidth={1}
                        />
                        {showLabels && (
                            <Text
                                x={0}
                                y={radius - 5}
                                width={radius * 2}
                                align="center"
                                fontSize={9}
                                fill="#fff"
                                text={String(num)}
                            />
                        )}
                    </Group>
                );
            })}
        </Group>
    );
}

export default function ElementShape(props) {
    const { element } = props;
    if (element.kind === "stage") return <StageShape {...props} />;
    if (element.kind === "unnumbered_zone") return <ZoneShape {...props} />;
    if (element.kind === "seat_row_straight") return <RowShape {...props} />;
    return null;
}
