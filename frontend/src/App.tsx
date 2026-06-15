import "@/App.css";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import AppRoutes from "@/routes/AppRoutes";

function App() {
    return (
        <div className="App">
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <AuthProvider>
                        <TenantProvider>
                            <AppRoutes />
                        </TenantProvider>
                    </AuthProvider>
                    <Toaster richColors position="top-right" />
                </BrowserRouter>
            </QueryClientProvider>
        </div>
    );
}

export default App;
