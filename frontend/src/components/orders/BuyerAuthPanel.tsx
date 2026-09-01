/**
 * Compact login / register for the purchase modal so the buyer doesn't leave checkout.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PasswordInput from "@/components/ui/password-input";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantSlug } from "@/contexts/TenantContext";
import { formatApiError } from "@/lib/api";
import SocialAuthButtons from "@/components/auth/SocialAuthButtons";

export default function BuyerAuthPanel({ onAuthenticated = undefined }) {
    const { login, registerBuyer } = useAuth();
    const tenantSlug = useTenantSlug();
    const [mode, setMode] = useState("login");
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        confirm: "",
    });

    const submit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            if (!tenantSlug) {
                toast.error("Abrí la página del organizador para crear tu cuenta.");
                return;
            }
            if (mode === "register") {
                if (form.name.trim().length < 2) {
                    toast.error("Ingresá tu nombre.");
                    return;
                }
                if (form.password.length < 8) {
                    toast.error("La contraseña debe tener al menos 8 caracteres.");
                    return;
                }
                if (form.password !== form.confirm) {
                    toast.error("Las contraseñas no coinciden.");
                    return;
                }
                await registerBuyer({
                    name: form.name.trim(),
                    email: form.email.trim().toLowerCase(),
                    password: form.password,
                    tenant_slug: tenantSlug,
                });
                toast.success("Cuenta creada");
            } else {
                await login(form.email.trim().toLowerCase(), form.password, (role) => role !== "super_admin", {
                    tenantSlug,
                });
                toast.success("Bienvenido");
            }
            onAuthenticated?.();
        } catch (err) {
            if (err?.roleRejected) {
                toast.error("Los administradores no pueden comprar entradas con esta cuenta.");
            } else {
                toast.error(formatApiError(err?.response?.data?.detail) || err.message);
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-4" data-testid="buyer-auth-panel">
            <div className="rounded-xl border bg-secondary/40 p-3 text-sm">
                Para comprar entradas en esta página necesitás una cuenta. Es gratis
                y te permite ver tus tickets acá — en otra productora te registrás aparte.
            </div>
            <div className="flex rounded-lg border p-0.5 bg-muted/40">
                <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 text-sm font-medium ${mode === "login" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                    onClick={() => setMode("login")}
                    data-testid="buyer-auth-tab-login"
                >
                    Ya tengo cuenta
                </button>
                <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 text-sm font-medium ${mode === "register" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                    onClick={() => setMode("register")}
                    data-testid="buyer-auth-tab-register"
                >
                    Crear cuenta
                </button>
            </div>
            <SocialAuthButtons onAuthenticated={onAuthenticated} />
            <form onSubmit={submit} className="space-y-3">
                {mode === "register" && (
                    <div className="space-y-1.5">
                        <Label htmlFor="auth-panel-name">Nombre completo</Label>
                        <Input
                            id="auth-panel-name"
                            data-testid="auth-panel-name"
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            required
                            autoComplete="name"
                        />
                    </div>
                )}
                <div className="space-y-1.5">
                    <Label htmlFor="auth-panel-email">Email</Label>
                    <Input
                        id="auth-panel-email"
                        data-testid="auth-panel-email"
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        required
                        autoComplete="email"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="auth-panel-password">Contraseña</Label>
                    <PasswordInput
                        id="auth-panel-password"
                        data-testid="auth-panel-password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        required
                        autoComplete={mode === "register" ? "new-password" : "current-password"}
                    />
                </div>
                {mode === "register" && (
                    <div className="space-y-1.5">
                        <Label htmlFor="auth-panel-confirm">Confirmar contraseña</Label>
                        <PasswordInput
                            id="auth-panel-confirm"
                            data-testid="auth-panel-confirm"
                            value={form.confirm}
                            onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                            required
                            autoComplete="new-password"
                        />
                    </div>
                )}
                <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                    data-testid="auth-panel-submit"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {mode === "register" ? "Creando…" : "Entrando…"}
                        </>
                    ) : mode === "register" ? (
                        "Crear cuenta y continuar"
                    ) : (
                        "Iniciar sesión y continuar"
                    )}
                </Button>
            </form>
        </div>
    );
}
