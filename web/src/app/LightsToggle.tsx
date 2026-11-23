import { useLights } from "./lights";
import styles from "./LightsToggle.module.css";

/** The one lights control: "Tắt đèn" in the lit room, "Bật đèn" in the dark one. */
export function LightsToggle() {
  const { lights, toggle } = useLights();
  const label = lights === "on" ? "Tắt đèn" : "Bật đèn";

  return (
    <button className={styles.toggle} type="button" onClick={toggle}>
      {label}
    </button>
  );
}
