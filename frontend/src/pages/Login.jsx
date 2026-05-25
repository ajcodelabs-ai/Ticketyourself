import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PasswordInput from "@/components/ui/password-input";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { Loader2, LogIn } from "lucide-react";

export default function Login() {
    const { login } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    const submit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const data = await login(email.trim().toLowerCase(), password);
            toast.success("Bienvenido");
            const from = location.state?.from?.pathname;
            if (data.user.role === "super_admin") {
                navigate(from || "/admin", { replace: true });
            } else {
                navigate(from || "/app/dashboard", { replace: true });
            }
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div data-testid="login-page" className="mx-auto max-w-md px-5 sm:px-8 py-16">
            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
                    <CardDescription>
                        Ingresá con tu email y contraseña.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email-input">Email</Label>
                            <Input
                                id="email-input"
                                data-testid="login-email-input"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password-input">Contraseña</Label>
                            <PasswordInput
                                id="password-input"
                                data-testid="login-password-input"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                            />
                        </div>

                        <Button
                            type="submit"
                            disabled={submitting}
                            data-testid="login-submit-btn"
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Entrando…
                                </>
                            ) : (
                                <>
                                    <LogIn className="h-4 w-4 mr-2" />
                                    Iniciar sesión
                                </>
                            )}
                        </Button>

                        <p className="text-sm text-muted-foreground text-center">
                            ¿No tenés cuenta?{" "}
                            <Link
                                to="/registro"
                                data-testid="login-to-register-link"
                                className="text-primary hover:underline"
                            >
                                Registrate como organizador
                            </Link>
                        </p>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
