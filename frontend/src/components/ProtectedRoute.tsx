import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute({ children, role }) {
    const { loading, isAuthenticated, user } = useAuth();
    const location = useLocation();
    const roles = role == null ? null : Array.isArray(role) ? role : [role];

    if (loading) {
        return (
            <div
                data-testid="auth-loading"
                className="min-h-screen grid place-items-center text-sm text-muted-foreground"
            >
                Cargando…
            </div>
        );
    }
    if (!isAuthenticated) {
        const loginPath =
            roles?.length === 1 && roles[0] === "super_admin" ? "/admin/login" : "/login";
        return <Navigate to={loginPath} state={{ from: location }} replace />;
    }
    if (roles && !roles.includes(user?.role)) {
        if (user?.role === "buyer") {
            return <Navigate to="/cuenta" replace />;
        }
        if (roles.includes("super_admin") && user?.role === "organizer") {
            return <Navigate to="/app/dashboard" replace />;
        }
        if (roles.includes("organizer") && user?.role === "super_admin") {
            return <Navigate to="/admin" replace />;
        }
        return (
            <div
                data-testid="forbidden"
                className="min-h-screen grid place-items-center text-center px-6"
            >
                <div>
                    <h1 className="text-2xl font-semibold mb-2">Acceso denegado</h1>
                    <p className="text-muted-foreground">
                        No tenés permisos para ver esta sección.
                    </p>
                </div>
            </div>
        );
    }
    return children;
}
