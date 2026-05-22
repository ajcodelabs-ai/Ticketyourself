import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";

export default function Settings() {
    const { organizer, refreshOrganizer } = useAuth();
    const [form, setForm] = useState({
        company_name: "",
        phone: "",
        country: "",
        legal_id: "",
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (organizer) {
            setForm({
                company_name: organizer.company_name || "",
                phone: organizer.phone || "",
                country: organizer.country || "",
                legal_id: organizer.legal_id || "",
            });
        }
    }, [organizer]);

    const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await api.patch("/organizers/me", form);
            await refreshOrganizer();
            toast.success("Perfil actualizado");
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div data-testid="settings-page" className="max-w-2xl space-y-6">
            <header className="space-y-2">
                <Badge variant="secondary" className="text-primary">
                    Configuración
                </Badge>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                    Tu perfil
                </h1>
                <p className="text-sm text-muted-foreground">
                    El <b>slug</b> y el <b>email</b> son inmutables (en esta fase).
                </p>
            </header>

            <Card className="border-border/70 tys-soft-shadow">
                <CardHeader>
                    <CardTitle className="text-lg">Datos del organizador</CardTitle>
                    <CardDescription>Actualizá lo que necesites.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={save} className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Slug</Label>
                                <Input value={organizer?.slug || ""} disabled data-testid="settings-slug-readonly" />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input value={organizer?.email || ""} disabled data-testid="settings-email-readonly" />
                            </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="company-input">Nombre comercial</Label>
                                <Input
                                    id="company-input"
                                    data-testid="settings-company-input"
                                    value={form.company_name}
                                    onChange={update("company_name")}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="legal-input">RUC / Cédula</Label>
                                <Input
                                    id="legal-input"
                                    data-testid="settings-legal-input"
                                    value={form.legal_id}
                                    onChange={update("legal_id")}
                                />
                            </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="phone-input">Teléfono</Label>
                                <Input
                                    id="phone-input"
                                    data-testid="settings-phone-input"
                                    value={form.phone}
                                    onChange={update("phone")}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="country-input">País</Label>
                                <Input
                                    id="country-input"
                                    data-testid="settings-country-input"
                                    value={form.country}
                                    onChange={update("country")}
                                />
                            </div>
                        </div>
                        <Button
                            type="submit"
                            disabled={saving}
                            data-testid="settings-save-btn"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                            {saving ? "Guardando…" : "Guardar cambios"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
