/** Cuadrícula 12×6 visible en modo editor — ocupa todo el área del hero. */
import { GRID_COLS, GRID_ROWS, type RowGeometry } from "@/lib/micrositeLayers";

export default function GridOverlay({ rowGeometry }: { rowGeometry?: RowGeometry }) {
    // Rows aren't necessarily equal height (they use auto/minmax tracks so
    // long hero text doesn't overlap adjacent rows), and when the
    // content is shorter than the section's min-height floor it's centered,
    // leaving blank space above row 1 (rowGeometry.bounds[0]). Draw the
    // lines at that same offset and those same heights so the overlay
    // matches where things actually snap.
    const heights = rowGeometry?.heights;
    const gridTemplateRows =
        heights && heights.length === GRID_ROWS
            ? heights.map((h) => `${h}px`).join(" ")
            : `repeat(${GRID_ROWS}, 1fr)`;
    const paddingTop = rowGeometry?.bounds[0] ?? 0;

    return (
        <div
            className="absolute inset-0 pointer-events-none z-[5]"
            aria-hidden
            data-testid="editor-grid-overlay"
        >
            <div
                className="h-full w-full max-w-6xl mx-auto px-6 sm:px-10 grid gap-0"
                style={{ gridTemplateRows, gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, paddingTop }}
            >
                {Array.from({ length: GRID_COLS * GRID_ROWS }).map((_, i) => (
                    <div
                        key={i}
                        className="border border-dashed border-white/20"
                    />
                ))}
            </div>
        </div>
    );
}
