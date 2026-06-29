/**
 * /app/eventos/:event_id/editar — edit event via the 7-section wizard.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import EventWizard from "@/components/events/EventWizard";

export default function EventEdit() {
    const { event_id } = useParams();
    const navigate = useNavigate();
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get(`/events/me/${event_id}`)
            .then((r) => setEvent(r.data))
            .catch((e) => {
                toast.error(formatApiError(e?.response?.data?.detail) || e.message);
                navigate("/app/eventos", { replace: true });
            })
            .finally(() => setLoading(false));
    }, [event_id, navigate]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!event) return null;

    return (
        <div className="space-y-4" data-testid="event-edit-page">
            <Button
                variant="ghost"
                onClick={() => navigate(`/app/eventos/${event.id}`)}
                className="-ml-2"
            >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Volver al evento
            </Button>
            <header>
                <div className="text-sm text-muted-foreground">Editar evento</div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                    {event.title}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Ajustá cualquier sección del wizard. Los cambios se guardan al hacer clic en
                    "Guardar borrador" o "Publicar ahora".
                </p>
            </header>
            <EventWizard initial={event} mode="edit" />
        </div>
    );
}
