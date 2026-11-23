import { useSearchParams } from "react-router";
import { useSearch } from "../../api/queries";
import { paths } from "../../app/paths";
import { ListingLayout } from "./ListingLayout";

type SearchResultsProps = {
  queryText: string;
};

function pageFromParams(params: URLSearchParams): number {
  const page = Number(params.get("trang"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function SearchResults({ queryText }: SearchResultsProps) {
  const [searchParams] = useSearchParams();
  const page = pageFromParams(searchParams);
  const query = useSearch(queryText, page);

  return (
    <ListingLayout
      items={query.data?.items}
      isFetching={query.isFetching}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      page={page}
      hasNext={(query.data?.count ?? 0) === 30}
      hrefFor={(nextPage) => paths.search(queryText, nextPage)}
      emptyTitle={`Không tìm thấy anime nào cho “${queryText}”.`}
      emptyDetail="Thử tên tiếng Nhật hoặc tên khác của phim."
    />
  );
}
