import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import PasswordInput from "@/components/ui/password-input";
import PhoneInput from "@/components/ui/phone-input";
import { isValidPhoneNumber } from "react-phone-number-input";
import PlansShowcase, { PlanCard } from "@/components/PlansShowcase";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { PUBLIC_DOMAIN } from "@/lib/config";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";

const SIGNUP_PLAN_KEY = "tys_signup_plan";

const EMPTY_SOCIAL = {
    instagram: "",
    facebook: "",
    tiktok: "",
    x: "",
    website: "",
};

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
    const [countries, setCountries] = useState([]);
    const [loadingPlans, setLoadingPlans] = useState(true);
    const [form, setForm] = useState({
        email: "",
        password: "",
        confirmPassword: "",
        company_name: "",
        legal_id: "",
        org_type: "company",
        phone: "",
        country_code: "EC",
        slug: "",
        social_links: { ...EMPTY_SOCIAL },
        is_pep: false,
        pep_details: "",
        uafe_declaration: {
            funds_origin_declared: false,
            funds_origin_detail: "",
            accepts_uafe_obligations: false,
        },
        org_references: [{ name: "", phone: "", relation: "" }],
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

    const selectedCountry = useMemo(
        () => countries.find((c) => c.code === form.country_code) || null,
        [countries, form.country_code],
    );

    const requiresCompliance = Boolean(selectedCountry?.requires_compliance);
    const socialFields =
        selectedCountry?.form_schema?.social_fields || Object.keys(EMPTY_SOCIAL);
    const legalLabel =
        selectedCountry?.legal_id_label ||
        (form.org_type === "company" ? "RUC" : "Cédula");

    useEffect(() => {
        (async () => {
            try {
                const [plansResp, countriesResp] = await Promise.all([
                    api.get("/plans"),
                    api.get("/auth/registration-countries"),
                ]);
                setPlans(plansResp.data || []);
                const list = countriesResp.data || [];
                setCountries(list);
                if (list.length && !list.some((c) => c.code === "EC")) {
                    setForm((f) => ({ ...f, country_code: list[0].code }));
                }
            } catch {
                setPlans([]);
                setCountries([]);
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
        setForm((f) => ({ ...f, [key]: val ?? "" }));
    };

    const updateSocial = (key) => (e) => {
        const val = e?.target?.value ?? "";
        setForm((f) => ({
            ...f,
            social_links: { ...f.social_links, [key]: val },
        }));
    };

    const updateUafe = (key, value) => {
        setForm((f) => ({
            ...f,
            uafe_declaration: { ...f.uafe_declaration, [key]: value },
        }));
    };

    const updateReference = (index, key, value) => {
        setForm((f) => {
            const next = [...f.org_references];
            next[index] = { ...next[index], [key]: value };
            return { ...f, org_references: next };
        });
    };

    const addReference = () => {
        setForm((f) => ({
            ...f,
            org_references: [...f.org_references, { name: "", phone: "", relation: "" }],
        }));
    };

    const removeReference = (index) => {
        setForm((f) => ({
            ...f,
            org_references: f.org_references.filter((_, i) => i !== index),
        }));
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!selectedPlan) {
            toast.error("Elige un plan antes de crear tu cuenta");
            return;
        }
        if (!form.email.trim()) {
            toast.error("Ingresa tu email");
            return;
        }
        const phone = (form.phone ?? "").trim();
        if (!phone) {
            toast.error("Ingresa tu número de teléfono");
            return;
        }
        if (!isValidPhoneNumber(phone)) {
            toast.error("El número de teléfono no es válido. Revisa el código de país y los dígitos.");
            return;
        }
        if (form.password.length < 8) {
            toast.error("La contraseña debe tener al menos 8 caracteres");
            return;
        }
        if (form.password !== form.confirmPassword) {
            toast.error("Las contraseñas no coinciden");
            return;
        }
        if (!form.company_name.trim()) {
            toast.error(form.org_type === "company" ? "Ingresa el nombre comercial" : "Ingresa tu nombre completo");
            return;
        }
        if (!form.legal_id.trim()) {
            toast.error(`Ingresa tu ${legalLabel}`);
            return;
        }
        if (selectedCountry?.legal_id_pattern) {
            try {
                const re = new RegExp(selectedCountry.legal_id_pattern);
                if (!re.test(form.legal_id.trim())) {
                    toast.error(`${legalLabel} no tiene un formato válido para ${selectedCountry.name}`);
                    return;
                }
            } catch {
                /* ignore bad pattern from admin */
            }
        }
        if (!form.slug || !slugCheck.available) {
            toast.error("El slug elegido no está disponible");
            return;
        }
        if (requiresCompliance) {
            if (form.is_pep && !form.pep_details.trim()) {
                toast.error("Describe tu condición PEP");
                return;
            }
            if (!form.uafe_declaration.funds_origin_declared) {
                toast.error("Debes declarar el origen lícito de los fondos");
                return;
            }
            if (!form.uafe_declaration.funds_origin_detail.trim()) {
                toast.error("Describe el origen de los fondos");
                return;
            }
            if (!form.uafe_declaration.accepts_uafe_obligations) {
                toast.error("Debes aceptar las obligaciones UAFE");
                return;
            }
            const validRefs = form.org_references.filter((r) => r.name.trim() && r.phone.trim());
            if (validRefs.length < 1) {
                toast.error("Agrega al menos una referencia con nombre y teléfono");
                return;
            }
        }

        const social_links = Object.fromEntries(
            Object.entries(form.social_links).filter(([, v]) => (v || "").trim()),
        );

        setSubmitting(true);
        try {
            await register({
                email: form.email.trim().toLowerCase(),
                password: form.password,
                company_name: form.company_name.trim(),
                legal_id: form.legal_id.trim(),
                org_type: form.org_type,
                phone,
                country: selectedCountry?.name || form.country_code,
                country_code: form.country_code,
                slug: form.slug,
                social_links: Object.keys(social_links).length ? social_links : null,
                is_pep: requiresCompliance ? form.is_pep : false,
                pep_details: requiresCompliance && form.is_pep ? form.pep_details.trim() : null,
                uafe_declaration: requiresCompliance ? form.uafe_declaration : null,
                org_references: requiresCompliance
                    ? form.org_references.filter((r) => r.name.trim() && r.phone.trim())
                    : null,
                signup_plan_code: selectedPlan.code,
            });
            localStorage.setItem(SIGNUP_PLAN_KEY, selectedPlan.code);
            toast.success("Cuenta creada — ¡bienvenido a TYS!");
            navigate("/onboarding", { replace: true });
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
                        Elige un plan para empezar
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        No hay registro gratuito: primero eliges cómo quieres vender (evento único o
                        suscripción mensual) y después completas tus datos.
                    </p>
                </div>
                {loadingPlans ? (
                    <p className="text-center text-sm text-muted-foreground">Cargando planes…</p>
                ) : (
                    <PlansShowcase onSelect={pickPlan} ctaLabel="Continuar con este plan" columns={4} />
                )}
                <p className="text-sm text-muted-foreground text-center">
                    ¿Ya tienes cuenta?{" "}
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
                        ({formatPlanPrice(selectedPlan)}). Después del registro subes tus documentos
                        para revisión; el pago se habilita una vez que el equipo TYS apruebe tu cuenta.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pb-6">
                    <div className="mb-6 max-w-xs">
                        <PlanCard plan={selectedPlan} compact selected />
                    </div>
                    <form onSubmit={submit} className="space-y-5">
                        <div className="space-y-2">
                            <Label>País</Label>
                            <Select
                                value={form.country_code}
                                onValueChange={(code) =>
                                    setForm((f) => ({ ...f, country_code: code }))
                                }
                            >
                                <SelectTrigger data-testid="register-country-select">
                                    <SelectValue placeholder="Selecciona país" />
                                </SelectTrigger>
                                <SelectContent>
                                    {countries.map((c) => (
                                        <SelectItem key={c.code} value={c.code}>
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

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
                                    required
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
                                    <Label htmlFor="r-individual">Persona natural</Label>
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
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="legal-input">{legalLabel}</Label>
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
                                {form.slug && !slugCheck.checking && slugCheck.available === true && (
                                    <span className="text-emerald-600">✓ disponible</span>
                                )}
                                {form.slug && !slugCheck.checking && slugCheck.available === false && (
                                    <span className="text-red-600">✗ Este slug no está disponible.</span>
                                )}
                            </p>
                        </div>

                        <div className="space-y-3 border-t border-border/60 pt-4">
                            <Label className="text-base">Redes sociales</Label>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {socialFields.map((key) => (
                                    <div key={key} className="space-y-1.5">
                                        <Label htmlFor={`social-${key}`} className="capitalize text-xs">
                                            {key}
                                        </Label>
                                        <Input
                                            id={`social-${key}`}
                                            data-testid={`register-social-${key}`}
                                            value={form.social_links[key] || ""}
                                            onChange={updateSocial(key)}
                                            placeholder={`@usuario o URL`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {requiresCompliance && (
                            <div
                                className="space-y-4 border-t border-border/60 pt-4"
                                data-testid="register-compliance-block"
                            >
                                <div>
                                    <Label className="text-base">Compliance ({selectedCountry?.name})</Label>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Declaraciones requeridas para organizadores en este país.
                                    </p>
                                </div>

                                <div className="flex items-start gap-2">
                                    <Checkbox
                                        id="is-pep"
                                        data-testid="register-is-pep"
                                        checked={form.is_pep}
                                        onCheckedChange={(v) =>
                                            setForm((f) => ({ ...f, is_pep: Boolean(v) }))
                                        }
                                    />
                                    <div className="space-y-1">
                                        <Label htmlFor="is-pep" className="cursor-pointer">
                                            Soy persona políticamente expuesta (PEP)
                                        </Label>
                                        {form.is_pep && (
                                            <Textarea
                                                data-testid="register-pep-details"
                                                value={form.pep_details}
                                                onChange={update("pep_details")}
                                                placeholder="Cargo, institución y periodo"
                                                className="mt-2"
                                            />
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-3 rounded-md border border-border/70 p-3">
                                    <Label>Declaración UAFE</Label>
                                    <div className="flex items-start gap-2">
                                        <Checkbox
                                            id="funds-origin"
                                            checked={form.uafe_declaration.funds_origin_declared}
                                            onCheckedChange={(v) =>
                                                updateUafe("funds_origin_declared", Boolean(v))
                                            }
                                        />
                                        <Label htmlFor="funds-origin" className="cursor-pointer font-normal">
                                            Declaro que los fondos provienen de actividades lícitas
                                        </Label>
                                    </div>
                                    <Textarea
                                        data-testid="register-funds-detail"
                                        value={form.uafe_declaration.funds_origin_detail}
                                        onChange={(e) =>
                                            updateUafe("funds_origin_detail", e.target.value)
                                        }
                                        placeholder="Describe el origen de los fondos"
                                    />
                                    <div className="flex items-start gap-2">
                                        <Checkbox
                                            id="uafe-accept"
                                            checked={form.uafe_declaration.accepts_uafe_obligations}
                                            onCheckedChange={(v) =>
                                                updateUafe("accepts_uafe_obligations", Boolean(v))
                                            }
                                        />
                                        <Label htmlFor="uafe-accept" className="cursor-pointer font-normal">
                                            Acepto las obligaciones de prevención de lavado de activos
                                        </Label>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label>Referencias</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={addReference}
                                            disabled={form.org_references.length >= 5}
                                        >
                                            <Plus className="h-3.5 w-3.5 mr-1" />
                                            Agregar
                                        </Button>
                                    </div>
                                    {form.org_references.map((ref, idx) => (
                                        <div
                                            key={idx}
                                            className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end"
                                        >
                                            <Input
                                                placeholder="Nombre"
                                                value={ref.name}
                                                onChange={(e) =>
                                                    updateReference(idx, "name", e.target.value)
                                                }
                                                data-testid={`register-ref-name-${idx}`}
                                            />
                                            <Input
                                                placeholder="Teléfono"
                                                value={ref.phone}
                                                onChange={(e) =>
                                                    updateReference(idx, "phone", e.target.value)
                                                }
                                            />
                                            <Input
                                                placeholder="Relación"
                                                value={ref.relation}
                                                onChange={(e) =>
                                                    updateReference(idx, "relation", e.target.value)
                                                }
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                disabled={form.org_references.length <= 1}
                                                onClick={() => removeReference(idx)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

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
                            ¿Ya tienes cuenta?{" "}
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
