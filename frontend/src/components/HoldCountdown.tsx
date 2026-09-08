/**
 * Shared seat/ticket hold countdown — ticks down from `expiresAt`, calls
 * `onExpire` once it hits zero. Used by the seat-selection banner
 * (NumberedSeatSection) and the purchase modal's header badge.
 */
import { useEffect, useRef, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";

export const HOLD_WARNING_SECONDS = 120;

export function useHoldCountdown(expiresAt: string, onExpire: () => void) {
    const [secondsLeft, setSecondsLeft] = useState(() =>
        Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
    );
    const onExpireRef = useRef(onExpire);
    onExpireRef.current = onExpire;

    useEffect(() => {
        if (secondsLeft <= 0) { onExpireRef.current(); return; }
        const t = setInterval(() => {
            setSecondsLeft((s) => {
                if (s <= 1) { clearInterval(t); onExpireRef.current(); return 0; }
                return s - 1;
            });
        }, 1000);
        return () => clearInterval(t);
        // Re-run only if expiresAt changes (new hold) — onExpire is read via ref.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expiresAt]);

    return secondsLeft;
}

export default function HoldCountdown({
    expiresAt, onExpire, large = false,
}: { expiresAt: string; onExpire: () => void; large?: boolean }) {
    const secondsLeft = useHoldCountdown(expiresAt, onExpire);
    const min = Math.floor(secondsLeft / 60);
    const sec = secondsLeft % 60;
    const warning = secondsLeft < HOLD_WARNING_SECONDS;
    return (
        <span
            className={`inline-flex items-center gap-1 font-mono font-semibold ${large ? "text-lg" : "text-sm"} ${warning ? "text-amber-600 animate-pulse" : "text-emerald-600"}`}
            data-testid="hold-countdown"
        >
            {warning ? (
                <AlertTriangle className={large ? "h-5 w-5" : "h-3.5 w-3.5"} />
            ) : (
                <Clock className={large ? "h-5 w-5" : "h-3.5 w-3.5"} />
            )}
            {min}:{sec.toString().padStart(2, "0")}
        </span>
    );
}
