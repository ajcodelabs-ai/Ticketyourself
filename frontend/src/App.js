import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";

import { TenantProvider } from "@/contexts/TenantContext";
import Layout from "@/components/Layout";
import Home from "@/pages/Home";
import Subscribe from "@/pages/Subscribe";
import Ticket from "@/pages/Ticket";
import Success from "@/pages/Success";
import Cancel from "@/pages/Cancel";
import Payments from "@/pages/Payments";

function App() {
    return (
        <div className="App">
            <BrowserRouter>
                <TenantProvider>
                    <Layout>
                        <Routes>
                            <Route path="/" element={<Home />} />
                            <Route path="/poc/subscribe" element={<Subscribe />} />
                            <Route path="/poc/ticket" element={<Ticket />} />
                            <Route path="/poc/success" element={<Success />} />
                            <Route path="/poc/cancel" element={<Cancel />} />
                            <Route path="/poc/payments" element={<Payments />} />
                        </Routes>
                    </Layout>
                </TenantProvider>
                <Toaster richColors position="top-right" />
            </BrowserRouter>
        </div>
    );
}

export default App;
