import { paths } from "../../app/paths";
import { Notice } from "../../components";
import { isMissingTitle } from "./failureTitle";

type LoadFailureProps = {
  error: unknown;
  retry: () => void;
};

/** What to do next when a title could not be loaded: search again, or retry. */
export function LoadFailure({ error, retry }: LoadFailureProps) {
  if (isMissingTitle(error)) {
    return (
      <Notice
        kind="empty"
        title="Đường dẫn có thể đã đổi. Tìm lại bằng tên phim ở ô tìm kiếm."
        action={{ label: "Về trang chủ", to: paths.home() }}
      />
    );
  }

  return (
    <Notice
      kind="error"
      title="Kiểm tra kết nối rồi thử lại."
      action={{ label: "Thử lại", onClick: retry }}
    />
  );
}
