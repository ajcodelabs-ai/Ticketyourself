import { Link, useLocation } from "react-router-dom";
import { LogIn } from "lucide-react";
import LoginForm from "@/components/LoginForm";
import { defaultPathForRole } from "@/lib/authRedirect";

export default function Login() {
    const location = useLocation();
    const next = new URLSearchParams(location.search).toString();
    const registerTo = next ? `/registro-comprador?${next}` : "/registro-comprador";

    return (
        <LoginForm
            testIdPrefix="login"
            allowRole={(role) => role !== "super_admin"}
            rejectMessage="Los administradores ingresan desde /admin/login."
            redirectForRole={defaultPathForRole}
            defaultRedirect="/cuenta"
            icon={
                <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-primary text-primary-foreground mb-2">
                    <LogIn className="h-5 w-5" />
                </div>
            }
            title="Iniciar sesión"
            description="Ingresá con tu email y contraseña para comprar o ver tus entradas."
            submitIcon={<LogIn className="h-4 w-4 mr-2" />}
            submitLabel="Iniciar sesión"
            submitClassName="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            footer={
                <div className="space-y-1.5 text-sm text-muted-foreground text-center">
                    <p>
                        ¿Primera vez?{" "}
                        <Link
                            to={registerTo}
                            state={location.state}
                            data-testid="login-to-buyer-register-link"
                            className="text-primary hover:underline"
                        >
                            Creá tu cuenta de comprador
                        </Link>
                    </p>
                    <p>
                        ¿Organizás eventos?{" "}
                        <Link
                            to="/registro"
                            data-testid="login-to-register-link"
                            className="text-primary hover:underline"
                        >
                            Registrate como organizador
                        </Link>
                    </p>
                </div>
            }
        />
    );
}
