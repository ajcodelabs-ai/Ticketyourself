import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Ticket, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const NAV = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/eventos", label: "Eventos" },
    { to: "/microsite/editor", label: "Microsite" },
    { to: "/configuracion", label: "Configuración" },
];

const STATUS_STYLE = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    suspended: "bg-zinc-200 text-zinc-700",
};

export default function OrganizerLayout({ children }) {
    const { user, organizer, logout } = useAuth();
    const { pathname } = useLocation();

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
                <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
                    <Link to="/dashboard" className="flex items-center gap-2.5" data-testid="brand-link">
                        <span className="grid place-items-center h-9 w-9 rounded-xl bg-primary text-primary-foreground tys-soft-shadow">
                            <Ticket className="h-5 w-5" />
                        </span>
                        <div className="flex flex-col leading-none">
                            <span className="text-sm font-semibold tracking-tight">
                                Ticket Yourself
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                Panel organizador
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

                    <div className="flex items-center gap-3">
                        {organizer && (
                            <Badge
                                data-testid="org-status-badge"
                                className={STATUS_STYLE[organizer.status] || ""}
                            >
                                {organizer.status}
                            </Badge>
                        )}
                        <div className="hidden sm:flex flex-col text-right leading-tight">
                            <span className="text-xs text-muted-foreground">
                                {organizer?.company_name || ""}
                            </span>
                            <span className="text-xs font-medium">{user?.email}</span>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={logout}
                            data-testid="logout-btn"
                            className="gap-2"
                        >
                            <LogOut className="h-4 w-4" />
                            Salir
                        </Button>
                    </div>
                </div>
            </header>

            <main className="flex-1 mx-auto w-full max-w-6xl px-5 sm:px-8 py-10">{children}</main>
        </div>
    );
}
