import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTenant } from "@/contexts/TenantContext";
import { Ticket as TicketIcon, ChevronDown, Building2 } from "lucide-react";

const NAV = [
    { to: "/", label: "Inicio" },
    { to: "/poc/subscribe", label: "Suscripción" },
    { to: "/poc/ticket", label: "Ticket" },
    { to: "/poc/payments", label: "Pagos" },
];

const KNOWN_TENANTS = [
    { slug: "demo-org", name: "Demo Organizer" },
    { slug: "prueba-eventos", name: "Prueba Eventos" },
];

function getSwitcherLabel({ loading, tenant, tenantSlug }) {
    if (loading) return "cargando…";
    if (tenant) return tenant.name;
    return tenantSlug || "sin tenant";
}

function TenantSwitcher() {
    const { tenant, tenantSlug, loading, setTenantSlug } = useTenant();

    const label = getSwitcherLabel({ loading, tenant, tenantSlug });

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    data-testid="tenant-switcher-trigger"
                    className="gap-2 border-border/80"
                >
                    <Building2 className="h-4 w-4 text-primary" />
                    <span className="hidden sm:inline text-foreground/80">
                        Tenant:
                    </span>
                    <span
                        data-testid="tenant-current-name"
                        className="font-medium"
                    >
                        {label}
                    </span>
                    {tenant ? (
                        <Badge
                            data-testid="tenant-status-badge"
                            variant="secondary"
                            className="ml-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                        >
                            {tenant.status}
                        </Badge>
                    ) : (
                        !loading && (
                            <Badge
                                variant="secondary"
                                className="ml-1 bg-amber-100 text-amber-700 hover:bg-amber-100"
                                data-testid="tenant-not-found-badge"
                            >
                                no encontrado
                            </Badge>
                        )
                    )}
                    <ChevronDown className="h-4 w-4 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-60"
                data-testid="tenant-switcher-menu"
            >
                <DropdownMenuLabel>Cambiar tenant (POC)</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {KNOWN_TENANTS.map((t) => (
                    <DropdownMenuItem
                        key={t.slug}
                        data-testid={`tenant-option-${t.slug}`}
                        onClick={() => setTenantSlug(t.slug)}
                        className="flex flex-col items-start gap-0.5"
                    >
                        <span className="text-sm font-medium">{t.name}</span>
                        <span className="text-xs text-muted-foreground">
                            {t.slug}
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default function Layout({ children }) {
    const { pathname } = useLocation();

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
                <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
                    <Link
                        to="/"
                        data-testid="brand-link"
                        className="flex items-center gap-2.5 group"
                    >
                        <span className="grid place-items-center h-9 w-9 rounded-xl bg-primary text-primary-foreground tys-soft-shadow">
                            <TicketIcon className="h-5 w-5" />
                        </span>
                        <div className="flex flex-col leading-none">
                            <span className="text-sm font-semibold tracking-tight">
                                Ticket Yourself
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                POC · Fase 0
                            </span>
                        </div>
                    </Link>

                    <nav className="hidden md:flex items-center gap-1">
                        {NAV.map((item) => {
                            const active = pathname === item.to;
                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    data-testid={`nav-${item.label.toLowerCase()}`}
                                    className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                                        active
                                            ? "bg-secondary text-secondary-foreground"
                                            : "text-foreground/70 hover:text-foreground hover:bg-muted"
                                    }`}
                                >
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>

                    <TenantSwitcher />
                </div>
            </header>

            <main className="flex-1 mx-auto w-full max-w-6xl px-5 sm:px-8 py-10">
                {children}
            </main>

            <footer className="border-t border-border/70 mt-8">
                <div className="mx-auto max-w-6xl px-5 sm:px-8 py-6 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
                    <span data-testid="footer-tag">
                        © {new Date().getFullYear()} Ticket Yourself
                    </span>
                    <span>USD · Ecuador</span>
                </div>
            </footer>
        </div>
    );
}
