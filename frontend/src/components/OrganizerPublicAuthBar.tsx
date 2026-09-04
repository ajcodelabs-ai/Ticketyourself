import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantSlug } from "@/contexts/TenantContext";
import { Button } from "@/components/ui/button";

function withNext(path: string, next: string) {
    const encoded = encodeURIComponent(next);
    return `${path}?next=${encoded}`;
}

/** Login / registro (o Mis entradas) en todas las páginas públicas del organizador. */
export default function OrganizerPublicAuthBar() {
    const { loading, isAdmin, isBuyer, belongsToCurrentTenant, logout } = useAuth();
    const tenantSlug = useTenantSlug();
    const location = useLocation();

    if (loading || isAdmin || !tenantSlug) return null;

    const next = `${location.pathname}${location.search}`;

    return (
        <div
            className="pointer-events-none fixed top-3 right-3 z-40"
            data-testid="org-public-auth-bar"
        >
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-background/90 p-1.5 shadow-lg backdrop-blur-md">
                {belongsToCurrentTenant ? (
                    <>
                        <Button
                            asChild
                            size="sm"
                            variant="secondary"
                            data-testid="event-public-mis-entradas"
                        >
                            <Link to="/cuenta">Mis entradas</Link>
                        </Button>
                        {isBuyer ? (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={logout}
                                data-testid="org-public-logout"
                            >
                                Salir
                            </Button>
                        ) : null}
                    </>
                ) : (
                    <>
                        <Button
                            asChild
                            size="sm"
                            variant="secondary"
                            data-testid="event-public-login"
                        >
                            <Link to={withNext("/login", next)}>Iniciar sesión</Link>
                        </Button>
                        <Button asChild size="sm" data-testid="org-public-register">
                            <Link to={withNext("/registro-comprador", next)}>Crear cuenta</Link>
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
