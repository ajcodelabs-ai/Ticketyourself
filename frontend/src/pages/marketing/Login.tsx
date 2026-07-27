import { Link } from "react-router-dom";
import { LogIn } from "lucide-react";
import LoginForm from "@/components/LoginForm";

export default function Login() {
    return (
        <LoginForm
            testIdPrefix="login"
            allowRole={(role) => role !== "super_admin"}
            rejectMessage="Los administradores ingresan desde /admin/login."
            defaultRedirect="/app/dashboard"
            icon={
                <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-primary text-primary-foreground mb-2">
                    <LogIn className="h-5 w-5" />
                </div>
            }
            title="Iniciar sesión"
            description="Ingresá con tu email y contraseña."
            submitIcon={<LogIn className="h-4 w-4 mr-2" />}
            submitLabel="Iniciar sesión"
            submitClassName="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            footer={
                <p className="text-sm text-muted-foreground text-center">
                    ¿No tenés cuenta?{" "}
                    <Link
                        to="/registro"
                        data-testid="login-to-register-link"
                        className="text-primary hover:underline"
                    >
                        Registrate como organizador
                    </Link>
                </p>
            }
        />
    );
}
