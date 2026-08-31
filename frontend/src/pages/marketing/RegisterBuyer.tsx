import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Ticket, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PasswordInput from "@/components/ui/password-input";
import PhoneInput from "@/components/ui/phone-input";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { defaultPathForRole, pathFromLocationState, safeInternalPath } from "@/lib/authRedirect";

export default function RegisterBuyer() {
    const { registerBuyer } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        confirm: "",
        phone: "",
    });
    const [submitting, setSubmitting] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
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
        setSubmitting(true);
        try {
            const data = await registerBuyer({
                name: form.name.trim(),
                email: form.email.trim().toLowerCase(),
                password: form.password,
                phone: form.phone || undefined,
            });
            toast.success("Cuenta creada. Ya podés comprar entradas.");
            const fromState = pathFromLocationState(location.state?.from);
            const nextParam = safeInternalPath(
                new URLSearchParams(location.search).get("next"),
            );
            navigate(
                fromState || nextParam || defaultPathForRole(data.user?.role),
                { replace: true },
            );
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const loginTo = `/login${location.search || ""}`;

    return (
        <div data-testid="register-buyer-page" className="mx-auto max-w-md px-5 sm:px-8 py-16">
            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-primary text-primary-foreground mb-2">
                        <Ticket className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-2xl">Creá tu cuenta</CardTitle>
                    <CardDescription>
                        Registrarte es gratis. Vas a poder comprar entradas y verlas siempre
                        que quieras.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="buyer-reg-name">Nombre completo</Label>
                            <Input
                                id="buyer-reg-name"
                                data-testid="buyer-reg-name"
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                required
                                autoComplete="name"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="buyer-reg-email">Email</Label>
                            <Input
                                id="buyer-reg-email"
                                data-testid="buyer-reg-email"
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                                required
                                autoComplete="email"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="buyer-reg-phone">Teléfono (opcional)</Label>
                            <PhoneInput
                                id="buyer-reg-phone"
                                data-testid="buyer-reg-phone"
                                value={form.phone}
                                onChange={(v) => setForm((f) => ({ ...f, phone: v || "" }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="buyer-reg-password">Contraseña</Label>
                            <PasswordInput
                                id="buyer-reg-password"
                                data-testid="buyer-reg-password"
                                value={form.password}
                                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                                required
                                autoComplete="new-password"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="buyer-reg-confirm">Confirmar contraseña</Label>
                            <PasswordInput
                                id="buyer-reg-confirm"
                                data-testid="buyer-reg-confirm"
                                value={form.confirm}
                                onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                                required
                                autoComplete="new-password"
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={submitting}
                            data-testid="buyer-reg-submit"
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Creando cuenta…
                                </>
                            ) : (
                                "Crear cuenta"
                            )}
                        </Button>
                        <p className="text-sm text-muted-foreground text-center">
                            ¿Ya tenés cuenta?{" "}
                            <Link
                                to={loginTo}
                                state={location.state}
                                className="text-primary hover:underline"
                                data-testid="buyer-reg-to-login"
                            >
                                Iniciá sesión
                            </Link>
                        </p>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
