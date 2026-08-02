/**
 * DateTimePicker — calendar + hour/minute instead of native datetime-local.
 * Value format stays "YYYY-MM-DDTHH:mm" so EventWizard helpers keep working.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];
const QUICK_TIMES = ["10:00", "12:00", "15:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
const DEFAULT_TIME = { hour: "20", minute: "00" };

function parseLocalInput(value) {
    if (!value || typeof value !== "string") return null;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const date = new Date(y, mo - 1, d, hh, mm);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function toLocalInput(date, hour, minute) {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    return `${y}-${mo}-${d}T${hh}:${mm}`;
}

export default function DateTimePicker({
    value = "",
    onChange,
    disabled = false,
    placeholder = "Elegí fecha y hora",
    "data-testid": testId,
    className,
}: {
    value?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
    placeholder?: string;
    "data-testid"?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const parsed = useMemo(() => parseLocalInput(value), [value]);

    const hour = parsed
        ? String(parsed.getHours()).padStart(2, "0")
        : DEFAULT_TIME.hour;
    const minute = parsed
        ? String(parsed.getMinutes()).padStart(2, "0")
        : DEFAULT_TIME.minute;

    const minuteOptions = useMemo(() => {
        if (minute && !MINUTES.includes(minute)) {
            return [...MINUTES, minute].sort();
        }
        return MINUTES;
    }, [minute]);

    const label = parsed
        ? format(parsed, "EEE d MMM yyyy · HH:mm", { locale: es })
        : placeholder;

    const emit = (date, nextHour, nextMinute) => {
        if (!onChange || !date) return;
        onChange(toLocalInput(date, nextHour, nextMinute));
    };

    const onSelectDay = (day) => {
        if (!day) return;
        emit(day, hour, minute);
    };

    const onHour = (h) => {
        const base = parsed || new Date();
        emit(base, h, minute);
    };

    const onMinute = (m) => {
        const base = parsed || new Date();
        emit(base, hour, m);
    };

    const onQuick = (time) => {
        const [h, m] = time.split(":");
        const base = parsed || new Date();
        emit(base, h, m);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    data-testid={testId}
                    className={cn(
                        "w-full justify-start text-left font-normal h-9 px-3",
                        !parsed && "text-muted-foreground",
                        className,
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                    <span className="truncate capitalize">{label}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-auto p-0"
                align="start"
                data-testid={testId ? `${testId}-popover` : undefined}
            >
                <Calendar
                    mode="single"
                    selected={parsed || undefined}
                    onSelect={onSelectDay}
                    initialFocus
                    locale={es}
                    disabled={disabled}
                />
                <div className="border-t p-3 space-y-3">
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Select value={hour} onValueChange={onHour} disabled={disabled}>
                            <SelectTrigger className="h-8 w-[72px]" data-testid={testId ? `${testId}-hour` : undefined}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-56">
                                {HOURS.map((h) => (
                                    <SelectItem key={h} value={h}>
                                        {h}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground font-medium">:</span>
                        <Select value={minute} onValueChange={onMinute} disabled={disabled}>
                            <SelectTrigger className="h-8 w-[72px]" data-testid={testId ? `${testId}-minute` : undefined}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-56">
                                {minuteOptions.map((m) => (
                                    <SelectItem key={m} value={m}>
                                        {m}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground ml-1">hs</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {QUICK_TIMES.map((t) => (
                            <button
                                key={t}
                                type="button"
                                disabled={disabled}
                                onClick={() => onQuick(t)}
                                className={cn(
                                    "text-[11px] px-2 py-1 rounded-md border transition",
                                    `${hour}:${minute}` === t
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-background hover:bg-accent text-muted-foreground",
                                )}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => setOpen(false)}
                            disabled={!parsed}
                            data-testid={testId ? `${testId}-done` : undefined}
                        >
                            Listo
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
