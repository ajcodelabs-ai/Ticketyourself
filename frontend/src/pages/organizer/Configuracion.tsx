/**
 * /app/configuracion — tabs: plan, factura electrónica, perfil, seguridad.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import PasswordInput from "@/components/ui/password-input";
import PhoneInput from "@/components/ui/phone-input";
import {
    Loader2,
    CreditCard,
    User,
    Lock,
    ExternalLink,
    Sparkles,
    FileText,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { formatCents } from "@/lib/orders";
import { IVA_PERCENT_OPTIONS } from "@/lib/einvoice";

export default function Configuracion() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = searchParams.get("tab") || "plan";
    const setTab = (next: string) => {
        const params = new URLSearchParams(searchParams);
        params.set("tab", next);
        setSearchParams(params, { replace: true });
    };

    return (
        <div className="space-y-6" data-testid="configuracion-page">
            <header>
                <div className="text-sm text-muted-foreground">Configuración</div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                    Ajustes de tu cuenta
                </h1>
            </header>
            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="flex flex-wrap h-auto gap-1">
                    <TabsTrigger value="plan" data-testid="cfg-tab-plan">
                        <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                        Plan y facturación
                    </TabsTrigger>
                    <TabsTrigger value="einvoice" data-testid="cfg-tab-einvoice">
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        Factura electrónica
                    </TabsTrigger>
                    
                    <TabsTrigger value="profile" data-testid="cfg-tab-profile">
                        <User className="h-3.5 w-3.5 mr-1.5" />
                        Perfil
                    </TabsTrigger>
                    
                    <TabsTrigger value="security" data-testid="cfg-tab-security">
                        <Lock className="h-3.5 w-3.5 mr-1.5" />
                        Seguridad
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="profile" className="mt-4">
                    <ProfileTab />
                </TabsContent>
                <TabsContent value="plan" className="mt-4">
                    <PlanTab />
                </TabsContent>
                <TabsContent value="einvoice" className="mt-4">
                    <EinvoiceTab />
                </TabsContent>
                <TabsContent value="security" className="mt-4">
                    <SecurityTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function ProfileTab() {
    const { organizer, refreshOrganizer } = useAuth();
    const [form, setForm] = useState({
        company_name: organizer?.company_name || "",
        phone: organizer?.phone || "",
        country: organizer?.country || "Ecuador",
    });
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            await api.patch("/organizers/me", form);
            await refreshOrganizer?.();
            toast.success("Perfil actualizado");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setSaving(false);
        }
    };

    if (!organizer) return null;
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Datos del organizador</CardTitle>
                <CardDescription>
                    El slug (<code>{organizer.slug}</code>) y el RUC / cédula no se pueden
                    editar después de la creación.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Field label="Nombre comercial">
                    <Input
                        value={form.company_name}
                        onChange={(e) =>
                            setForm((f) => ({ ...f, company_name: e.target.value }))
                        }
                        data-testid="cfg-company"
                    />
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Teléfono">
                        <PhoneInput
                            value={form.phone}
                            onChange={(v) => setForm((f) => ({ ...f, phone: v || "" }))}
                            data-testid="cfg-phone"
                        />
                    </Field>
                    <Field label="País">
                        <Input
                            value={form.country}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, country: e.target.value }))
                            }
                            data-testid="cfg-country"
                        />
                    </Field>
                </div>
                <Field label="Email de contacto">
                    <Input value={organizer.email} disabled />
                </Field>
                <Field label="RUC / cédula">
                    <Input value={organizer.legal_id} disabled />
                </Field>
                <div className="flex justify-end">
                    <Button onClick={save} disabled={saving} data-testid="cfg-save-profile">
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        Guardar cambios
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function PlanTab() {
    const [searchParams] = useSearchParams();
    const highlightCode = searchParams.get("upgrade");
    const [data, setData] = useState(null);
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [openingPortal, setOpeningPortal] = useState(false);
    const [payingCode, setPayingCode] = useState(null);

    useEffect(() => {
        Promise.all([api.get("/dashboard/me"), api.get("/plans")])
            .then(([dash, catalog]) => {
                setData(dash.data);
                setPlans(catalog.data || []);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const openPortal = async () => {
        setOpeningPortal(true);
        try {
            const { data: portal } = await api.post("/billing/portal", {
                return_url: window.location.href,
            });
            window.location.href = portal.portal_url;
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
            setOpeningPortal(false);
        }
    };

    const startUpgrade = async (plan_code: string) => {
        setPayingCode(plan_code);
        try {
            const { data: checkout } = await api.post("/billing/checkout-session", {
                plan_code,
                origin_url: window.location.origin,
                payment_method: "stripe",
            });
            if (checkout?.checkout_url) {
                window.location.href = checkout.checkout_url;
                return;
            }
            toast.message(checkout?.message || "Registramos tu solicitud de cambio de plan.");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setPayingCode(null);
        }
    };

    if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
    if (!data) return null;
    const { organizer, plan } = data;
    const currentCode = organizer.plan_code || plan?.code;
    const upgrades = plans.filter((p) => p.code !== currentCode);

    return (
        <div className="space-y-4">
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Plan actual</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                        <div className="text-xs uppercase text-muted-foreground">Plan</div>
                        <div className="text-xl font-semibold mt-1">
                            {plan?.name || "Sin plan"}
                        </div>
                        {plan && (
                            <p className="text-sm text-muted-foreground">
                                {formatCents(plan.price_cents)}
                                {plan.billing_period === "monthly" && " / mes"}
                            </p>
                        )}
                    </div>
                    <div>
                        <div className="text-xs uppercase text-muted-foreground">
                            Estado suscripción
                        </div>
                        <Badge className="mt-1">{organizer.subscription_status}</Badge>
                        {organizer.current_period_end && (
                            <p className="text-xs text-muted-foreground mt-1">
                                Renueva el{" "}
                                {new Date(organizer.current_period_end).toLocaleDateString(
                                    "es-EC",
                                )}
                            </p>
                        )}
                    </div>
                </div>
                {plan?.features?.length > 0 && (
                    <div>
                        <div className="text-xs uppercase text-muted-foreground mb-2">
                            Incluye
                        </div>
                        <ul className="text-sm space-y-1">
                            {plan.features.map((f) => (
                                <li key={f}>· {f}</li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                    <Button
                        onClick={openPortal}
                        disabled={openingPortal}
                        data-testid="cfg-portal-btn"
                    >
                        {openingPortal ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                            <ExternalLink className="h-4 w-4 mr-1.5" />
                        )}
                        Ir al portal de Stripe
                    </Button>
                </div>
            </CardContent>
        </Card>

        {upgrades.length > 0 && (
            <Card data-testid="cfg-upgrade-plans">
                <CardHeader>
                    <CardTitle className="text-lg">Mejorar plan</CardTitle>
                    <CardDescription>
                        Elegí un plan con las funciones que te faltan. El cobro se hace por Stripe.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-3">
                    {upgrades.map((p) => {
                        const highlighted = highlightCode === p.code;
                        return (
                            <div
                                key={p.code}
                                data-testid={`cfg-upgrade-${p.code}`}
                                className={`rounded-xl border p-4 space-y-3 ${
                                    highlighted
                                        ? "border-amber-400 bg-amber-50/60 ring-1 ring-amber-200"
                                        : "bg-card"
                                }`}
                            >
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold">{p.name}</h3>
                                        {highlighted && (
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] border-amber-300 text-amber-950 bg-white"
                                            >
                                                Recomendado para desbloquear
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {formatCents(p.price_cents)}
                                        {p.billing_period === "monthly" && " / mes"}
                                        {p.billing_period === "one_time" && " pago único"}
                                    </p>
                                    {p.description && (
                                        <p className="text-xs text-muted-foreground mt-1 leading-snug">
                                            {p.description}
                                        </p>
                                    )}
                                </div>
                                <Button
                                    size="sm"
                                    onClick={() => startUpgrade(p.code)}
                                    disabled={payingCode === p.code}
                                    data-testid={`cfg-upgrade-cta-${p.code}`}
                                >
                                    {payingCode === p.code ? (
                                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                    ) : (
                                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                                    )}
                                    Mejorar a {p.name}
                                </Button>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>
        )}
        </div>
    );
}

function SecurityTab() {
    const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Cambiar contraseña</CardTitle>
                <CardDescription>
                    Próximamente en producción. Por ahora podés solicitar el cambio
                    contactando a soporte.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 opacity-60">
                <Field label="Contraseña actual">
                    <PasswordInput disabled />
                </Field>
                <Field label="Nueva contraseña">
                    <PasswordInput disabled />
                </Field>
                <Field label="Confirmar nueva contraseña">
                    <PasswordInput disabled />
                </Field>
                <Button disabled data-testid="cfg-pwd-save">
                    Próximamente
                </Button>
            </CardContent>
        </Card>
    );
}

function EinvoiceTab() {
    const [cfg, setCfg] = useState(null);
    const [form, setForm] = useState({
        enabled: true,
        ruc: "",
        razon_social: "",
        nombre_comercial: "",
        direccion: "",
        establecimiento: "001",
        punto_emision: "001",
        obligado_contabilidad: true,
        contribuyente_especial: "",
        iva_percent: 15,
        api_key: "",
        cert_password: "",
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const { data } = await api.get("/organizers/me/einvoice-config");
            setCfg(data);
            setForm((f) => ({
                ...f,
                enabled: data.enabled !== false,
                ruc: data.ruc || data.emisor?.ruc || "",
                razon_social: data.razon_social || data.emisor?.razon_social || "",
                nombre_comercial: data.nombre_comercial || data.emisor?.nombre_comercial || "",
                direccion: data.direccion || data.emisor?.direccion || "",
                establecimiento: data.establecimiento || data.emisor?.establecimiento?.codigo || "001",
                punto_emision: data.punto_emision || data.emisor?.establecimiento?.punto_emision || "001",
                obligado_contabilidad: data.obligado_contabilidad ?? data.emisor?.obligado_contabilidad ?? true,
                contribuyente_especial: data.contribuyente_especial || "",
                iva_percent: data.iva_percent ?? 15,
            }));
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            const body = { ...form };
            if (!body.api_key) delete body.api_key;
            if (!body.cert_password) delete body.cert_password;
            const { data } = await api.put("/organizers/me/einvoice-config", body);
            setCfg(data);
            setForm((f) => ({ ...f, api_key: "", cert_password: "" }));
            toast.success("Datos de facturación electrónica guardados");
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <Card data-testid="einvoice-config-card">
            <CardHeader>
                <CardTitle className="text-lg">Facturación electrónica (SRI / Dátil)</CardTitle>
                <CardDescription>
                    El RUC solo no alcanza: Dátil exige un establecimiento y un
                    punto de emisión ya creados en tu cuenta. Copialos de{" "}
                    <a
                        href="https://app.datil.co"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                    >
                        app.datil.co
                    </a>{" "}
                    → Mi negocio → Establecimientos. El IVA de cada evento se
                    elige al crearlo; acá queda el valor por defecto.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant={cfg?.ready ? "default" : "secondary"}>
                        {cfg?.ready ? "Listo para emitir" : "Faltan credenciales Dátil"}
                    </Badge>
                    {cfg?.mock && (
                        <Badge variant="outline" className="border-amber-400 text-amber-800">
                            Mock local (sin Dátil)
                        </Badge>
                    )}
                    <Badge variant="outline">Ambiente {cfg?.ambiente === 2 ? "producción (2)" : "pruebas (1)"}</Badge>
                    <Badge variant="outline">IVA {cfg?.iva_percent}%</Badge>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                        <Label htmlFor="einvoice-enabled">Emitir factura al cobrar</Label>
                        <p className="text-xs text-muted-foreground">
                            Desactivá si este organizador no debe facturar todavía.
                        </p>
                    </div>
                    <Switch
                        id="einvoice-enabled"
                        checked={form.enabled}
                        onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                        data-testid="einvoice-enabled"
                    />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="RUC emisor">
                        <Input
                            value={form.ruc}
                            onChange={(e) => setForm((f) => ({ ...f, ruc: e.target.value }))}
                            data-testid="einvoice-ruc"
                        />
                    </Field>
                    <Field label="Razón social">
                        <Input
                            value={form.razon_social}
                            onChange={(e) => setForm((f) => ({ ...f, razon_social: e.target.value }))}
                        />
                    </Field>
                    <Field label="Nombre comercial">
                        <Input
                            value={form.nombre_comercial}
                            onChange={(e) => setForm((f) => ({ ...f, nombre_comercial: e.target.value }))}
                        />
                    </Field>
                    <Field label="Dirección del establecimiento">
                        <Input
                            value={form.direccion}
                            onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                        />
                    </Field>
                    <Field label="Establecimiento (3 dígitos)">
                        <Input
                            value={form.establecimiento}
                            maxLength={3}
                            onChange={(e) => setForm((f) => ({ ...f, establecimiento: e.target.value }))}
                            data-testid="einvoice-establecimiento"
                        />
                    </Field>
                    <Field label="Punto de emisión (3 dígitos)">
                        <Input
                            value={form.punto_emision}
                            maxLength={3}
                            onChange={(e) => setForm((f) => ({ ...f, punto_emision: e.target.value }))}
                            data-testid="einvoice-punto-emision"
                        />
                    </Field>
                    <p className="sm:col-span-2 text-xs text-muted-foreground -mt-1">
                        En pruebas Dátil pide 001 / 001. Esos códigos no salen solos:
                        hay que crearlos en app.datil.co con Datos de prueba
                        activo (Mi negocio → Establecimientos). Si los creaste en
                        producción, el ambiente 1 de la API no los ve.
                    </p>
                    <Field label="IVA por defecto (eventos)">
                        <Select
                            value={String(form.iva_percent ?? 15)}
                            onValueChange={(v) => setForm((f) => ({ ...f, iva_percent: Number(v) }))}
                        >
                            <SelectTrigger data-testid="einvoice-iva-percent">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {IVA_PERCENT_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={String(opt.value)}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="API Key Dátil (opcional)">
                        <PasswordInput
                            value={form.api_key}
                            onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                            placeholder={cfg?.has_api_key ? "•••• configurada" : "Usar clave de plataforma"}
                        />
                    </Field>
                    <Field label="Clave del certificado (X-Password)">
                        <PasswordInput
                            value={form.cert_password}
                            onChange={(e) => setForm((f) => ({ ...f, cert_password: e.target.value }))}
                            placeholder={cfg?.has_cert_password ? "•••• configurada" : ""}
                        />
                    </Field>
                </div>
                <div className="flex justify-end">
                    <Button onClick={save} disabled={saving} data-testid="einvoice-save">
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        Guardar
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function Field({ label, children }) {
    return (
        <div className="space-y-1.5">
            <Label>{label}</Label>
            {children}
        </div>
    );
}
