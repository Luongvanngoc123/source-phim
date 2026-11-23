import { SectionHeading, TitleGridSkeleton } from "../../components";
import styles from "./HomeSkeleton.module.css";

const ROWS = ["row-one", "row-two", "row-three", "row-four", "row-five"];

export function HomeSkeleton() {
  return (
    <div className={styles.home} aria-busy="true">
      <section className={styles.hero} aria-labelledby="loading-heading">
        <div className={styles.screenColumn}>
          <div className={styles.screen} aria-hidden="true" />
          <h1 id="loading-heading">Animora</h1>
          <div className={styles.fact} aria-hidden="true" />
          <div className={styles.actions} aria-hidden="true">
            <span />
            <span />
          </div>
        </div>
        <div className={styles.featured} aria-hidden="true">
          <div className={styles.heading} />
          <ul>
            {ROWS.map((row) => (
              <li key={row} />
            ))}
          </ul>
        </div>
      </section>
      <section className={styles.section}>
        <SectionHeading title="Mới cập nhật" />
        <TitleGridSkeleton count={10} />
      </section>
      <section className={styles.section}>
        <SectionHeading title="Sắp lên sóng" />
        <div className={styles.schedule} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className={styles.section}>
        <SectionHeading title="Sắp chiếu" />
        <TitleGridSkeleton count={10} />
      </section>
      <section className={styles.section}>
        <SectionHeading title="Thể loại" />
        <div className={styles.index} aria-hidden="true" />
      </section>
      <section className={styles.section}>
        <SectionHeading title="Theo mùa" />
        <div className={styles.matrix} aria-hidden="true" />
      </section>
    </div>
  );
}
