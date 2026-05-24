/**
 * Public read-only preview of a published venue.
 * Route: /o/:tenantSlug/venues/:venueSlug/preview
 * No auth needed. Shows the same canvas without toolbar/sidebar.
 */
import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Loader2, MapPin } from "lucide-react";
import EditorCanvas from "@/components/venues/EditorCanvas";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { venuesApi, computeCapacity } from "@/lib/venues";

export default function VenuePreview() {
    const { tenantSlug, venueSlug } = useParams();
    const [venue, setVenue] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const v = await venuesApi.publicGet(tenantSlug, venueSlug);
                if (mounted) setVenue(v);
            } catch (e) {
                if (mounted) setError(e?.response?.status === 404 ? "Venue no encontrado" : "Error cargando venue");
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [tenantSlug, venueSlug]);

    const localitiesById = useMemo(
        () => Object.fromEntries((venue?.localities || []).map((l) => [l.id, l])),
        [venue],
    );

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Cargando…
            </div>
        );
    }
    if (error || !venue) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center text-slate-500 gap-2 p-6">
                <MapPin className="h-10 w-10 text-slate-300" />
                <p className="font-medium">{error || "Venue no disponible"}</p>
            </div>
        );
    }

    const capacity = computeCapacity(venue.elements || []);

    return (
        <div className="min-h-screen bg-slate-50" data-testid="venue-preview-page">
            <header className="bg-white border-b">
                <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-2">
                    <div>
                        <h1 className="text-xl font-bold">{venue.name}</h1>
                        <p className="text-xs text-muted-foreground">
                            {venue.organizer?.company_name || venue.tenant_slug}
                            {" · "}{capacity} de capacidad
                        </p>
                    </div>
                    <Badge variant="secondary">Vista previa</Badge>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
                <Card>
                    <CardContent className="pt-4">
                        <EditorCanvas
                            canvas={venue.canvas}
                            elements={venue.elements || []}
                            localitiesById={localitiesById}
                            selection={[]}
                            onSelect={() => {}}
                            onUpdate={() => {}}
                            tool="select"
                            onCanvasClick={() => {}}
                            readOnly
                            height={620}
                        />
                    </CardContent>
                </Card>

                {(venue.localities || []).length > 0 && (
                    <Card>
                        <CardContent className="pt-4">
                            <h2 className="text-sm font-semibold mb-2">Localidades</h2>
                            <div className="flex flex-wrap gap-3">
                                {venue.localities.map((loc) => (
                                    <div key={loc.id} className="flex items-center gap-2 text-sm">
                                        <span
                                            className="h-4 w-4 rounded ring-1 ring-slate-200"
                                            style={{ background: loc.color }}
                                        />
                                        <span>{loc.name}</span>
                                        {loc.default_price_cents != null && (
                                            <span className="text-muted-foreground">
                                                · USD {(loc.default_price_cents / 100).toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {venue.description && (
                    <Card>
                        <CardContent className="pt-4">
                            <p className="text-sm text-muted-foreground">{venue.description}</p>
                        </CardContent>
                    </Card>
                )}
            </main>
        </div>
    );
}
