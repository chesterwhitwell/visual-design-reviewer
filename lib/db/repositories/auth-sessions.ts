import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";

import type { AppDatabase } from "../client";
import { authSessions, type AuthSessionRow } from "../schema";
import type { Clock, RepositoryDependencies } from "./shared";
import { systemClock } from "./shared";

export interface CreateAuthSessionInput {
  tokenHash: string;
  principalId: string;
  displayName: string;
  provider: "password" | "oidc";
  expiresAt: string;
}

export class AuthSessionRepository {
  private readonly clock: Clock;

  constructor(
    private readonly db: AppDatabase,
    dependencies: RepositoryDependencies = {},
  ) {
    this.clock = dependencies.clock ?? systemClock;
  }

  create(input: CreateAuthSessionInput): AuthSessionRow {
    const timestamp = this.clock();
    return this.db
      .insert(authSessions)
      .values({
        ...input,
        createdAt: timestamp,
        lastSeenAt: timestamp,
      })
      .returning()
      .get();
  }

  getActive(tokenHash: string, at = this.clock()): AuthSessionRow | null {
    return this.db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, at),
        ),
      )
      .get() ?? null;
  }

  touch(tokenHash: string): void {
    this.db
      .update(authSessions)
      .set({ lastSeenAt: this.clock() })
      .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
      .run();
  }

  revoke(tokenHash: string): boolean {
    return this.db
      .update(authSessions)
      .set({ revokedAt: this.clock() })
      .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
      .run().changes > 0;
  }

  revokeAll(): number {
    return this.db
      .update(authSessions)
      .set({ revokedAt: this.clock() })
      .where(isNull(authSessions.revokedAt))
      .run().changes;
  }

  deleteExpired(at = this.clock()): number {
    return this.db.delete(authSessions).where(lte(authSessions.expiresAt, at)).run().changes;
  }

  countActive(at = this.clock()): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(authSessions)
      .where(and(isNull(authSessions.revokedAt), gt(authSessions.expiresAt, at)))
      .get();
    return Number(row?.count ?? 0);
  }

  listRecent(limit = 20): AuthSessionRow[] {
    return this.db
      .select()
      .from(authSessions)
      .orderBy(desc(authSessions.createdAt))
      .limit(Math.max(1, Math.min(limit, 100)))
      .all();
  }
}
