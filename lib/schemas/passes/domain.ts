import { z } from "zod";

import {
  AdjudicationDecisionSchema,
  CandidateDesignFindingSchema,
  ContextAlignmentRecordSchema,
  CriteriaAnalysisInputSnapshotSchema,
  CriteriaSynthesisSchema,
  CriterionChallengeSchema,
  CriterionComparisonSchema,
  CriterionEvidenceSearchSchema,
  CriterionResultSchema,
  DesignAnalysisInputSnapshotSchema,
  DesignChallengeSchema,
  DesignFindingSchema,
  DesignSynthesisSchema,
  EvidenceItemSchema,
} from "@/lib/domain/analysis";
import { addDuplicateIssues } from "@/lib/domain/common";

export const D1OutputSchema = z
  .object({
    observations: z.array(EvidenceItemSchema).max(500),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.observations.map(({ id }) => id),
      context,
      ["observations"],
      "D1 evidence IDs",
    );
  });

export const D2OutputSchema = z
  .object({
    findings: z.array(CandidateDesignFindingSchema).max(150),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.findings.map(({ id }) => id),
      context,
      ["findings"],
      "D2 finding IDs",
    );
  });

export const D3OutputSchema = z
  .object({
    alignments: z.array(ContextAlignmentRecordSchema).max(150),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.alignments.map(({ id }) => id),
      context,
      ["alignments"],
      "D3 alignment IDs",
    );
    addDuplicateIssues(
      output.alignments.map(({ findingId }) => findingId),
      context,
      ["alignments"],
      "D3 finding references",
    );
  });

export const D4OutputSchema = z
  .object({
    challenges: z.array(DesignChallengeSchema).max(150),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.challenges.map(({ id }) => id),
      context,
      ["challenges"],
      "D4 challenge IDs",
    );
    addDuplicateIssues(
      output.challenges.map(({ findingId }) => findingId),
      context,
      ["challenges"],
      "D4 finding references",
    );
  });

export const D5OutputSchema = z
  .object({
    decisions: z.array(AdjudicationDecisionSchema).max(150),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.decisions.map(({ id }) => id),
      context,
      ["decisions"],
      "D5 decision IDs",
    );
    const finalIds = output.decisions.flatMap(({ resultingFinding }) =>
      resultingFinding === undefined ? [] : [resultingFinding.id],
    );
    addDuplicateIssues(finalIds, context, ["decisions"], "adjudicated finding IDs");
  });

export const D6OutputSchema = z.object({ synthesis: DesignSynthesisSchema }).strict();

export const C1OutputSchema = z
  .object({
    criteria: z.array(CriterionEvidenceSearchSchema).min(1).max(50),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.criteria.map(({ criterionId }) => criterionId),
      context,
      ["criteria"],
      "C1 criterion references",
    );
    const evidenceIds = output.criteria.flatMap(({ supportingEvidence, counterEvidence }) => [
      ...supportingEvidence.map(({ id }) => id),
      ...counterEvidence.map(({ id }) => id),
    ]);
    addDuplicateIssues(evidenceIds, context, ["criteria"], "C1 evidence IDs");
  });

export const C2OutputSchema = z
  .object({
    comparisons: z.array(CriterionComparisonSchema).min(1).max(50),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.comparisons.map(({ criterionId }) => criterionId),
      context,
      ["comparisons"],
      "C2 criterion references",
    );
  });

export const C3OutputSchema = z
  .object({
    challenges: z.array(CriterionChallengeSchema).min(1).max(50),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.challenges.map(({ criterionId }) => criterionId),
      context,
      ["challenges"],
      "C3 criterion references",
    );
  });

export const C4OutputSchema = z
  .object({
    results: z.array(CriterionResultSchema).min(1).max(50),
  })
  .strict()
  .superRefine((output, context) => {
    addDuplicateIssues(
      output.results.map(({ criterionId }) => criterionId),
      context,
      ["results"],
      "C4 criterion references",
    );
  });

export const C5OutputSchema = z.object({ synthesis: CriteriaSynthesisSchema }).strict();

export const D1InputSchema = z
  .object({ snapshot: DesignAnalysisInputSnapshotSchema })
  .strict();
export const D2InputSchema = z
  .object({ snapshot: DesignAnalysisInputSnapshotSchema, d1: D1OutputSchema })
  .strict();
export const D3InputSchema = z
  .object({
    snapshot: DesignAnalysisInputSnapshotSchema,
    d1: D1OutputSchema,
    d2: D2OutputSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.snapshot.context === null) {
      context.addIssue({
        code: "custom",
        message: "D3 is skipped when no context was supplied",
        path: ["snapshot", "context"],
      });
    }
  });
export const D4InputSchema = z
  .object({
    snapshot: DesignAnalysisInputSnapshotSchema,
    d1: D1OutputSchema,
    d2: D2OutputSchema,
    d3: D3OutputSchema.optional(),
  })
  .strict();
export const D5InputSchema = z
  .object({
    snapshot: DesignAnalysisInputSnapshotSchema,
    d1: D1OutputSchema,
    d2: D2OutputSchema,
    d3: D3OutputSchema.optional(),
    d4: D4OutputSchema,
  })
  .strict();
export const D6InputSchema = z
  .object({
    snapshot: DesignAnalysisInputSnapshotSchema,
    d1: D1OutputSchema,
    d5: D5OutputSchema,
  })
  .strict();

export const C1InputSchema = z
  .object({
    snapshot: CriteriaAnalysisInputSnapshotSchema,
    designFindings: z.array(DesignFindingSchema).max(150),
  })
  .strict();
export const C2InputSchema = z
  .object({ snapshot: CriteriaAnalysisInputSnapshotSchema, c1: C1OutputSchema })
  .strict();
export const C3InputSchema = z
  .object({
    snapshot: CriteriaAnalysisInputSnapshotSchema,
    c1: C1OutputSchema,
    c2: C2OutputSchema,
  })
  .strict();
export const C4InputSchema = z
  .object({
    snapshot: CriteriaAnalysisInputSnapshotSchema,
    c1: C1OutputSchema,
    c2: C2OutputSchema,
    c3: C3OutputSchema,
  })
  .strict();
export const C5InputSchema = z
  .object({ snapshot: CriteriaAnalysisInputSnapshotSchema, c4: C4OutputSchema })
  .strict();

export const DomainPassOutputSchemas = {
  D1: D1OutputSchema,
  D2: D2OutputSchema,
  D3: D3OutputSchema,
  D4: D4OutputSchema,
  D5: D5OutputSchema,
  D6: D6OutputSchema,
  C1: C1OutputSchema,
  C2: C2OutputSchema,
  C3: C3OutputSchema,
  C4: C4OutputSchema,
  C5: C5OutputSchema,
} as const;

export const DomainPassInputSchemas = {
  D1: D1InputSchema,
  D2: D2InputSchema,
  D3: D3InputSchema,
  D4: D4InputSchema,
  D5: D5InputSchema,
  D6: D6InputSchema,
  C1: C1InputSchema,
  C2: C2InputSchema,
  C3: C3InputSchema,
  C4: C4InputSchema,
  C5: C5InputSchema,
} as const;

export type D1Output = z.infer<typeof D1OutputSchema>;
export type D2Output = z.infer<typeof D2OutputSchema>;
export type D3Output = z.infer<typeof D3OutputSchema>;
export type D4Output = z.infer<typeof D4OutputSchema>;
export type D5Output = z.infer<typeof D5OutputSchema>;
export type D6Output = z.infer<typeof D6OutputSchema>;
export type C1Output = z.infer<typeof C1OutputSchema>;
export type C2Output = z.infer<typeof C2OutputSchema>;
export type C3Output = z.infer<typeof C3OutputSchema>;
export type C4Output = z.infer<typeof C4OutputSchema>;
export type C5Output = z.infer<typeof C5OutputSchema>;

export type DomainPassOutputById = {
  D1: D1Output;
  D2: D2Output;
  D3: D3Output;
  D4: D4Output;
  D5: D5Output;
  D6: D6Output;
  C1: C1Output;
  C2: C2Output;
  C3: C3Output;
  C4: C4Output;
  C5: C5Output;
};
