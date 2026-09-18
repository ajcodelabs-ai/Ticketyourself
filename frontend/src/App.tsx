import "@/App.css";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import { TenantRouteSync } from "@/components/TenantRouteSync";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import AppRoutes from "@/routes/AppRoutes";

function App() {
    return (
        <div className="App">
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <TenantProvider>
                        <TenantRouteSync />
                        <AuthProvider>
                            <AppRoutes />
                        </AuthProvider>
                    </TenantProvider>
                    {/* top-right, not bottom: several pages (event wizard, venue
                        editor) have a sticky action bar pinned to the bottom of
                        the viewport that a bottom-right toast would sit on top of
                        and cover ("Guardar"/"Siguiente" became unclickable). */}
                    <Toaster richColors position="top-right" />
                </BrowserRouter>
            </QueryClientProvider>
        </div>
    );
}

export default App;
