/**
 * /eventos/:id/editar — alias of EventDetail's edit mode.
 * Loads the event then renders the form directly.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import EventForm from "@/components/events/EventForm";

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
                navigate("/eventos", { replace: true });
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
        <div className="space-y-4 max-w-3xl mx-auto" data-testid="event-edit-page">
            <Button
                variant="ghost"
                onClick={() => navigate(`/eventos/${event.id}`)}
                className="-ml-2"
            >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Volver al evento
            </Button>
            <h1 className="text-2xl font-semibold">Editar evento</h1>
            <EventForm
                initial={event}
                mode="edit"
                onSaved={() => navigate(`/eventos/${event.id}`)}
            />
        </div>
    );
}
