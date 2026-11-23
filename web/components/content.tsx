import { useEffect, useLayoutEffect, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { Toaster } from "react-hot-toast";
import LoadingOverlay from "@/components/loading/loader";
import type { ReactElement, ReactNode } from "react";
import { AppProps } from "next/app";
import { AuthProvider } from "@/providers/AuthProvider";

export type NextPageWithLayout = {
  getLayout?: (page: ReactElement) => ReactNode;
};

export type AppPropsWithLayout = AppProps & {
  Component: AppProps["Component"] & NextPageWithLayout;
  pageProps: { [key: string]: unknown };
};

const Layout = dynamic(() => import("@/layouts/default/Layout"), { ssr: false });
const Footer = dynamic(() => import("@/layouts/default/Footer"), { ssr: false });

const AppContent = ({ Component, pageProps }: AppPropsWithLayout) => {
  const [loading, setLoading] = useState(true);
  const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

  useIsomorphicLayoutEffect(() => {
    document.documentElement.style.setProperty("--primary", "255 216 117");
    document.documentElement.style.setProperty("--primary-light", "255 231 166");
    document.documentElement.style.setProperty("--bg-body", "25 27 36");
    document.documentElement.style.setProperty("--bg-body2", "39 44 67");
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("overflow-y-hidden", loading);
    return () => document.body.classList.remove("overflow-y-hidden");
  }, [loading]);

  const getLayout = Component.getLayout ?? ((page) => page);
  return (
    <AuthProvider>
      <>
        {loading && <LoadingOverlay />}
        <Suspense fallback={<LoadingOverlay />}>
          <Layout>
            {getLayout(<Component {...pageProps} />)}
            <Footer />
          </Layout>
        </Suspense>
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      </>
    </AuthProvider>
  );
};

export default AppContent;
