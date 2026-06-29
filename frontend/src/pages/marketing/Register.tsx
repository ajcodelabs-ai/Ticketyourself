import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import PasswordInput from "@/components/ui/password-input";
import PhoneInput from "@/components/ui/phone-input";
import PlansShowcase, { PlanCard } from "@/components/PlansShowcase";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { PUBLIC_DOMAIN } from "@/lib/config";
import { ArrowLeft, Loader2 } from "lucide-react";

const SIGNUP_PLAN_KEY = "tys_signup_plan";

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

function formatPlanPrice(plan) {
    const dollars = plan.price_cents / 100;
    const display = Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2);
    const period =
        plan.billing_period === "monthly"
            ? "/ mes"
            : plan.billing_period === "one_time"
              ? " · pago único"
              : "";
    return `$${display}${period}`;
}

export default function Register() {
    const { register } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const planCode = searchParams.get("plan");

    const [plans, setPlans] = useState([]);
    const [loadingPlans, setLoadingPlans] = useState(true);
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
    const [slugCheck, setSlugCheck] = useState({
        available: null,
        suggestion: null,
        checking: false,
        reason: null,
    });

    const selectedPlan = useMemo(
        () => plans.find((p) => p.code === planCode) || null,
        [plans, planCode],
    );

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get("/plans");
                setPlans(data || []);
            } catch {
                setPlans([]);
            } finally {
                setLoadingPlans(false);
            }
        })();
    }, []);

    const autoSlug = useMemo(() => normalizeSlug(form.company_name), [form.company_name]);

    useEffect(() => {
        if (!slugEdited) {
            setForm((f) => ({ ...f, slug: autoSlug }));
        }
    }, [autoSlug, slugEdited]);

    useEffect(() => {
        if (!form.slug) {
            setSlugCheck({ available: null, suggestion: null, checking: false, reason: null });
            return;
        }
        setSlugCheck((prev) => ({ ...prev, available: null, checking: true }));
        const t = setTimeout(async () => {
            try {
                const { data } = await api.post("/auth/check-slug", { slug: form.slug });
                if (!data.available && data.suggestion && data.reason === "taken" && !slugEdited) {
                    setForm((f) => ({ ...f, slug: data.suggestion }));
                    setSlugCheck({ available: true, suggestion: null, checking: false, reason: null });
                } else {
                    setSlugCheck({
                        available: data.available,
                        suggestion: data.suggestion,
                        checking: false,
                        reason: data.reason || null,
                    });
                }
            } catch {
                setSlugCheck({ available: null, suggestion: null, checking: false, reason: null });
            }
        }, 300);
        return () => clearTimeout(t);
    }, [form.slug, slugEdited]);

    const pickPlan = (plan) => {
        setSearchParams({ plan: plan.code }, { replace: true });
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const clearPlan = () => {
        setSearchParams({}, { replace: true });
    };

    const update = (key) => (e) => {
        const val = e?.target?.value ?? e;
        setForm((f) => ({ ...f, [key]: val }));
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!selectedPlan) {
            toast.error("Elegí un plan antes de crear tu cuenta");
            return;
        }
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
            localStorage.setItem(SIGNUP_PLAN_KEY, selectedPlan.code);
            toast.success("Cuenta creada — ahora iniciá sesión para subir tus documentos");
            navigate("/login", { replace: true, state: { from: { pathname: "/onboarding" } } });
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (!planCode || loadingPlans) {
        return (
            <div data-testid="register-page" className="mx-auto max-w-6xl px-5 sm:px-8 py-12 space-y-8">
                <div className="text-center space-y-2 max-w-2xl mx-auto">
                    <h1 className="text-3xl font-semibold tracking-tight">
                        Elegí un plan para empezar
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        No hay registro gratuito: primero elegís cómo querés vender (evento único o
                        suscripción mensual) y después completás tus datos.
                    </p>
                </div>
                {loadingPlans ? (
                    <p className="text-center text-sm text-muted-foreground">Cargando planes…</p>
                ) : (
                    <PlansShowcase onSelect={pickPlan} ctaLabel="Continuar con este plan" columns={4} />
                )}
                <p className="text-sm text-muted-foreground text-center">
                    ¿Ya tenés cuenta?{" "}
                    <Link to="/login" className="text-primary hover:underline">
                        Iniciar sesión
                    </Link>
                </p>
            </div>
        );
    }

    if (!selectedPlan) {
        return (
            <div data-testid="register-page" className="mx-auto max-w-2xl px-5 sm:px-8 py-12 space-y-4">
                <p className="text-muted-foreground text-sm">
                    El plan &quot;{planCode}&quot; no existe o ya no está disponible.
                </p>
                <Button variant="outline" onClick={clearPlan}>
                    Ver todos los planes
                </Button>
            </div>
        );
    }

    return (
        <div data-testid="register-page" className="mx-auto max-w-2xl px-5 sm:px-8 py-12">
            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-fit -ml-2 mb-2 text-muted-foreground"
                        onClick={clearPlan}
                    >
                        <ArrowLeft className="h-4 w-4 mr-1" />
                        Cambiar plan
                    </Button>
                    <CardTitle className="text-2xl">Datos de tu organización</CardTitle>
                    <CardDescription>
                        Plan elegido: <strong className="text-foreground">{selectedPlan.name}</strong>{" "}
                        ({formatPlanPrice(selectedPlan)}). Después del registro subís tus documentos
                        para revisión; el pago se habilita una vez que el equipo TYS apruebe tu cuenta.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pb-6">
                    <div className="mb-6 max-w-xs">
                        <PlanCard plan={selectedPlan} compact selected />
                    </div>
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
                                <PhoneInput
                                    id="phone-input"
                                    data-testid="register-phone-input"
                                    value={form.phone}
                                    onChange={update("phone")}
                                    placeholder="99 123 4567"
                                />
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="password-input">Contraseña</Label>
                                <PasswordInput
                                    id="password-input"
                                    data-testid="register-password-input"
                                    value={form.password}
                                    onChange={update("password")}
                                    minLength={8}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm-input">Confirmar contraseña</Label>
                                <PasswordInput
                                    id="confirm-input"
                                    data-testid="register-confirm-input"
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
                                        form.org_type === "company" ? "13 dígitos" : "10 dígitos"
                                    }
                                    inputMode="numeric"
                                    pattern={
                                        form.org_type === "company" ? "\\d{13}" : "\\d{10}"
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
                                    <span className="text-muted-foreground">Tu URL será:</span>
                                    <code className="font-mono bg-secondary px-1.5 py-0.5 rounded text-primary">
                                        {form.slug}.{PUBLIC_DOMAIN}
                                    </code>
                                </div>
                            )}
                            <p className="text-xs" data-testid="register-slug-feedback">
                                {!form.slug && (
                                    <span className="text-muted-foreground">
                                        Se autocompleta desde el nombre comercial.
                                    </span>
                                )}
                                {form.slug && slugCheck.checking && (
                                    <span className="text-muted-foreground">Verificando…</span>
                                )}
                                {form.slug && !slugCheck.checking && slugCheck.available === true && (
                                    <span className="text-emerald-600">✓ disponible</span>
                                )}
                                {form.slug && !slugCheck.checking && slugCheck.available === false && (
                                    <span className="text-red-600">✗ Este slug no está disponible.</span>
                                )}
                            </p>
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
                                "Crear cuenta y continuar"
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

export { SIGNUP_PLAN_KEY };
