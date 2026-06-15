/**
 * PasswordInput — Input with built-in eye/eye-off toggle for show/hide password.
 * Drop-in replacement for <Input type="password" />.
 *
 * Usage:
 *   <PasswordInput value={pwd} onChange={(e) => setPwd(e.target.value)} />
 */
import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PasswordInput = React.forwardRef(function PasswordInput(
    { className, disabled, "data-testid": testId, ...props },
    ref,
) {
    const [visible, setVisible] = React.useState(false);
    return (
        <div className="relative">
            <Input
                ref={ref}
                type={visible ? "text" : "password"}
                className={cn("pr-10", className)}
                disabled={disabled}
                data-testid={testId}
                {...props}
            />
            <button
                type="button"
                tabIndex={-1}
                onClick={() => setVisible((v) => !v)}
                disabled={disabled}
                aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={visible}
                data-testid={testId ? `${testId}-toggle` : "password-toggle"}
                className={cn(
                    "absolute inset-y-0 right-0 flex items-center justify-center w-10",
                    "text-muted-foreground hover:text-foreground transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md",
                    disabled && "opacity-50 cursor-not-allowed hover:text-muted-foreground",
                )}
            >
                {visible ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                )}
            </button>
        </div>
    );
});

export default PasswordInput;
