import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { Loader2 } from "lucide-react";

function normalizeSlug(value) {
    return (value || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .replace(/-{2,}/g, "-")
        .slice(0, 60);
}

export default function Register() {
    const { register } = useAuth();
    const navigate = useNavigate();

    const [form, setForm] = useState({
        email: "",
        password: "",
        confirmPassword: "",
        company_name: "",
        legal_id: "",
        org_type: "company",
        phone: "",
        country: "Ecuador",
        slug: "",
    });
    const [slugEdited, setSlugEdited] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [slugCheck, setSlugCheck] = useState({ available: null, suggestion: null });

    const autoSlug = useMemo(() => normalizeSlug(form.company_name), [form.company_name]);

    useEffect(() => {
        if (!slugEdited) {
            setForm((f) => ({ ...f, slug: autoSlug }));
        }
    }, [autoSlug, slugEdited]);

    // Live slug availability check (debounced).
    useEffect(() => {
        if (!form.slug) {
            setSlugCheck({ available: null, suggestion: null });
            return;
        }
        const t = setTimeout(async () => {
            try {
                const { data } = await api.post("/auth/check-slug", { slug: form.slug });
                setSlugCheck({ available: data.available, suggestion: data.suggestion });
            } catch {
                setSlugCheck({ available: null, suggestion: null });
            }
        }, 350);
        return () => clearTimeout(t);
    }, [form.slug]);

    const update = (key) => (e) => {
        const val = e?.target?.value ?? e;
        setForm((f) => ({ ...f, [key]: val }));
    };

    const submit = async (e) => {
        e.preventDefault();
        if (form.password !== form.confirmPassword) {
            toast.error("Las contraseñas no coinciden");
            return;
        }
        if (form.password.length < 8) {
            toast.error("La contraseña debe tener al menos 8 caracteres");
            return;
        }
        if (!form.slug || !slugCheck.available) {
            toast.error("El slug elegido no está disponible");
            return;
        }
        setSubmitting(true);
        try {
            await register({
                email: form.email.trim().toLowerCase(),
                password: form.password,
                company_name: form.company_name.trim(),
                legal_id: form.legal_id.trim(),
                org_type: form.org_type,
                phone: form.phone.trim(),
                country: form.country.trim(),
                slug: form.slug,
            });
            toast.success("Cuenta creada — ahora iniciá sesión");
            navigate("/login", { replace: true });
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div data-testid="register-page" className="mx-auto max-w-2xl px-5 sm:px-8 py-12">
            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <CardTitle className="text-2xl">Crear cuenta de organizador</CardTitle>
                    <CardDescription>
                        Te pediremos algunos datos básicos. Después subís documentos y elegís un plan.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={submit} className="space-y-5">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="email-input">Email</Label>
                                <Input
                                    id="email-input"
                                    data-testid="register-email-input"
                                    type="email"
                                    value={form.email}
                                    onChange={update("email")}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone-input">Teléfono</Label>
                                <Input
                                    id="phone-input"
                                    data-testid="register-phone-input"
                                    value={form.phone}
                                    onChange={update("phone")}
                                    placeholder="+593..."
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="password-input">Contraseña</Label>
                                <Input
                                    id="password-input"
                                    data-testid="register-password-input"
                                    type="password"
                                    value={form.password}
                                    onChange={update("password")}
                                    minLength={8}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-input">Confirmar contraseña</Label>
                                <Input
                                    id="confirm-input"
                                    data-testid="register-confirm-input"
                                    type="password"
                                    value={form.confirmPassword}
                                    onChange={update("confirmPassword")}
                                    minLength={8}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Tipo</Label>
                            <RadioGroup
                                value={form.org_type}
                                onValueChange={update("org_type")}
                                className="flex gap-6"
                                data-testid="register-orgtype"
                            >
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="individual" id="r-individual" />
                                    <Label htmlFor="r-individual">Individual</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="company" id="r-company" />
                                    <Label htmlFor="r-company">Empresa</Label>
                                </div>
                            </RadioGroup>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="company-input">Nombre comercial</Label>
                                <Input
                                    id="company-input"
                                    data-testid="register-company-input"
                                    value={form.company_name}
                                    onChange={update("company_name")}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="legal-input">
                                    {form.org_type === "company" ? "RUC" : "Cédula"}
                                </Label>
                                <Input
                                    id="legal-input"
                                    data-testid="register-legal-input"
                                    value={form.legal_id}
                                    onChange={update("legal_id")}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="slug-input">Slug (URL de tu microsite)</Label>
                            <div className="flex gap-2 items-center">
                                <span className="text-sm text-muted-foreground hidden sm:inline">
                                    ticketyourself.com/
                                </span>
                                <Input
                                    id="slug-input"
                                    data-testid="register-slug-input"
                                    value={form.slug}
                                    onChange={(e) => {
                                        setSlugEdited(true);
                                        setForm((f) => ({
                                            ...f,
                                            slug: normalizeSlug(e.target.value),
                                        }));
                                    }}
                                    placeholder="ej. eventos-quito"
                                />
                            </div>
                            <p
                                className="text-xs"
                                data-testid="register-slug-feedback"
                            >
                                {!form.slug && (
                                    <span className="text-muted-foreground">
                                        Se autocompleta desde el nombre comercial.
                                    </span>
                                )}
                                {form.slug && slugCheck.available === true && (
                                    <span className="text-emerald-600">
                                        ✓ disponible
                                    </span>
                                )}
                                {form.slug && slugCheck.available === false && (
                                    <span className="text-amber-700">
                                        Ya está tomado. Sugerencia:{" "}
                                        <button
                                            type="button"
                                            className="underline"
                                            onClick={() => {
                                                setSlugEdited(true);
                                                setForm((f) => ({
                                                    ...f,
                                                    slug: slugCheck.suggestion,
                                                }));
                                            }}
                                        >
                                            {slugCheck.suggestion}
                                        </button>
                                    </span>
                                )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Una vez creada la cuenta, el slug no se puede cambiar.
                            </p>
                        </div>

                        <Button
                            type="submit"
                            disabled={submitting}
                            data-testid="register-submit-btn"
                            size="lg"
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
                            <Link to="/login" className="text-primary hover:underline">
                                Iniciar sesión
                            </Link>
                        </p>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
