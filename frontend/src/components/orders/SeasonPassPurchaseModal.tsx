/**
 * SeasonPassPurchaseModal — buys credits for a season pass (Fase 4).
 * No función/seat selection here — that happens later, on the redemption
 * page (`/o/{slug}/abono/{purchase_token}`), once the pass is paid.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Ticket as TicketIcon } from "lucide-react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PhoneInput from "@/components/ui/phone-input";
import api, { formatApiError } from "@/lib/api";
import { formatCents } from "@/lib/orders";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SeasonPassPurchaseModal({ open, onOpenChange, seasonPass, event, tenantSlug }) {
    const navigate = useNavigate();
    const [buyer, setBuyer] = useState({ name: "", email: "", phone: "", document_id: "" });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            setBuyer({ name: "", email: "", phone: "", document_id: "" });
            setErrors({});
        }
    }, [open]);

    if (!seasonPass) return null;
    const isFree = (seasonPass.price_cents || 0) === 0;

    const validate = () => {
        const e: Record<string, string> = {};
        if (!buyer.name.trim() || buyer.name.trim().length < 2) e.name = "Requerido";
        if (!EMAIL_RE.test(buyer.email)) e.email = "Email inválido";
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const submit = async () => {
        if (!validate()) return;
        setSubmitting(true);
        try {
            const { data } = await api.post(`/public/season-passes/${seasonPass.id}/purchase`, {
                buyer: {
                    name: buyer.name.trim(),
                    email: buyer.email.trim().toLowerCase(),
                    phone: buyer.phone || undefined,
                    document_id: buyer.document_id || undefined,
                },
                origin_url: window.location.origin,
            });
            if (data.status === "paid" && data.redirect_to) {
                toast.success("¡Abono confirmado! Te enviamos el link por email.");
                navigate(data.redirect_to);
                onOpenChange(false);
                return;
            }
            if (data.checkout_url) {
                window.location.href = data.checkout_url;
                return;
            }
            toast.error("No se pudo generar la compra del abono.");
        } catch (err: any) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" data-testid="season-pass-purchase-modal">
                <DialogHeader>
                    <DialogTitle className="text-2xl">Comprar abono</DialogTitle>
                    <DialogDescription className="text-base">{seasonPass.name}</DialogDescription>
                </DialogHeader>

                <div className="rounded-lg border bg-secondary/40 p-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Créditos incluidos</span>
                        <span className="font-medium">{seasonPass.credits_total}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Evento</span>
                        <span className="font-medium">{event?.title}</span>
                    </div>
                    <div className="flex justify-between text-base font-semibold pt-1">
                        <span>Total</span>
                        <span>{isFree ? "Gratis" : formatCents(seasonPass.price_cents, seasonPass.currency)}</span>
                    </div>
                </div>

                <p className="text-xs text-muted-foreground">
                    No elegís funciones todavía — eso lo hacés después, desde el link que te
                    enviamos por email, cuando quieras durante la temporada.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1.5">
                        <Label htmlFor="pass-buyer-name">Nombre completo *</Label>
                        <Input
                            id="pass-buyer-name"
                            value={buyer.name}
                            onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
                            data-testid="pass-buyer-name"
                            aria-invalid={!!errors.name}
                        />
                        {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="pass-buyer-email">Email *</Label>
                        <Input
                            id="pass-buyer-email"
                            type="email"
                            value={buyer.email}
                            onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))}
                            data-testid="pass-buyer-email"
                            aria-invalid={!!errors.email}
                        />
                        {errors.email && <p className="text-xs text-red-600">{errors.email}</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="pass-buyer-phone">Teléfono</Label>
                        <PhoneInput
                            id="pass-buyer-phone"
                            value={buyer.phone}
                            onChange={(v) => setBuyer((b) => ({ ...b, phone: v || "" }))}
                            data-testid="pass-buyer-phone"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="pass-buyer-doc">Documento / cédula</Label>
                        <Input
                            id="pass-buyer-doc"
                            value={buyer.document_id}
                            onChange={(e) => setBuyer((b) => ({ ...b, document_id: e.target.value }))}
                            data-testid="pass-buyer-doc"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancelar
                    </Button>
                    <Button onClick={submit} disabled={submitting} className="min-w-[160px]" data-testid="pass-purchase-submit">
                        {submitting ? (
                            <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Procesando…</>
                        ) : (
                            <><TicketIcon className="h-4 w-4 mr-1.5" />{isFree ? "Confirmar abono" : "Pagar abono"}</>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
