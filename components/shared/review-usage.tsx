export type ReviewUsageSummary = {
  totalTokens: number;
  estimatedCostMicroUsd: number;
  meteredAttempts: number;
  unpricedAttempts: number;
};

const tokenFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export function ReviewUsage({ usage }: { usage: ReviewUsageSummary }) {
  const hasUnpricedUsage = usage.unpricedAttempts > 0;
  const unpricedLabel = hasUnpricedUsage
    ? ` · ${usage.unpricedAttempts} unpriced ${usage.unpricedAttempts === 1 ? "attempt" : "attempts"}`
    : "";

  return (
    <span
      className="review-usage"
      title={
        hasUnpricedUsage
          ? "The displayed cost excludes attempts recorded without a matching price."
          : "Estimated from the model pricing captured when each request ran."
      }
    >
      {tokenFormatter.format(usage.totalTokens)} tokens ·{" "}
      {usdFormatter.format(usage.estimatedCostMicroUsd / 1_000_000)}
      {hasUnpricedUsage ? "+" : ""} estimated
      {unpricedLabel}
    </span>
  );
}
