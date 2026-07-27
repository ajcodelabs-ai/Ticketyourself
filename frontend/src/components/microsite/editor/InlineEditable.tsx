/**
 * Click-to-edit text inline en el preview del editor.
 */
import { useEffect, useRef, useState, type PointerEvent, type ChangeEvent, type KeyboardEvent, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export default function InlineEditable({
    value,
    onChange,
    enabled = false,
    as = "span",
    className = "",
    placeholder = "Click para editar",
    multiline = false,
    testid,
    onSelect,
    style,
}: {
    value: string;
    onChange: (v: string) => void;
    enabled?: boolean;
    as?: "span" | "h1" | "h2" | "p";
    className?: string;
    placeholder?: string;
    multiline?: boolean;
    testid?: string;
    onSelect?: () => void;
    style?: CSSProperties;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value || "");
    const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!editing) setDraft(value || "");
    }, [value, editing]);

    useEffect(() => {
        if (editing && ref.current) {
            ref.current.focus();
            ref.current.select?.();
        }
    }, [editing]);

    const commit = () => {
        setEditing(false);
        if (draft !== value) onChange(draft);
    };

    const Tag = as;

    if (!enabled) {
        return <Tag className={className} style={style}>{value}</Tag>;
    }

    if (editing) {
        const shared = {
            ref: ref as never,
            value: draft,
            onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setDraft(e.target.value),
            onBlur: commit,
            onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && !multiline) {
                    e.preventDefault();
                    commit();
                }
                if (e.key === "Escape") {
                    setDraft(value || "");
                    setEditing(false);
                }
            },
            className: cn(
                "w-full bg-white/90 text-gray-900 rounded px-2 py-1 border-2 border-primary outline-none",
                className,
            ),
            "data-testid": testid,
        };
        return multiline ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />;
    }

        return (
        <Tag
            role="button"
            tabIndex={0}
            data-inline-editable
            style={style}
            className={cn(
                className,
                "cursor-text rounded px-1 -mx-1 transition hover:ring-2 hover:ring-primary/50 hover:ring-offset-1 hover:ring-offset-transparent",
                !value && "opacity-60 italic",
            )}
            onClick={(e) => {
                e.stopPropagation();
                onSelect?.();
                setEditing(true);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(true);
                }
            }}
            data-testid={testid}
        >
            {value || placeholder}
        </Tag>
    );
}
