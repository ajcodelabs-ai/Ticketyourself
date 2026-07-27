import { useEffect } from "react";
import { resolveSeo, applyMicrositeHead } from "@/lib/micrositeSeo";

/**
 * Sets document title and social meta tags for microsite pages / editor preview.
 */
export default function MicrositeHead({
    microsite,
    publicUrl = undefined,
    enabled = true,
}) {
    useEffect(() => {
        if (!enabled || !microsite) return;
        const resolved = resolveSeo(microsite, publicUrl);
        applyMicrositeHead(resolved);
    }, [microsite, publicUrl, enabled]);

    return null;
}
