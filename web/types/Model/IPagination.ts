interface IPagination {
  /** Items on the pages up to and including this one; the engine never reports a grand total. */
  totalItems: number;
  /** Last page number, or null when the engine does not know it. */
  totalPages: number | null;
  currentPage: number;
  itemsPerPage: number;
  /** Whether a following page may exist. */
  hasNext: boolean;
}
