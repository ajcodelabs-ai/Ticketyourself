/**
 * AdminLayout — Phase 5.5 sidebar shell for super-admin area.
 *
 * Uses an orange/red accent to visually differentiate from the organizer
 * area (which uses indigo). Same UX pattern: fixed sidebar desktop, drawer
 * on mobile, avatar dropdown.
 */
import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
    LayoutDashboard,
    Users,
    Ticket as TicketIcon,
    DollarSign,
    TrendingUp,
    FileText,
    Download,
    LogOut,
    Menu,
    ChevronDown,
    Shield,
    LayoutTemplate,
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
    { to: "/admin", label: "Dashboard global", icon: LayoutDashboard, testid: "nav-admin-dashboard", exact: true },
    { to: "/admin/organizadores", label: "Organizadores", icon: Users, testid: "nav-admin-organizers" },
    { to: "/admin/eventos", label: "Eventos", icon: TicketIcon, testid: "nav-admin-events" },
    { to: "/admin/venue-templates", label: "Plantillas venues", icon: LayoutTemplate, testid: "nav-admin-venue-templates" },
    { to: "/admin/planes", label: "Planes", icon: DollarSign, testid: "nav-admin-plans" },
    { to: "/admin/funnel", label: "Funnel", icon: TrendingUp, testid: "nav-admin-funnel" },
    { to: "/admin/auditoria", label: "Auditoría", icon: FileText, testid: "nav-admin-audit" },
    { to: "/admin/reportes", label: "Exportar reportes", icon: Download, testid: "nav-admin-reports" },
];

export default function AdminLayout({ children }) {
    const { user, logout } = useAuth();
    const [mobileOpen, setMobileOpen] = useState(false);
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout?.();
        navigate("/login", { replace: true });
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* ── Mobile header ──────────────────────────────────────── */}
            <header
                className="lg:hidden sticky top-0 z-30 border-b bg-background px-4 py-3 flex items-center justify-between"
                data-testid="admin-mobile-header"
            >
                <div className="flex items-center gap-2">
                    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid="admin-burger">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent
                            side="left"
                            className="p-0 w-72"
                            data-testid="admin-sidebar-drawer"
                        >
                            <SidebarBody onItemClick={() => setMobileOpen(false)} />
                        </SheetContent>
                    </Sheet>
                    <Link to="/admin" className="font-bold tracking-tight">
                        TYS · Admin
                    </Link>
                </div>
                <UserMenu user={user} onLogout={handleLogout} />
            </header>

            {/* ── Desktop sidebar ────────────────────────────────────── */}
            <aside
                className="hidden lg:flex fixed top-0 left-0 z-20 h-screen w-60 flex-col border-r bg-background"
                data-testid="admin-sidebar"
            >
                <SidebarBody />
            </aside>

            {/* ── Desktop header ─────────────────────────────────────── */}
            <header
                className="hidden lg:flex sticky top-0 z-10 h-16 border-b bg-background/90 backdrop-blur items-center justify-between px-6 ml-60"
                data-testid="admin-desktop-header"
            >
                <div className="flex items-center gap-2 text-sm">
                    <Shield className="h-4 w-4 text-orange-600" />
                    <span className="font-semibold tracking-wide uppercase text-xs text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                        Super Admin
                    </span>
                </div>
                <UserMenu user={user} onLogout={handleLogout} />
            </header>

            <main className="lg:ml-60 px-4 sm:px-6 py-6 sm:py-8" data-testid="admin-main">
                <div className="max-w-7xl mx-auto">{children}</div>
            </main>
        </div>
    );
}

function SidebarBody({ onItemClick }) {
    const location = useLocation();
    return (
        <div className="flex flex-col h-full">
            <div className="px-5 py-5 border-b">
                <Link to="/admin" className="block">
                    <div className="font-bold text-xl tracking-tight">
                        <span className="text-orange-600">TYS</span>
                        <span className="text-muted-foreground text-sm ml-2">Admin</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Panel super-admin</div>
                </Link>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5">
                {NAV_ITEMS.map(({ to, label, icon: Icon, testid, exact }) => {
                    const isActive = exact
                        ? location.pathname === to
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
                                        ? "bg-orange-500/10 text-orange-700"
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
                v0.5.5 · Super-Admin
            </div>
        </div>
    );
}

function UserMenu({ user, onLogout }) {
    const initials = (user?.email || "?")
        .split("@")[0]
        .split(/[._-]/)
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 h-9" data-testid="admin-user-menu">
                    <div className="h-7 w-7 rounded-full bg-orange-600 text-white grid place-items-center text-xs font-semibold">
                        {initials || "AD"}
                    </div>
                    <span className="hidden sm:inline text-sm font-medium max-w-[180px] truncate">
                        {user?.email}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem disabled className="text-xs">
                    {user?.email}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={onLogout}
                    className="text-red-600 focus:text-red-700"
                    data-testid="admin-logout"
                >
                    <LogOut className="h-4 w-4 mr-2" />
                    Cerrar sesión
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
