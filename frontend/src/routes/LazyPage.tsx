import { Suspense, type ComponentType, type ReactNode } from "react";
import PageLoader from "@/components/PageLoader";

/** Wraps a lazy page component in Suspense with a shared loading fallback. */
export function LazyPage({ page: Page }: { page: ComponentType }) {
    return (
        <Suspense fallback={<PageLoader />}>
            <Page />
        </Suspense>
    );
}

/** Suspense wrapper for route elements that already include layout children. */
export function SuspenseWrap({ children }: { children: ReactNode }) {
    return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}
