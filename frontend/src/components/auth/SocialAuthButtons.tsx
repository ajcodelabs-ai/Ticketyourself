/**
 * Google / Apple buttons for buyer auth. Hidden when the backend has no client IDs.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantSlug } from "@/contexts/TenantContext";

function loadScript(src, id) {
    return new Promise((resolve, reject) => {
        if (document.getElementById(id)) {
            resolve(true);
            return;
        }
        const s = document.createElement("script");
        s.id = id;
        s.src = src;
        s.async = true;
        s.onload = () => resolve(true);
        s.onerror = () => reject(new Error(`No se pudo cargar ${id}`));
        document.head.appendChild(s);
    });
}

function GoogleMark() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
        </svg>
    );
}

function AppleMark() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.37 12.63c.03-2.54 2.07-3.76 2.16-3.82-1.18-1.73-3.01-1.97-3.66-1.99-1.55-.16-3.04.92-3.83.92-.79 0-2.01-.9-3.3-.87-1.7.03-3.27.99-4.14 2.51-1.77 3.07-.45 7.61 1.27 10.1.84 1.22 1.84 2.59 3.15 2.54 1.27-.05 1.75-.82 3.28-.82 1.53 0 1.96.82 3.3.79 1.37-.02 2.23-1.24 3.06-2.47.96-1.4 1.36-2.76 1.38-2.83-.03-.01-2.64-1.01-2.67-4.06zM13.9 5.5c.7-.85 1.17-2.03 1.04-3.21-1.01.04-2.23.67-2.95 1.52-.65.75-1.22 1.96-1.07 3.11 1.13.09 2.28-.57 2.98-1.42z" />
        </svg>
    );
}

export default function SocialAuthButtons({ onAuthenticated = undefined }) {
    const { loginSocial } = useAuth();
    const tenantSlug = useTenantSlug();
    const [providers, setProviders] = useState([]);
    const [busy, setBusy] = useState(null);

    useEffect(() => {
        api.get("/auth/social-providers")
            .then(({ data }) => setProviders(data?.providers || []))
            .catch(() => setProviders([]));
    }, []);

    if (!providers.length) return null;

    const runSocial = async (provider, idToken, extra = {}) => {
        if (!tenantSlug) {
            toast.error("Abrí la página del organizador para crear tu cuenta.");
            return;
        }
        setBusy(provider);
        try {
            await loginSocial({
                provider,
                id_token: idToken,
                tenant_slug: tenantSlug,
                ...extra,
            });
            toast.success("Sesión iniciada");
            onAuthenticated?.();
        } catch (err) {
            toast.error(formatApiError(err?.response?.data?.detail) || err.message);
        } finally {
            setBusy(null);
        }
    };

    const google = async () => {
        const cfg = providers.find((p) => p.id === "google");
        if (!cfg) return;
        try {
            await loadScript("https://accounts.google.com/gsi/client", "tys-gis");
            const gis = (window as any).google?.accounts?.id;
            if (!gis) throw new Error("Google Sign-In no está disponible.");
            gis.initialize({
                client_id: cfg.client_id,
                callback: (resp) => {
                    if (resp?.credential) runSocial("google", resp.credential);
                },
            });
            gis.prompt((notification) => {
                if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
                    toast.error("No se pudo abrir Google. Revisá si el pop-up está bloqueado.");
                }
            });
        } catch (err) {
            toast.error(err.message || "No se pudo abrir Google.");
        }
    };

    const apple = async () => {
        const cfg = providers.find((p) => p.id === "apple");
        if (!cfg) return;
        try {
            await loadScript(
                "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js",
                "tys-appleid",
            );
            const AppleID = (window as any).AppleID;
            if (!AppleID?.auth) throw new Error("Apple Sign-In no está disponible.");
            AppleID.auth.init({
                clientId: cfg.client_id,
                scope: "name email",
                redirectURI: window.location.origin,
                usePopup: true,
            });
            const resp = await AppleID.auth.signIn();
            const idToken = resp?.authorization?.id_token;
            if (!idToken) throw new Error("Apple no envió el token.");
            const n = resp?.user?.name;
            const extraName = [n?.firstName, n?.lastName].filter(Boolean).join(" ");
            await runSocial("apple", idToken, {
                name: extraName || undefined,
                email: resp?.user?.email || undefined,
            });
        } catch (err) {
            if (err?.error === "popup_closed_by_user") return;
            toast.error(err.message || "No se pudo abrir Apple.");
        }
    };

    return (
        <div className="space-y-2" data-testid="social-auth-buttons">
            {providers.some((p) => p.id === "google") && (
                <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={!!busy}
                    onClick={google}
                    data-testid="social-google"
                >
                    {busy === "google" ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                        <GoogleMark />
                    )}
                    <span className="ml-2">Continuar con Google</span>
                </Button>
            )}
            {providers.some((p) => p.id === "apple") && (
                <Button
                    type="button"
                    variant="outline"
                    className="w-full bg-black text-white hover:bg-black/90 hover:text-white border-black"
                    disabled={!!busy}
                    onClick={apple}
                    data-testid="social-apple"
                >
                    {busy === "apple" ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                        <AppleMark />
                    )}
                    <span className="ml-2">Continuar con Apple</span>
                </Button>
            )}
            <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wide">
                    <span className="bg-background px-2 text-muted-foreground">o con email</span>
                </div>
            </div>
        </div>
    );
}
