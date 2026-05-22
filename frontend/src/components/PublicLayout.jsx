import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Ticket } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function PublicLayout({ children }) {
    const { isAuthenticated, isAdmin, isOrganizer } = useAuth();
    const dashboardHref = isAdmin ? "/admin/organizadores" : "/app/dashboard";

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
                <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
                    <Link to="/" data-testid="brand-link" className="flex items-center gap-2.5">
                        <span className="grid place-items-center h-9 w-9 rounded-xl bg-primary text-primary-foreground tys-soft-shadow">
                            <Ticket className="h-5 w-5" />
                        </span>
                        <div className="flex flex-col leading-none">
                            <span className="text-sm font-semibold tracking-tight">
                                Ticket Yourself
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                Ticketing multi-tenant
                            </span>
                        </div>
                    </Link>
                    <nav className="flex items-center gap-2">
                        {isAuthenticated ? (
                            <Button
                                asChild
                                variant="outline"
                                size="sm"
                                data-testid="nav-go-dashboard"
                            >
                                <Link to={dashboardHref}>
                                    Ir al {isAdmin ? "panel admin" : "dashboard"}
                                </Link>
                            </Button>
                        ) : (
                            <>
                                <Button asChild variant="ghost" size="sm" data-testid="nav-login">
                                    <Link to="/login">Iniciar sesión</Link>
                                </Button>
                                <Button
                                    asChild
                                    size="sm"
                                    data-testid="nav-register"
                                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                                >
                                    <Link to="/registro">Soy organizador</Link>
                                </Button>
                            </>
                        )}
                    </nav>
                </div>
            </header>

            <main className="flex-1">{children}</main>

            <footer className="border-t border-border/70 mt-8">
                <div className="mx-auto max-w-6xl px-5 sm:px-8 py-6 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
                    <span>© {new Date().getFullYear()} Ticket Yourself · Ecuador</span>
                    <Link to="/poc" className="hover:text-foreground transition-colors">
                        POC interno
                    </Link>
                </div>
            </footer>
        </div>
    );
}
