type SafeLogLevel = "info" | "warn" | "error";

export type SafeLogEvent = {
  event: string;
  reviewId?: string;
  runId?: string;
  passId?: string;
  attempt?: number;
  durationMs?: number;
  statusCode?: number;
  requestId?: string;
  model?: string;
  inputCount?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  errorCode?: string;
};

function write(level: SafeLogLevel, event: SafeLogEvent): void {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...event,
  });

  if (level === "error") {
    console.error(record);
  } else if (level === "warn") {
    console.warn(record);
  } else {
    console.info(record);
  }
}

export const logger = {
  info: (event: SafeLogEvent) => write("info", event),
  warn: (event: SafeLogEvent) => write("warn", event),
  error: (event: SafeLogEvent) => write("error", event),
};
