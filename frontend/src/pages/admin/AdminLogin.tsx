import { ShieldCheck } from "lucide-react";
import LoginForm from "@/components/LoginForm";

export default function AdminLogin() {
    return (
        <LoginForm
            testIdPrefix="admin-login"
            allowRole={(role) => role === "super_admin"}
            rejectMessage="Este acceso es exclusivo para el equipo de TYS."
            defaultRedirect="/admin"
            icon={
                <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-zinc-900 text-white mb-2">
                    <ShieldCheck className="h-5 w-5" />
                </div>
            }
            title="Panel de administración"
            description="Acceso exclusivo para el equipo de TYS."
            submitIcon={<ShieldCheck className="h-4 w-4 mr-2" />}
            submitLabel="Entrar al panel"
            submitClassName="w-full bg-zinc-900 hover:bg-zinc-800 text-white"
            skipTenant
            footer={
                <p className="text-sm text-muted-foreground text-center">
                    ¿Eres organizador?{" "}
                    <a href="/login" className="text-primary hover:underline">
                        Inicia sesión aquí
                    </a>
                </p>
            }
        />
    );
}
