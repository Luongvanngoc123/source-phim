import { DefaultSeo } from "next-seo";
import SEO from "@/next-seo.config";
import "@fortawesome/fontawesome-free/css/fontawesome.css";
import "@fortawesome/fontawesome-free/css/solid.css";
import "./app.css";
import AppContent, { AppPropsWithLayout } from "@/components/content";

export default function MyApp(props: AppPropsWithLayout) {
  return (
    <>
      <DefaultSeo {...SEO} />
      <AppContent {...props} />
    </>
  );
}
