/**
 * OrganizerLayout — Phase 5 sidebar + header shell for the organizer area.
 *
 * Desktop: fixed sidebar on the left (240px), main area scrolls.
 * Mobile (<lg): sidebar collapses behind a drawer (Sheet).
 */
import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
    LayoutDashboard,
    MapPin,
    Ticket as TicketIcon,
    Palette,
    Settings,
    LogOut,
    Menu,
    ChevronDown,
    User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetTrigger,
} from "@/components/ui/sheet";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

const NAV_ITEMS = [
    {
        to: "/app/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        testid: "nav-dashboard",
    },
    { to: "/app/venues", label: "Venues", icon: MapPin, testid: "nav-venues" },
    {
        to: "/app/eventos",
        label: "Eventos",
        icon: TicketIcon,
        testid: "nav-events",
        match: (p) => p.startsWith("/app/eventos"),
    },
    {
        to: "/app/microsite",
        label: "Microsite",
        icon: Palette,
        testid: "nav-microsite",
    },
    {
        to: "/app/configuracion",
        label: "Configuración",
        icon: Settings,
        testid: "nav-config",
    },
];

export default function OrganizerLayout({ children }) {
    const { user, organizer, logout } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout?.();
        navigate("/login", { replace: true });
    };

    return (
        <div className="min-h-screen bg-secondary/40">
            {/* ── Mobile + Tablet Header ────────────────────────────────── */}
            <header
                className="lg:hidden sticky top-0 z-30 border-b bg-background px-4 py-3 flex items-center justify-between"
                data-testid="org-mobile-header"
            >
                <div className="flex items-center gap-2">
                    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid="org-burger">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent
                            side="left"
                            className="p-0 w-72"
                            data-testid="org-sidebar-drawer"
                        >
                            <SidebarBody
                                organizer={organizer}
                                onItemClick={() => setMobileOpen(false)}
                            />
                        </SheetContent>
                    </Sheet>
                    <Link to="/app/dashboard" className="font-bold tracking-tight">
                        TYS
                    </Link>
                </div>
                <UserMenu user={user} organizer={organizer} onLogout={handleLogout} />
            </header>

            {/* ── Desktop Sidebar ─────────────────────────────────────────── */}
            <aside
                className="hidden lg:flex fixed top-0 left-0 z-20 h-screen w-60 flex-col border-r bg-background"
                data-testid="org-sidebar"
            >
                <SidebarBody organizer={organizer} />
            </aside>

            {/* ── Desktop Header ──────────────────────────────────────────── */}
            <header
                className="hidden lg:flex sticky top-0 z-10 h-16 border-b bg-background/90 backdrop-blur items-center justify-between px-6 ml-60"
                data-testid="org-desktop-header"
            >
                <div className="text-sm text-muted-foreground">
                    {organizer?.company_name ? (
                        <span data-testid="org-header-company">
                            {organizer.company_name}
                        </span>
                    ) : null}
                </div>
                <UserMenu user={user} organizer={organizer} onLogout={handleLogout} />
            </header>

            {/* ── Main content ────────────────────────────────────────────── */}
            <main className="lg:ml-60 px-4 sm:px-6 py-6 sm:py-8" data-testid="org-main">
                <div className="max-w-6xl mx-auto">{children}</div>
            </main>
        </div>
    );
}

function SidebarBody({ organizer, onItemClick }) {
    const location = useLocation();
    return (
        <div className="flex flex-col h-full">
            <div className="px-5 py-5 border-b">
                <Link to="/app/dashboard" className="block">
                    <div className="font-bold text-xl tracking-tight">
                        Ticket<span className="text-primary">Yourself</span>
                    </div>
                    {organizer?.slug && (
                        <div className="text-xs text-muted-foreground mt-1">
                            /o/<span className="font-mono">{organizer.slug}</span>
                        </div>
                    )}
                </Link>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5">
                {NAV_ITEMS.map(({ to, label, icon: Icon, testid, match }) => {
                    const isActive = match
                        ? match(location.pathname)
                        : location.pathname.startsWith(to);
                    return (
                        <NavLink
                            key={to}
                            to={to}
                            onClick={onItemClick}
                            data-testid={testid}
                            className={() =>
                                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                    isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                                }`
                            }
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            {label}
                        </NavLink>
                    );
                })}
            </nav>
            <div className="px-3 py-3 border-t text-[11px] text-muted-foreground">
                v0.5 · Fase 5
            </div>
        </div>
    );
}

function UserMenu({ user, organizer, onLogout }) {
    const initials = (organizer?.company_name || user?.email || "?")
        .split(/\s+/)
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="gap-2 h-9"
                    data-testid="org-user-menu"
                >
                    <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-semibold">
                        {initials}
                    </div>
                    <span className="hidden sm:inline text-sm font-medium max-w-[140px] truncate">
                        {user?.email}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild data-testid="user-menu-profile">
                    <Link to="/app/configuracion">
                        <UserIcon className="h-4 w-4 mr-2" />
                        Mi perfil
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={onLogout}
                    className="text-red-600 focus:text-red-700"
                    data-testid="user-menu-logout"
                >
                    <LogOut className="h-4 w-4 mr-2" />
                    Cerrar sesión
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
