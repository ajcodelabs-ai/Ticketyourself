/**
 * PendingBanner — orange banner shown to organizers whose account is awaiting
 * admin approval. Lets them know they can keep drafting events/venues/microsite
 * but won't be able to publish until approved.
 *
 * Renders nothing for approved orgs so callers can use it unconditionally.
 */
import { Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function PendingBanner({ className = "" }) {
    const { organizer } = useAuth();
    if (organizer?.status !== "pending") return null;
    return (
        <div
            className={`flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 ${className}`}
            data-testid="pending-banner"
            role="status"
        >
            <Clock className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" aria-hidden />
            <div className="text-sm text-amber-900 leading-snug">
                <p className="font-semibold mb-0.5">Tu cuenta está en revisión.</p>
                <p>
                    Mientras tanto, podés crear y configurar tus eventos y venues
                    en modo borrador. Te avisaremos cuando puedas publicarlos.
                </p>
            </div>
        </div>
    );
}
