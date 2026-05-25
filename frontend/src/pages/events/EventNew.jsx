/**
 * /app/eventos/nuevo — wizard-based event creation.
 */
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import EventWizard from "@/components/events/EventWizard";

export default function EventNew() {
    const navigate = useNavigate();
    return (
        <div className="space-y-4" data-testid="event-new-page">
            <Button
                variant="ghost"
                onClick={() => navigate("/app/eventos")}
                className="-ml-2"
                data-testid="event-new-back"
            >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Volver
            </Button>
            <header>
                <div className="text-sm text-muted-foreground">Nuevo evento</div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                    Configurá tu evento
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Completá las 6 secciones. Podés guardar como borrador y volver luego.
                </p>
            </header>
            <EventWizard mode="create" />
        </div>
    );
}
