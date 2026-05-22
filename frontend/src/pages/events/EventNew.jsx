/**
 * /eventos/nuevo — create event flow.
 * Reuses EventForm; redirects to /eventos/{id} after first save.
 */
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import EventForm from "@/components/events/EventForm";

export default function EventNew() {
    const navigate = useNavigate();
    return (
        <div className="space-y-4 max-w-3xl mx-auto" data-testid="event-new-page">
            <Button
                variant="ghost"
                onClick={() => navigate("/eventos")}
                className="-ml-2"
                data-testid="event-new-back"
            >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Volver
            </Button>
            <div>
                <h1 className="text-2xl font-semibold">Crear evento</h1>
                <p className="text-sm text-muted-foreground">
                    Definí los detalles. Podés guardar como borrador y volver luego.
                </p>
            </div>
            <EventForm
                mode="create"
                onSaved={(id) => navigate(`/eventos/${id}`)}
            />
        </div>
    );
}
