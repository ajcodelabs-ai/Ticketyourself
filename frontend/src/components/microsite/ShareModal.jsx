/**
 * Share modal: copy link + QR + WhatsApp / Email / Twitter shortcuts.
 * Used from the dashboard and from the editor's "Publicación" tab.
 */
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, MessageCircle, Mail, Twitter, ExternalLink } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { shareTargets } from "@/lib/microsite";

export default function ShareModal({ open, onOpenChange, url, companyName, heroSubtitle }) {
    const [copied, setCopied] = useState(false);
    const targets = shareTargets({ url, company: companyName, hero: heroSubtitle });

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard unavailable */
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" data-testid="share-modal">
                <DialogHeader>
                    <DialogTitle>Compartir microsite</DialogTitle>
                    <DialogDescription>
                        Pegá el link en tus redes o escaneá el QR para abrirlo desde el celular.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex justify-center py-2" data-testid="share-qr">
                    <div className="rounded-2xl bg-white p-4 shadow-inner border">
                        <QRCodeSVG value={url} size={172} level="M" />
                    </div>
                </div>

                <div className="flex items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2">
                    <input
                        readOnly
                        value={url}
                        className="flex-1 bg-transparent text-sm outline-none"
                        data-testid="share-url-input"
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCopy}
                        data-testid="share-copy-btn"
                    >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2">
                    <Button
                        variant="outline"
                        asChild
                        data-testid="share-whatsapp"
                    >
                        <a href={targets.whatsapp} target="_blank" rel="noreferrer">
                            <MessageCircle className="h-4 w-4 mr-1.5" />
                            WhatsApp
                        </a>
                    </Button>
                    <Button variant="outline" asChild data-testid="share-email">
                        <a href={targets.email}>
                            <Mail className="h-4 w-4 mr-1.5" />
                            Email
                        </a>
                    </Button>
                    <Button variant="outline" asChild data-testid="share-twitter">
                        <a href={targets.twitter} target="_blank" rel="noreferrer">
                            <Twitter className="h-4 w-4 mr-1.5" />
                            Twitter
                        </a>
                    </Button>
                </div>

                <Button
                    variant="link"
                    asChild
                    className="text-xs text-muted-foreground"
                    data-testid="share-open-link"
                >
                    <a href={url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        Abrir en pestaña nueva
                    </a>
                </Button>
            </DialogContent>
        </Dialog>
    );
}
