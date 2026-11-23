import { Html, Head, Main, NextScript } from "next/document";
import { SITE_DESCRIPTION, SITE_NAME } from "@/config-global";

export default function Document() {
  return (
    <Html lang="vi">
      <Head>
        <link rel="icon" href="/favicon.svg" />
        <meta name="description" content={SITE_DESCRIPTION} />
        <meta name="application-name" content={SITE_NAME} />
        <meta name="theme-color" content="#101631" />
      </Head>
      <body className="overflow-x-hidden bg-bg-body">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
