import { kickRetentionSweep } from "@/lib/application/retention";
import { privateJson } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET() {
  // Coalesced and non-blocking: health checks provide bounded retention work
  // opportunities without making probe latency depend on local file deletion.
  kickRetentionSweep();
  return privateJson({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
