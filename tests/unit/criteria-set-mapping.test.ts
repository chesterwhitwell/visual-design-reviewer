import { describe, expect, it } from "vitest";

import {
  criteriaToSetTemplate,
  instantiateCriteriaSet,
} from "@/components/review-workspace/criteria-set-mapping";

describe("criteria-set client mapping", () => {
  it("strips review IDs and creates fresh IDs whenever a set is loaded", () => {
    const template = criteriaToSetTemplate([
      {
        id: "review-criterion",
        title: "  Hierarchy  ",
        statement: "  Establishes a clear reading order.  ",
        assessorNote: "  Judge visible evidence.  ",
        order: 7,
        judgementStatements: [
          {
            id: "review-statement",
            label: "  Demonstrated  ",
            description: "  The reading order is consistently clear.  ",
            order: 9,
          },
        ],
      },
    ]);

    expect(template).toEqual([
      {
        title: "Hierarchy",
        statement: "Establishes a clear reading order.",
        assessorNote: "Judge visible evidence.",
        judgementStatements: [
          {
            label: "Demonstrated",
            description: "The reading order is consistently clear.",
          },
        ],
      },
    ]);
    expect(JSON.stringify(template)).not.toContain("review-criterion");

    const first = instantiateCriteriaSet(template);
    const second = instantiateCriteriaSet(template);
    expect(first[0]!.id).not.toBe(second[0]!.id);
    expect(first[0]!.judgementStatements[0]!.id).not.toBe(
      second[0]!.judgementStatements[0]!.id,
    );
    expect(first[0]).toMatchObject({ order: 0, judgementStatements: [{ order: 0 }] });
  });
});
