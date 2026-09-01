import { Link } from "react-router-dom";
import { LogOut, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { previewMicrositePath } from "@/lib/config";

export default function BuyerLayout({ children }) {
    const { user, logout, isOrganizer, organizer } = useAuth();
    const name = user?.display_name || user?.email || "Cuenta";
    const eventsHome = previewMicrositePath(user?.tenant_slug || organizer?.slug);

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
                <div className="mx-auto max-w-5xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
                    <Link to="/cuenta" className="flex items-center gap-2.5" data-testid="buyer-brand">
                        <span className="grid place-items-center h-9 w-9 rounded-xl bg-primary text-primary-foreground">
                            <Ticket className="h-5 w-5" />
                        </span>
                        <div className="flex flex-col leading-none">
                            <span className="text-sm font-semibold tracking-tight">Mis entradas</span>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                {name}
                            </span>
                        </div>
                    </Link>
                    <nav className="flex items-center gap-2">
                        <Button asChild variant="outline" size="sm">
                            <Link to={eventsHome} data-testid="buyer-events-home">
                                Eventos
                            </Link>
                        </Button>
                        {isOrganizer && (
                            <Button asChild variant="outline" size="sm">
                                <Link to="/app/dashboard">Panel organizador</Link>
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={logout}
                            data-testid="buyer-logout"
                        >
                            <LogOut className="h-4 w-4 mr-1.5" />
                            Salir
                        </Button>
                    </nav>
                </div>
            </header>
            <main className="flex-1">{children}</main>
        </div>
    );
}
