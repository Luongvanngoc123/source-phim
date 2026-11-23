import { Notice } from "../components/Notice";
import { usePageTitle } from "./usePageTitle";

export function RouteError() {
  usePageTitle("Trang gặp lỗi");

  return (
    <section className="content-column page-main">
      <h1 className="visually-hidden">Trang gặp lỗi</h1>
      <Notice
        kind="error"
        title="Trang gặp lỗi. Tải lại trang."
        action={{
          label: "Tải lại trang",
          onClick: () => window.location.reload(),
        }}
      />
    </section>
  );
}
