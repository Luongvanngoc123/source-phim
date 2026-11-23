import { Link } from "react-router";
import type { SeasonRef } from "../api/types";
import { paths } from "../app/paths";
import styles from "./SeasonMatrix.module.css";

const seasonColumns = [
  { slug: "winter", label: "Đông" },
  { slug: "spring", label: "Xuân" },
  { slug: "summer", label: "Hạ" },
  { slug: "autumn", label: "Thu" },
] as const;

type SeasonMatrixProps = {
  seasons: SeasonRef[];
};

export function SeasonMatrix({ seasons }: SeasonMatrixProps) {
  const seasonsBySlug = new Map(seasons.map((season) => [season.slug, season]));
  const years = Array.from(
    new Set(
      seasons
        .map((season) => season.slug.split("/")[1])
        .filter((year): year is string => /^\d{4}$/.test(year ?? "")),
    ),
  ).sort((a, b) => Number(b) - Number(a));

  return (
    <div className={styles.scroll}>
      <table>
        <thead>
          <tr>
            <th scope="col">Năm</th>
            {seasonColumns.map((column) => (
              <th scope="col" key={column.slug}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year}>
              <th scope="row" className="font-figure">
                {year}
              </th>
              {seasonColumns.map((column) => {
                const season = seasonsBySlug.get(`${column.slug}/${year}`);

                return (
                  <td key={column.slug}>
                    {season ? (
                      <Link
                        to={paths.season(season.slug)}
                        aria-label={`Mùa ${column.label} ${year}`}
                      >
                        {column.label}
                      </Link>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
