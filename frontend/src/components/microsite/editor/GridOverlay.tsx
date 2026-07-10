/** Cuadrícula 12×6 visible en modo editor — ocupa todo el área del hero. */
import { GRID_COLS, GRID_ROWS } from "@/lib/micrositeLayers";

export default function GridOverlay() {
    return (
        <div
            className="absolute inset-0 pointer-events-none z-[5]"
            aria-hidden
            data-testid="editor-grid-overlay"
        >
            <div className="h-full w-full max-w-6xl mx-auto px-6 sm:px-10 grid grid-cols-12 grid-rows-6 gap-0">
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
