export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ recoverAndKickAnalysisWorker }, { kickRetentionSweep }] = await Promise.all([
    import("@/lib/analysis/worker"),
    import("@/lib/application/retention"),
  ]);
  recoverAndKickAnalysisWorker();
  // Reconcile interrupted purges on every startup. Expired retained images are
  // included automatically when IMAGE_RETENTION_HOURS is configured.
  kickRetentionSweep();
}
