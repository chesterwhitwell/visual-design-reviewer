import { randomUUID } from "node:crypto";

export type Clock = () => string;
export type IdFactory = () => string;

export const systemClock: Clock = () => new Date().toISOString();
export const systemIdFactory: IdFactory = () => randomUUID();

export interface RepositoryDependencies {
  clock?: Clock;
  idFactory?: IdFactory;
}

export interface SafeFailure {
  code: string;
  message: string;
}

export interface UsageMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}
