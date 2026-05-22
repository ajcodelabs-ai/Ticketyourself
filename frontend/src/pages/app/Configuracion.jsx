/**
 * /app/configuracion — Phase 5. 3 tabs: Perfil / Plan y facturación / Seguridad.
 */
import { useEffect, useState } from "react";
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
import {
    Loader2,
    CreditCard,
    User,
    Lock,
    ExternalLink,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { formatCents } from "@/lib/orders";

export default function Configuracion() {
    return (
        <div className="space-y-6" data-testid="configuracion-page">
            <header>
                <div className="text-sm text-muted-foreground">Configuración</div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
                    Ajustes de tu cuenta
                </h1>
            </header>
            <Tabs defaultValue="profile">
                <TabsList>
                    <TabsTrigger value="profile" data-testid="cfg-tab-profile">
                        <User className="h-3.5 w-3.5 mr-1.5" />
                        Perfil
                    </TabsTrigger>
                    <TabsTrigger value="plan" data-testid="cfg-tab-plan">
                        <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                        Plan y facturación
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
                        <Input
                            value={form.phone}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, phone: e.target.value }))
                            }
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
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [openingPortal, setOpeningPortal] = useState(false);

    useEffect(() => {
        api.get("/dashboard/me")
            .then((r) => setData(r.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const openPortal = async () => {
        setOpeningPortal(true);
        try {
            const { data } = await api.post("/billing/portal", {
                return_url: window.location.href,
            });
            window.location.href = data.portal_url;
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
            setOpeningPortal(false);
        }
    };

    if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
    if (!data) return null;
    const { organizer, plan } = data;

    return (
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
                    <Input type="password" disabled />
                </Field>
                <Field label="Nueva contraseña">
                    <Input type="password" disabled />
                </Field>
                <Field label="Confirmar nueva contraseña">
                    <Input type="password" disabled />
                </Field>
                <Button disabled data-testid="cfg-pwd-save">
                    Próximamente
                </Button>
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
