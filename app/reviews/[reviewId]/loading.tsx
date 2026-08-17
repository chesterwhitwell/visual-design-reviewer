import styles from "@/components/review-workspace/review-workspace.module.css";

export default function ReviewLoading() {
  return (
    <div className={styles.routeLoading} aria-label="Loading review workspace">
      <div className={styles.loadingMark} />
      <p>Opening review workspace…</p>
    </div>
  );
}
