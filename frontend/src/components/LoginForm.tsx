import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PasswordInput from "@/components/ui/password-input";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { Loader2 } from "lucide-react";

// Shared by the organizer (/login) and super-admin (/admin/login) entry
// points — same form shape, different role guard/branding/destination.
// Keeping this in one place means the redirect-back-to-original-page
// behavior (`location.state.from`) and the role-rejection handling can't
// silently diverge between the two flows.
export default function LoginForm({
    testIdPrefix,
    allowRole,
    rejectMessage,
    defaultRedirect,
    icon,
    title,
    description,
    submitIcon,
    submitLabel,
    submitClassName,
    footer,
}) {
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
            const data = await login(email.trim().toLowerCase(), password, allowRole);
            toast.success("Bienvenido");
            const from = location.state?.from?.pathname;
            navigate(from || defaultRedirect, { replace: true });
        } catch (err) {
            if (err?.roleRejected) {
                toast.error(rejectMessage);
            } else {
                toast.error(formatApiError(err?.response?.data?.detail) || err.message);
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div data-testid={`${testIdPrefix}-page`} className="mx-auto max-w-md px-5 sm:px-8 py-16">
            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    {icon}
                    <CardTitle className="text-2xl">{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor={`${testIdPrefix}-email-input`}>Email</Label>
                            <Input
                                id={`${testIdPrefix}-email-input`}
                                data-testid={`${testIdPrefix}-email-input`}
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`${testIdPrefix}-password-input`}>Contraseña</Label>
                            <PasswordInput
                                id={`${testIdPrefix}-password-input`}
                                data-testid={`${testIdPrefix}-password-input`}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                            />
                        </div>

                        <Button
                            type="submit"
                            disabled={submitting}
                            data-testid={`${testIdPrefix}-submit-btn`}
                            className={submitClassName}
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Entrando…
                                </>
                            ) : (
                                <>
                                    {submitIcon}
                                    {submitLabel}
                                </>
                            )}
                        </Button>

                        {footer}
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
