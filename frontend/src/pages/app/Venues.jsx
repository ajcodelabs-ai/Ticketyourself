/**
 * /app/venues — Phase 5 placeholder.
 * The drag-and-drop venue editor lands in Phase 6.
 */
import { Link } from "react-router-dom";
import { MapPin, Plus, ArrowLeft, Layers, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export default function Venues() {
    return (
        <div className="space-y-6" data-testid="venues-page">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <div className="text-sm text-muted-foreground">Venues</div>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                        Lugares físicos
                    </h1>
                    <p className="text-muted-foreground max-w-2xl mt-2">
                        Creá los lugares donde harás tus eventos y diseñá sus mapas de
                        asientos. Vas a poder reutilizarlos en múltiples eventos y elegir
                        butacas numeradas.
                    </p>
                </div>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span tabIndex={0}>
                                <Button disabled data-testid="venues-create-btn-disabled">
                                    <Plus className="h-4 w-4 mr-1.5" />
                                    Crear venue
                                </Button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>Próximamente — Fase 6</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </header>

            {/* ── Empty state ───────────────────────────────────────────── */}
            <Card data-testid="venues-empty-state" className="overflow-hidden">
                <div className="bg-gradient-to-br from-primary/5 via-transparent to-amber-50 px-6 py-10">
                    <div className="grid lg:grid-cols-5 gap-8 items-center">
                        {/* Illustration */}
                        <div className="lg:col-span-3">
                            <div
                                className="aspect-[16/10] rounded-2xl bg-white/70 border-2 border-dashed border-primary/40 p-6 flex flex-col"
                                data-testid="venues-illustration"
                            >
                                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                                    Vista previa · editor drag-and-drop
                                </div>
                                {/* Fake seat map */}
                                <div className="flex-1 grid grid-rows-6 gap-1">
                                    {Array.from({ length: 6 }).map((_, row) => (
                                        <div key={row} className="flex gap-1 justify-center">
                                            {Array.from({ length: 10 + (row % 2) }).map(
                                                (_, col) => (
                                                    <div
                                                        key={col}
                                                        className={`h-3 w-3 rounded-sm ${
                                                            row === 0
                                                                ? "bg-amber-300"
                                                                : row === 1
                                                                  ? "bg-primary/60"
                                                                  : "bg-slate-200"
                                                        }`}
                                                    />
                                                ),
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-center mt-4 text-xs gap-3 text-muted-foreground">
                                    <span className="inline-flex items-center gap-1">
                                        <span className="h-2 w-2 rounded-sm bg-amber-300" />
                                        VIP
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <span className="h-2 w-2 rounded-sm bg-primary/60" />
                                        Platea
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <span className="h-2 w-2 rounded-sm bg-slate-300" />
                                        General
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Pitch */}
                        <div className="lg:col-span-2 space-y-4">
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-xs font-medium">
                                <Sparkles className="h-3 w-3" />
                                Próximamente — Fase 6
                            </div>
                            <h2 className="text-2xl font-semibold tracking-tight">
                                Editor visual con asientos numerados
                            </h2>
                            <p className="text-muted-foreground text-sm">
                                Diseñá tu venue arrastrando butacas, definiendo zonas con
                                precios distintos (VIP, Platea, General) y guardalo para usar
                                en futuros eventos.
                            </p>
                            <ul className="space-y-2 text-sm">
                                <FeatureRow text="Mapa drag-and-drop de butacas y zonas" />
                                <FeatureRow text="Múltiples localidades con precios independientes" />
                                <FeatureRow text="Reutilizable entre eventos del mismo lugar" />
                                <FeatureRow text="Compradores eligen su butaca en la página pública" />
                            </ul>
                        </div>
                    </div>
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Mientras tanto</CardTitle>
                    <CardDescription>
                        Podés crear eventos sin venue asignado. Definí el nombre del lugar
                        en la sección "Localidades" del wizard de eventos.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    <Button asChild data-testid="venues-create-event-link">
                        <Link to="/app/eventos/nuevo">
                            <Plus className="h-4 w-4 mr-1.5" />
                            Crear evento sin venue
                        </Link>
                    </Button>
                    <Button variant="outline" asChild>
                        <Link to="/app/dashboard">
                            <ArrowLeft className="h-4 w-4 mr-1.5" />
                            Volver al dashboard
                        </Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

function FeatureRow({ text }) {
    return (
        <li className="flex items-start gap-2">
            <span className="mt-0.5 h-5 w-5 rounded-md bg-primary/10 text-primary grid place-items-center shrink-0">
                <Layers className="h-3 w-3" />
            </span>
            <span className="text-foreground/80">{text}</span>
        </li>
    );
}
