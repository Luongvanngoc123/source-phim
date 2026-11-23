import type { DefaultSeoProps } from "next-seo";
import { SITE_DESCRIPTION, SITE_NAME } from "@/config-global";

const SEO: DefaultSeoProps = {
  titleTemplate: `%s | ${SITE_NAME}`,
  defaultTitle: SITE_NAME,
  description: SITE_DESCRIPTION,
  openGraph: { type: "website", site_name: SITE_NAME, locale: "vi_VN" },
  additionalMetaTags: [{ name: "theme-color", content: "#101631" }],
};

export default SEO;
