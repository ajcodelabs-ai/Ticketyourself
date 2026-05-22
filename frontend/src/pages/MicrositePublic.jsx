/**
 * Public microsite page. Accessed via /o/{slug} in preview.
 * In production behind wildcard DNS this would also serve {slug}.ajcodelabs.ai.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, Frown, ArrowLeft } from "lucide-react";

import api from "@/lib/api";
import MicrositeRenderer from "@/components/microsite/MicrositeRenderer";

export default function MicrositePublic() {
    const { slug } = useParams();
    const [microsite, setMicrosite] = useState(null);
    const [state, setState] = useState("loading");

    useEffect(() => {
        let alive = true;
        setState("loading");
        api.get(`/public/microsite/${slug}`)
            .then((r) => {
                if (!alive) return;
                setMicrosite(r.data);
                setState("ready");
                document.title = `${r.data.company_name} · Ticket Yourself`;
            })
            .catch((e) => {
                if (!alive) return;
                setState(e?.response?.status === 404 ? "notfound" : "error");
            });
        return () => {
            alive = false;
        };
    }, [slug]);

    if (state === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (state === "notfound" || state === "error") {
        return (
            <div
                className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
                data-testid="microsite-public-notfound"
            >
                <Frown className="h-12 w-12 text-muted-foreground mb-3" />
                <h1 className="text-2xl font-semibold mb-2">Microsite no disponible</h1>
                <p className="text-muted-foreground max-w-md">
                    Este organizador todavía no publicó su microsite o el link es incorrecto.
                </p>
                <Link to="/" className="mt-6 inline-flex items-center gap-1 underline text-primary">
                    <ArrowLeft className="h-4 w-4" />
                    Volver al inicio
                </Link>
            </div>
        );
    }

    return <MicrositeRenderer microsite={microsite} />;
}
