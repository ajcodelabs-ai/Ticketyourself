import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import PlansShowcase from "@/components/PlansShowcase";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { PUBLIC_DOMAIN } from "@/lib/config";
import { ChevronDown, Loader2 } from "lucide-react";

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
    const [showPlans, setShowPlans] = useState(false);
    const [slugCheck, setSlugCheck] = useState({
        available: null,
        suggestion: null,
        checking: false,
    });

    const autoSlug = useMemo(() => normalizeSlug(form.company_name), [form.company_name]);

    useEffect(() => {
        if (!slugEdited) {
            setForm((f) => ({ ...f, slug: autoSlug }));
        }
    }, [autoSlug, slugEdited]);

    // Live slug availability check (debounced).
    // - If the user didn't edit the slug manually and the base is taken,
    //   transparently adopt the backend-suggested unique suffix.
    // - If the user edited it manually, we leave their choice as-is and surface
    //   the conflict so they can correct it.
    // Important: clear the check result immediately while the new value is
    // pending verification so the UI never shows a stale "✓ disponible" for
    // a slug the user just changed.
    useEffect(() => {
        if (!form.slug) {
            setSlugCheck({ available: null, suggestion: null, checking: false });
            return;
        }
        setSlugCheck((prev) => ({ ...prev, available: null, checking: true }));
        const t = setTimeout(async () => {
            try {
                const { data } = await api.post("/auth/check-slug", { slug: form.slug });
                if (!data.available && data.suggestion && !slugEdited) {
                    // Auto-adopt suggestion when the user hasn't touched the field.
                    setForm((f) => ({ ...f, slug: data.suggestion }));
                    setSlugCheck({ available: true, suggestion: null, checking: false });
                } else {
                    setSlugCheck({
                        available: data.available,
                        suggestion: data.suggestion,
                        checking: false,
                    });
                }
            } catch {
                setSlugCheck({ available: null, suggestion: null, checking: false });
            }
        }, 300);
        return () => clearTimeout(t);
    }, [form.slug, slugEdited]);

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
                                <Label htmlFor="company-input">
                                    {form.org_type === "company"
                                        ? "Nombre comercial"
                                        : "Nombre completo"}
                                </Label>
                                <Input
                                    id="company-input"
                                    data-testid="register-company-input"
                                    value={form.company_name}
                                    onChange={update("company_name")}
                                    placeholder={
                                        form.org_type === "company"
                                            ? "Ej: Eventos Quito S.A."
                                            : "Ej: Juan Pérez García"
                                    }
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
                                    placeholder={
                                        form.org_type === "company"
                                            ? "13 dígitos"
                                            : "10 dígitos"
                                    }
                                    inputMode="numeric"
                                    pattern={
                                        form.org_type === "company"
                                            ? "\\d{13}"
                                            : "\\d{10}"
                                    }
                                    maxLength={form.org_type === "company" ? 13 : 10}
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    {form.org_type === "company"
                                        ? "RUC de Ecuador (13 dígitos)."
                                        : "Cédula de Ecuador (10 dígitos)."}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="slug-input">URL de tu microsite</Label>
                            <div className="flex flex-wrap gap-1 items-center">
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
                                    aria-invalid={slugCheck.available === false}
                                    className={`flex-1 min-w-[200px] ${
                                        slugCheck.available === false
                                            ? "border-red-500 focus-visible:ring-red-500"
                                            : ""
                                    }`}
                                />
                                <span className="text-sm text-muted-foreground whitespace-nowrap">
                                    .{PUBLIC_DOMAIN}
                                </span>
                            </div>
                            {form.slug && slugCheck.available && (
                                <div
                                    className="text-sm text-foreground/80 flex items-center gap-1 mt-1"
                                    data-testid="register-slug-preview"
                                >
                                    <span className="text-muted-foreground">
                                        Tu URL será:
                                    </span>
                                    <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-primary">
                                        {form.slug}.{PUBLIC_DOMAIN}
                                    </code>
                                </div>
                            )}
                            <p
                                className="text-xs"
                                data-testid="register-slug-feedback"
                            >
                                {!form.slug && (
                                    <span className="text-muted-foreground">
                                        Se autocompleta desde el nombre comercial.
                                    </span>
                                )}
                                {form.slug && slugCheck.checking && (
                                    <span
                                        className="text-muted-foreground"
                                        data-testid="register-slug-checking"
                                    >
                                        Verificando disponibilidad…
                                    </span>
                                )}
                                {form.slug && !slugCheck.checking && slugCheck.available === true && (
                                    <span
                                        className="text-emerald-600"
                                        data-testid="register-slug-available"
                                    >
                                        ✓ disponible
                                    </span>
                                )}
                                {form.slug && !slugCheck.checking && slugCheck.available === false && (
                                    <span
                                        className="text-red-600"
                                        data-testid="register-slug-taken"
                                    >
                                        ✗ Este slug ya está en uso.
                                        {slugCheck.suggestion && (
                                            <>
                                                {" "}Probá{" "}
                                                <button
                                                    type="button"
                                                    className="underline font-medium"
                                                    data-testid="register-slug-suggestion-btn"
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
                                                .
                                            </>
                                        )}
                                    </span>
                                )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Una vez creada la cuenta, el slug no se puede cambiar.
                            </p>
                        </div>

                        <div
                            className="rounded-xl border border-border/70 bg-secondary/30"
                            data-testid="register-plans-section"
                        >
                            <button
                                type="button"
                                onClick={() => setShowPlans((v) => !v)}
                                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-secondary/60 rounded-xl transition-colors"
                                data-testid="register-plans-toggle"
                                aria-expanded={showPlans}
                            >
                                <span>
                                    {showPlans ? "Ocultar planes" : "Ver planes disponibles"}
                                </span>
                                <ChevronDown
                                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                                        showPlans ? "rotate-180" : ""
                                    }`}
                                />
                            </button>
                            {showPlans && (
                                <div className="px-4 pb-4 pt-1 space-y-3" data-testid="register-plans-panel">
                                    <p className="text-xs text-muted-foreground">
                                        Vas a elegir tu plan después del registro, en el paso de pago.
                                    </p>
                                    <PlansShowcase compact columns={2} />
                                </div>
                            )}
                        </div>

                        <Button
                            type="submit"
                            disabled={
                                submitting ||
                                slugCheck.checking ||
                                !form.slug ||
                                slugCheck.available === false
                            }
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
