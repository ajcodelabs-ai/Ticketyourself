import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute({ children, role }) {
    const { loading, isAuthenticated, user } = useAuth();
    const location = useLocation();

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
        return <Navigate to="/login" state={{ from: location }} replace />;
    }
    if (role && user?.role !== role) {
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
