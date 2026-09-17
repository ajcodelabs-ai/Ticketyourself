/**
 * Numeric input with a local draft so clearing a digit (e.g. "50" → "" → "90")
 * isn't clamped back to `min` on every keystroke. Only clamps on blur/Enter.
 * Shared by PropertiesPanel and the element-creation dialogs — any bounded
 * numeric field on the venue editor should use this instead of a raw
 * `<Input type="number">` with an inline Math.max/min in onChange.
 */
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export default function ClampedNumberInput({
    value,
    min = 1,
    max,
    disabled,
    onCommit,
    testid,
    className,
}: {
    value: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    onCommit: (n: number) => void;
    testid?: string;
    className?: string;
}) {
    const [draft, setDraft] = useState(String(value ?? min));
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) setDraft(String(value ?? min));
    }, [value, min]);

    const commit = () => {
        focusedRef.current = false;
        let next = parseInt(draft, 10);
        if (!Number.isFinite(next)) next = min;
        next = Math.max(min, next);
        if (max != null) next = Math.min(max, next);
        setDraft(String(next));
        if (next !== value) onCommit(next);
    };

    return (
        <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            min={min}
            max={max}
            value={draft}
            disabled={disabled}
            className={className || "h-8"}
            data-testid={testid}
            onFocus={() => { focusedRef.current = true; }}
            onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                    setDraft("");
                    return;
                }
                if (!/^\d+$/.test(raw)) return;
                setDraft(raw);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
        />
    );
}
