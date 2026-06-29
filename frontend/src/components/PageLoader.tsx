import { Loader2 } from "lucide-react";

export default function PageLoader() {
    return (
        <div
            className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground"
            role="status"
            aria-live="polite"
            aria-label="Cargando página"
        >
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm">Cargando…</span>
        </div>
    );
}
