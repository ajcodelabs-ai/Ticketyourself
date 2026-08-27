/**
 * Organizer rebuttal when TYS suspends an event: edit the event and/or
 * send a message + documents for the super-admin to review.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Edit3, FileText, Loader2, Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import api, { formatApiError } from "@/lib/api";

async function downloadBlob(path, filename) {
    const res = await api.get(path, { responseType: "blob" });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "evidencia";
    a.click();
    window.URL.revokeObjectURL(url);
}

export default function SuspensionAppealPanel({ event, onSubmitted }) {
    const navigate = useNavigate();
    const appeal = event.suspension_appeal || {};
    const status = appeal.status || "none";
    const [message, setMessage] = useState(status === "pending" ? appeal.message || "" : "");
    const [files, setFiles] = useState([]);
    const [sending, setSending] = useState(false);

    const canSubmit = true;

    const submit = async () => {
        const text = message.trim();
        if (text.length < 10) {
            toast.error("Contá qué pasó o qué corregiste (mínimo 10 caracteres).");
            return;
        }
        const fd = new FormData();
        fd.append("message", text);
        for (const f of files) fd.append("files", f);
        setSending(true);
        try {
            await api.post(`/events/me/${event.id}/suspension-appeal`, fd, {
                timeout: 60000,
            });
            toast.success("Enviamos tu respuesta al equipo de Ticket Yourself.");
            setFiles([]);
            onSubmitted?.();
        } catch (e) {
            toast.error(formatApiError(e?.response?.data?.detail) || e.message);
        } finally {
            setSending(false);
        }
    };

    return (
        <Card
            className="border-orange-200 bg-orange-50/60"
            data-testid="suspension-appeal-panel"
        >
            <CardHeader>
                <CardTitle className="text-lg">Evento suspendido</CardTitle>
                <CardDescription className="text-orange-900/80">
                    Motivo: {event.suspended_reason || "el super admin lo bajó de venta."}{" "}
                    Podés corregir precios, fechas o datos, y/o refutar la decisión con un
                    mensaje y documentos.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                    <Button
                        onClick={() => navigate(`/app/eventos/${event.id}/editar`)}
                        data-testid="event-edit-from-appeal"
                    >
                        <Edit3 className="h-4 w-4 mr-1.5" />
                        Corregir el evento
                    </Button>
                    {status === "pending" && (
                        <Badge className="bg-sky-100 text-sky-900">Apelación en revisión</Badge>
                    )}
                    {status === "rejected" && (
                        <Badge className="bg-red-100 text-red-800">Apelación rechazada</Badge>
                    )}
                    {status === "accepted" && (
                        <Badge className="bg-emerald-100 text-emerald-800">Apelación aceptada</Badge>
                    )}
                </div>

                {status === "pending" && (
                    <p className="text-sm text-muted-foreground">
                        Hay una respuesta en revisión. Si corregiste más datos, podés
                        actualizar el mensaje y los documentos; se reemplaza lo enviado.
                    </p>
                )}

                {status === "rejected" && appeal.admin_note && (
                    <p className="text-sm rounded-md border border-red-200 bg-white px-3 py-2">
                        El admin respondió: {appeal.admin_note}
                    </p>
                )}

                {Array.isArray(appeal.files) && appeal.files.length > 0 && (
                    <div className="space-y-1">
                        <div className="text-xs uppercase text-muted-foreground">
                            Documentos enviados
                        </div>
                        {appeal.files.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                className="flex items-center gap-2 text-sm hover:text-primary"
                                onClick={() =>
                                    downloadBlob(
                                        `/events/me/${event.id}/suspension-appeal/files/${f.id}`,
                                        f.original_filename,
                                    )
                                }
                            >
                                <FileText className="h-3.5 w-3.5" />
                                {f.original_filename || "archivo"}
                            </button>
                        ))}
                    </div>
                )}

                {(status === "none" || status === "pending" || status === "rejected") && (
                    <div className="space-y-3 rounded-lg border bg-white p-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="appeal-message">Tu respuesta</Label>
                            <Textarea
                                id="appeal-message"
                                rows={4}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="Ej. Corregí el precio de la localidad VIP / adjunto permiso municipal…"
                                data-testid="appeal-message"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="appeal-files">
                                Documentos (opcional, PDF o imagen, máx. 5)
                            </Label>
                            <input
                                id="appeal-files"
                                type="file"
                                multiple
                                accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
                                onChange={(e) =>
                                    setFiles(Array.from(e.target.files || []).slice(0, 5))
                                }
                                className="block w-full text-sm"
                                data-testid="appeal-files"
                            />
                            {files.length > 0 && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Paperclip className="h-3 w-3" />
                                    {files.map((f) => f.name).join(", ")}
                                </p>
                            )}
                        </div>
                        <Button
                            onClick={submit}
                            disabled={sending || !canSubmit}
                            data-testid="appeal-submit"
                        >
                            {sending ? (
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : null}
                            {status === "pending"
                                ? "Actualizar respuesta"
                                : "Enviar respuesta al admin"}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
