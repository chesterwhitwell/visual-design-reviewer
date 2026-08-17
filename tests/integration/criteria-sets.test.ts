import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GET as listCriteriaSets,
  POST as createCriteriaSet,
} from "@/app/api/criteria-sets/route";
import { POST as importCriteriaSet } from "@/app/api/criteria-sets/import/route";
import {
  DELETE as deleteCriteriaSet,
  GET as getCriteriaSet,
  PUT as updateCriteriaSet,
} from "@/app/api/criteria-sets/[criteriaSetId]/route";
import { GET as exportCriteriaSet } from "@/app/api/criteria-sets/[criteriaSetId]/export/route";
import { PUT as replaceCriteriaSetFromImport } from "@/app/api/criteria-sets/[criteriaSetId]/import/route";
import { resetRuntimeConfigForTests } from "@/lib/config/runtime";
import { closeDatabase } from "@/lib/db";

const environmentKeys = [
  "DATABASE_PATH",
  "ALLOWED_HOSTS",
  "MAX_CRITERIA_COUNT",
  "MAX_JUDGEMENTS_PER_CRITERION",
] as const;

const criteria = [
  {
    title: "Typographic hierarchy",
    statement: "The hierarchy directs attention in the intended order.",
    assessorNote: "Judge only visible evidence.",
    judgementStatements: [
      {
        label: "Demonstrated",
        description: "The intended reading order is consistently clear.",
      },
      {
        label: "Developing",
        description: "The intended reading order is present but inconsistent.",
      },
    ],
  },
];

describe("criteria-set API routes", () => {
  let directory: string;
  let previousEnvironment: Partial<Record<(typeof environmentKeys)[number], string>>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "vdr-criteria-sets-"));
    previousEnvironment = Object.fromEntries(
      environmentKeys.flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    );
    process.env.DATABASE_PATH = join(directory, "criteria-sets.sqlite");
    process.env.ALLOWED_HOSTS = "localhost";
    process.env.MAX_CRITERIA_COUNT = "3";
    process.env.MAX_JUDGEMENTS_PER_CRITERION = "4";
    resetProcessState();
  });

  afterEach(() => {
    resetProcessState();
    for (const key of environmentKeys) {
      const previous = previousEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it("saves, lists, updates, exports, imports, and deletes reusable sets", async () => {
    const rejected = await createCriteriaSet(
      jsonRequest("/api/criteria-sets", "POST", {
        name: "Untrusted",
        description: null,
        criteria,
      }, false),
    );
    expect(rejected.status).toBe(403);

    const created = await createCriteriaSet(
      jsonRequest("/api/criteria-sets", "POST", {
        name: "Typography rubric",
        description: "A reusable typography assessment.",
        criteria,
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      criteriaSet: { id: string; criteria: typeof criteria };
    };
    const criteriaSetId = createdBody.criteriaSet.id;
    expect(createdBody.criteriaSet.criteria).toEqual(criteria);

    const list = await listCriteriaSets(readRequest("/api/criteria-sets"));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      criteriaSets: [
        {
          id: criteriaSetId,
          name: "Typography rubric",
          criterionCount: 1,
          judgementStatementCount: 2,
        },
      ],
    });

    const detail = await getCriteriaSet(
      readRequest(`/api/criteria-sets/${criteriaSetId}`),
      criteriaSetContext(criteriaSetId),
    );
    expect(detail.status).toBe(200);

    const exported = await exportCriteriaSet(
      readRequest(`/api/criteria-sets/${criteriaSetId}/export`),
      criteriaSetContext(criteriaSetId),
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain(
      "typography-rubric.criteria-set.json",
    );
    const document = JSON.parse(await exported.text()) as Record<string, unknown>;
    expect(document).toMatchObject({
      format: "visual-design-reviewer.criteria-set",
      schemaVersion: "1.0.0",
      name: "Typography rubric",
      criteria,
    });
    expect(JSON.stringify(document)).not.toContain('"id"');

    const updated = await updateCriteriaSet(
      jsonRequest(`/api/criteria-sets/${criteriaSetId}`, "PUT", {
        name: "Typography assessment",
        description: null,
        criteria,
      }),
      criteriaSetContext(criteriaSetId),
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      criteriaSet: { id: criteriaSetId, name: "Typography assessment" },
    });

    const replacedFromImport = await replaceCriteriaSetFromImport(
      jsonRequest(`/api/criteria-sets/${criteriaSetId}/import`, "PUT", {
        ...document,
        name: "Imported replacement",
      }),
      criteriaSetContext(criteriaSetId),
    );
    expect(replacedFromImport.status).toBe(200);

    const duplicate = await createCriteriaSet(
      jsonRequest("/api/criteria-sets", "POST", {
        name: "  IMPORTED REPLACEMENT  ",
        description: null,
        criteria,
      }),
    );
    expect(duplicate.status).toBe(409);

    const removed = await deleteCriteriaSet(
      mutationRequest(`/api/criteria-sets/${criteriaSetId}`, "DELETE"),
      criteriaSetContext(criteriaSetId),
    );
    expect(removed.status).toBe(204);

    const imported = await importCriteriaSet(
      jsonRequest("/api/criteria-sets/import", "POST", {
        ...document,
        name: "Imported typography rubric",
      }),
    );
    expect(imported.status).toBe(201);
    await expect(imported.json()).resolves.toMatchObject({
      criteriaSet: { name: "Imported typography rubric", criteria },
    });
  });

  it("rejects unsupported, ID-bearing, over-limit, and oversized imports", async () => {
    const unsupported = await importCriteriaSet(
      jsonRequest("/api/criteria-sets/import", "POST", {
        format: "visual-design-reviewer.criteria-set",
        schemaVersion: "2.0.0",
        name: "Future set",
        description: null,
        criteria,
      }),
    );
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({
      error: { message: expect.stringContaining("Unsupported") },
    });

    const withIds = await importCriteriaSet(
      jsonRequest("/api/criteria-sets/import", "POST", {
        format: "visual-design-reviewer.criteria-set",
        schemaVersion: "1.0.0",
        name: "IDs are not portable",
        description: null,
        criteria: [{ ...criteria[0], id: "external-id" }],
      }),
    );
    expect(withIds.status).toBe(400);

    const tooMany = await importCriteriaSet(
      jsonRequest("/api/criteria-sets/import", "POST", {
        format: "visual-design-reviewer.criteria-set",
        schemaVersion: "1.0.0",
        name: "Too many",
        description: null,
        criteria: [criteria[0], criteria[0], criteria[0], criteria[0]],
      }),
    );
    expect(tooMany.status).toBe(400);

    const oversized = await importCriteriaSet(
      mutationRequest(
        "/api/criteria-sets/import",
        "POST",
        JSON.stringify({}),
        {
          "Content-Type": "application/json",
          "Content-Length": "999999999",
        },
      ),
    );
    expect(oversized.status).toBe(413);
  });
});

function resetProcessState() {
  closeDatabase();
  resetRuntimeConfigForTests();
}

function readRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { Host: "localhost" },
  });
}

function jsonRequest(path: string, method: string, body: unknown, trusted = true): Request {
  return mutationRequest(
    path,
    method,
    JSON.stringify(body),
    { "Content-Type": "application/json" },
    trusted,
  );
}

function mutationRequest(
  path: string,
  method: string,
  body?: BodyInit,
  extraHeaders: Record<string, string> = {},
  trusted = true,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      ...(trusted ? { "X-VDR-Request": "1" } : {}),
      ...extraHeaders,
    },
    body,
  });
}

function criteriaSetContext(criteriaSetId: string) {
  return { params: Promise.resolve({ criteriaSetId }) };
}
