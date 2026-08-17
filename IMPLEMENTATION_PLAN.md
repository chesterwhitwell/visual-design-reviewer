# Visual Design Reviewer — Implementation Plan

**Prepared:** 15 August 2026  
**Source:** `visual-design-reviewer-design-spec.md`  
**Status:** MVP implementation complete; native release checks passed. Linux container build awaits registry access.

## 1. Readiness outcome

The specification was sufficiently complete to build the MVP as a modular monolith. The normative data model has been extended to support immutable input snapshots, durable multi-pass progress, safe retry/restart behaviour, per-pass provenance, and image retention.

Development was gated until these contracts were represented in types and tests; they are now implemented:

1. review and image lifecycle;
2. immutable Design Analysis and Criteria Analysis inputs;
3. D1–D6 and C1–C5 pass input/output schemas;
4. analysis run/pass state transitions;
5. retention, purge, and active-run leasing;
6. the server-only model gateway.

The first implementation milestone—sanitised image handling, a schema-constrained pass boundary, and durable pass records—has been completed, along with the full D1–D6 and C1–C5 pipelines and workspace UI.

## 2. Agreed MVP interpretation

The implementation will preserve these invariants from the specification:

- Design Analysis is criteria-independent and immutable once completed.
- Criteria Analysis re-inspects the same image revision and never mutates Design Analysis.
- User context is untrusted supporting context, not objective truth.
- Every material conclusion must remain traceable to visible evidence.
- Adversarial passes produce concise challenge records, not hidden reasoning.
- A failed or refused pass is visibly failed; the application never manufactures a completed result.
- Review, Focus, and Off remain distinct. Off excludes deliberate analysis, but prompts may still report a severe cross-cutting issue that is necessary to understand communication effectiveness.
- User rubric wording and ordering are preserved and never converted to a numeric score.
- `insufficient_evidence` is available independently of whether custom judgement statements exist.
- Generated output uses UK English.
- Text in images, filenames, context, criteria, notes, and previous model output is untrusted data and cannot alter system instructions.

### Resolutions to specification gaps

1. **Session retention versus “disabled by default”:** interpret this as no permanent raw-image library. Raw uploads are discarded after sanitisation. A sanitised, encrypted analysis copy may remain while the review is active under the visible Mode A policy, then is purged manually, on close, or at the configured expiry. Mode B remains supported by requiring matching re-uploaded images for later Criteria Analysis.
2. **Integrated Review:** implement an MVP deterministic relationship view using adjudicated Design findings and each `CriterionResult.designRelationship`. Do not add another model pass or persistence type until evaluations show it adds value.
3. **Taxonomy editing:** keep the default taxonomy in a schema-validated, versioned JSON configuration file that can be mounted into Docker. Implement selection presets in the UI; defer a full taxonomy-authoring UI.
4. **Long-running work:** use a durable SQLite-backed queue with a single local worker. Browser requests enqueue work and then poll for progress; work does not depend on the initiating HTTP connection staying open.
5. **Image changes:** replacing, removing, reordering, or changing an image's analysis role creates a new review-input revision. Analyses reference immutable manifests rather than the review's current mutable image list. Each revision item is `final_work` or `concept_development`; existing and newly uploaded images default to `final_work`.
6. **Context used by Criteria Analysis:** use the context snapshot from the selected Design Analysis version. This prevents a later edit from silently changing the meaning of an older design result.
7. **Canonical identifiers:** the application creates IDs. Model outputs use application-provided references or local ordinal references that are converted and semantically validated server-side.

## 3. Technical baseline

Use a single-container Node-runtime modular monolith:

- Next.js App Router, React, and TypeScript;
- same-origin Route Handlers for the HTTP API;
- Drizzle ORM with `better-sqlite3` and SQLite WAL mode;
- Zod for domain and transport validation;
- `sharp` plus actual-content detection for image validation and normalisation;
- Node `crypto` authenticated encryption for retained image assets;
- official server-side OpenAI JavaScript SDK;
- Vitest and Testing Library for unit/component tests;
- Playwright for browser acceptance tests;
- Docker and Docker Compose using a Debian-slim Node base to reduce native-module friction.

Pin exact dependency and runtime versions when the repository is scaffolded. Keep the domain and application layers independent of Next.js, Drizzle, and OpenAI SDK types.

### Main internal interfaces

```ts
interface ReviewRepository { /* mutable review configuration */ }
interface AnalysisRunRepository { /* durable runs, passes, attempts */ }
interface AnalysisArtifactRepository { /* immutable completed versions */ }
interface SettingsRepository { /* non-secret local settings */ }

interface ImageProcessor { /* validate, orient, strip, size, hash */ }
interface ImageStore { /* encrypted put/read/purge */ }
interface RetentionService { /* expiry and active-run coordination */ }

interface ModelGateway {
  runStructured<I, O>(request: StructuredModelRequest<I, O>): Promise<ModelResult<O>>;
}

interface AnalysisPass<I, O> {
  id: string;
  promptVersion: string;
  schemaVersion: string;
  execute(input: I, context: PassExecutionContext): Promise<O>;
}
```

Other primary services are `PromptRegistry`, `SchemaRegistry`, `DesignAnalysisOrchestrator`, `CriteriaAnalysisOrchestrator`, `MarkdownExporter`, and `JsonExporter`.

## 4. Proposed repository structure

```text
.
├── app/
│   ├── api/
│   │   ├── health/
│   │   ├── settings/
│   │   ├── analysis-runs/
│   │   └── reviews/
│   ├── reviews/
│   │   ├── new/
│   │   └── [reviewId]/
│   ├── settings/
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── criteria-editor/
│   ├── image-workspace/
│   ├── results/
│   ├── review-taxonomy/
│   └── shared/
├── config/
│   └── review-taxonomy.v1.json
├── lib/
│   ├── application/
│   │   ├── analysis/
│   │   ├── reviews/
│   │   └── settings/
│   ├── domain/
│   │   ├── analysis.ts
│   │   ├── criteria.ts
│   │   ├── review.ts
│   │   └── taxonomy.ts
│   ├── analysis/
│   │   ├── criteria/
│   │   ├── design/
│   │   ├── prompts/
│   │   └── registry.ts
│   ├── db/
│   │   ├── migrations/
│   │   ├── repositories/
│   │   ├── client.ts
│   │   └── schema.ts
│   ├── exports/
│   ├── images/
│   ├── jobs/
│   ├── openai/
│   ├── privacy/
│   ├── schemas/
│   │   ├── domain/
│   │   └── passes/
│   └── security/
├── tests/
│   ├── e2e/
│   ├── evaluation/
│   ├── fixtures/
│   ├── integration/
│   └── unit/
├── data/                    # Docker volume; gitignored
├── Dockerfile
├── docker-compose.yml
├── drizzle.config.ts
├── .env.example
└── README.md
```

## 5. Persistence design

Use normalised tables for mutable configuration and lifecycle state, with schema-validated JSON text for immutable snapshots and model artifacts. This keeps the local database simple while preserving exact historical inputs.

### Mutable records

- `reviews`: identity, title, current context, lifecycle, timestamps.
- `image_assets`: immutable image metadata, content digest, encrypted storage locator, expiry, and purge state.
- `review_image_revisions`: ordered image manifests for a review revision; items capture the immutable Final work or Concept & development analysis role.
- `review_area_selections`: current Off/Review/Focus selections.
- `criteria` and `judgement_statements`: current editable rubric.
- `taxonomy_presets` and `app_settings`.

### Durable orchestration records

- `analysis_runs`: kind, review ID, selected Design Analysis ID, immutable input snapshot, state, cancel request, lease, safe error, timestamps.
- `analysis_passes`: one record for each expected D/C stage, including `skipped` for D3 without context.
- `pass_attempts`: attempt number, state, model/prompt/schema configuration, duration, safe API metadata, usage, and validated structured output.

Run states:

```text
queued → running → completed
                 ↘ failed
                 ↘ cancelled
                 ↘ interrupted
```

Pass states extend the specification with `skipped` and `interrupted` so that restart and the optional D3 pass are explicit.

### Immutable completed artifacts

- `design_analyses`: unique `(review_id, version)`, input snapshot, per-pass provenance, final validated artifact.
- `criteria_analyses`: unique `(review_id, version)`, selected Design Analysis ID, criteria snapshot, input snapshot, per-pass provenance, final validated artifact.

Allocate the visible analysis version only in the transaction that finalises a successful run. Retrying a failed pass stays within the same run; explicitly rerunning a completed analysis creates a new run and version.

### Required immutable snapshot fields

- context text used by the run;
- stable image IDs, order, Final work/Concept & development analysis roles, sanitized-content digests, dimensions, and MIME types;
- selected review areas plus taxonomy ID, label, and taxonomy version;
- criteria and judgement statement wording/order for Criteria Analysis;
- selected Design Analysis ID;
- pass-by-pass model, detail, reasoning, prompt, and schema versions;
- relevant operational limits used by the run.

Do not persist SDK request objects, Base64 data, raw responses, hidden reasoning, or unvalidated output.

## 6. Pass contracts and audit data

Define a separate strict transport schema and domain schema for every stage before implementing its prompt.

### Design pipeline

- **D1:** observations with image reference, human-readable region, review-area reference, and confidence.
- **D2:** candidate findings referencing D1 evidence and separating observation, interpretation, likely effect, significance, and confidence.
- **D3:** context alignment records tied to candidate findings; persist `skipped` when context is absent.
- **D4:** one challenge result per substantive finding with status, counter-evidence, alternative interpretation, and concise qualification.
- **D5:** adjudication decisions with retain/modify/merge/reject action, rationale summary, source finding IDs, and resulting finding.
- **D6:** structured `DesignSynthesis`, generated only from retained/modified/merged adjudicated findings, including Concept and development feedback when development evidence was supplied. Process-to-final statements must trace to evidence from both roles.

### Criteria pipeline

- **C1:** per-criterion assessability, supporting evidence, counter-evidence, relevant context, and optional Design finding links. Outcome criteria use final-work evidence, process criteria use development evidence, and absent process evidence remains insufficient rather than inferred.
- **C2:** comparison against every supplied statement, best fit, why adjacent statements fit less well, or independent insufficient-evidence status.
- **C3:** alternate-level challenge, scope/bias checks, and design-quality-versus-compliance tension.
- **C4:** final decision, selected statement or fallback, rationale, alternative, confidence, and design relationship.
- **C5:** concise criterion-referenced synthesis using the supplied wording.

Initial high-fidelity behaviour sends images to D1–D5 and C1–C4; D6 and C5 are text-only synthesis stages. One request handles all bounded criteria in each stage. Criterion sharding or cheaper text-only stages should be introduced only after evaluation demonstrates equal quality.

Every pass receives explicit untrusted-content boundaries. All cross-references, enum values, array bounds, string bounds, and evidence references receive semantic validation after structural parsing.

## 7. OpenAI adapter contract verified on 15 August 2026

Current official OpenAI documentation supports the intended adapter:

- The Responses API accepts multiple `input_image` items, including Base64 data URLs, so ordinary processing does not need persistent Files API objects: <https://developers.openai.com/api/docs/guides/images-vision>.
- Current image detail values include `low`, `high`, `original`, and `auto`; `original` is appropriate for small typography and dense layouts when the configured model supports it.
- Responses API Structured Outputs use strict `text.format`; the JavaScript SDK supports `responses.parse` with Zod helpers: <https://developers.openai.com/api/docs/guides/structured-outputs>.
- Strict schemas require an object root, required fields, and `additionalProperties: false`. Transport-level optional values should therefore be required-but-nullable and mapped into cleaner domain types after validation.
- Refusals are a separate response shape and must not be treated as schema failures.
- `store: false` must be set on every compatible request. It is distinct from organisation-approved Zero Data Retention, and standard abuse-monitoring retention may still apply: <https://developers.openai.com/api/docs/guides/your-data>.
- Current GPT-5.6 Sol, Terra, and Luna model pages advertise image input and Structured Outputs. Use configuration rather than model names in domain logic: <https://developers.openai.com/api/docs/models/compare>.

Recommended evaluation baseline:

- visual/adversarial/adjudication stages: GPT-5.6 Terra as the balance-of-quality-and-cost candidate;
- quality comparison: GPT-5.6 Sol on the evaluation corpus;
- synthesis cost comparison: GPT-5.6 Luna only if it preserves required quality;
- image detail: `original` for the quality baseline, compared with `high` for cost and latency;
- reasoning effort: explicit per pass, starting at `medium` and reduced only when evaluations support it.

These are deployer-facing defaults or examples, not hard-coded business rules. Account availability must be confirmed by the connection/capability test. Do not use background mode, persistent conversations, or `previous_response_id` in the MVP; send validated pass artifacts explicitly so runs remain auditable and compatible with `store: false`.

The gateway must distinguish success, refusal/content filter, authentication, rate limit, transient service failure, timeout, structurally invalid output, semantically invalid output, and cancellation. Retry only eligible transient or validation failures with a bounded attempt count, exponential backoff, jitter, and `Retry-After` support.

## 8. Image and retention lifecycle

```text
upload bytes
  → byte/count/pixel limits
  → decode and actual-type validation
  → reject animated/multi-frame input
  → orientation normalisation
  → metadata-free re-encode
  → dimensions + SHA-256 digest
  → authenticated encryption
  → private image store
  → immutable image asset record
```

- Never use an original filename as a path; render filenames as escaped text.
- Keep assets outside the web root with restrictive permissions.
- Create encrypted thumbnails that share the source asset's purge lifecycle.
- Decrypt into bounded memory for preview and API submission; use `Cache-Control: no-store`.
- Protect against decompression bombs, excessive pixels, malformed/polyglot input, animated WebP, and aggregate request exhaustion.
- Coordinate purge with an active-run lease. An expiring asset becomes `purge_pending` until no run holds it.
- Mode B re-upload must match the saved sanitized-image digest, count, and order before it can be used against an older Design Analysis.
- Purge removes ciphertext, thumbnail ciphertext, and storage locators while retaining only the minimum manifest required to interpret textual analyses.

Retained assets should use per-image AES-256-GCM encryption with a server-side master key supplied through an environment variable or Docker secret. Key loss makes retained images unrecoverable and must not corrupt textual analyses. “Secure deletion” must be documented as cryptographic/best-effort deletion: an application cannot guarantee physical SSD, filesystem snapshot, or backup erasure.

## 9. HTTP and UI surface

Suggested same-origin endpoints:

```text
GET/POST       /api/reviews
GET/PATCH      /api/reviews/:reviewId
POST/PATCH     /api/reviews/:reviewId/images
GET            /api/reviews/:reviewId/images/:imageId/preview
PUT            /api/reviews/:reviewId/areas
PUT            /api/reviews/:reviewId/criteria
POST           /api/reviews/:reviewId/design-analyses
POST           /api/reviews/:reviewId/criteria-analyses
GET            /api/analysis-runs/:runId
POST           /api/analysis-runs/:runId/retry
POST           /api/analysis-runs/:runId/cancel
POST           /api/reviews/:reviewId/purge
GET            /api/reviews/:reviewId/exports/:format
GET/PATCH      /api/settings
POST           /api/settings/openai-test
GET            /api/health
```

The main review screen remains freely navigable, with a setup/sidebar region and image/results workspace. Implement accessible segmented controls for Off/Review/Focus, keyboard-operable ordering controls as a baseline, and optional drag-and-drop as progressive enhancement. Results include Design Review, Criteria Review, deterministic Integrated Review, and Analysis Detail with version selection.

Long-running actions return a run ID immediately. The UI polls durable state, shows the current analytical stage, survives refresh, prevents accidental double submission, and explains whether a failed pass is retryable.

## 10. Security and privacy baseline

The no-account trusted-LAN constraint remains in scope; the implementation will not silently add a user system. It must still include:

- server-only API key access and a build test proving the key is absent from browser bundles;
- exact Host/Origin allow-listing for mutating requests, restrictive CORS, and a custom same-origin request header;
- CSP, `frame-ancestors`, `nosniff`, safe content rendering, and no-store headers for private responses;
- configurable upload/run quotas and a single-worker queue to contain API spend and resource exhaustion;
- no raw HTML rendering of user/model content;
- privacy-safe errors and a redaction layer around SDK errors;
- logs limited to time, review/run ID, pass, attempt, state, duration, status/request ID, configured model, safe counts, and usage;
- a non-root container, private volume permissions, health check, and dropped Linux capabilities where practical;
- prominent documentation that every device able to reach the app can use it, and that plain HTTP on a LAN does not protect content from network observers;
- ZDR displayed as declared organisation configuration, never as verified eligibility.

No analytics, third-party telemetry, automatic cloud backup, inbound webhooks, or public reverse proxy belongs in the MVP.

## 11. Delivery sequence

### Phase 0 — Contracts and test harness

- Record product-owner decisions below.
- Define domain types, pass schemas, state machines, error taxonomy, and configurable resource budgets.
- Add fixtures and a fake `ModelGateway`.
- Add schema, reference-integrity, state-transition, and privacy/redaction tests.

**Exit:** a fake D1 run can be enqueued, executed, checkpointed, restored, and inspected without a live API call.

### Phase 1 — Foundation and safe image vertical slice

- Scaffold Next.js/TypeScript, Drizzle/SQLite migrations, Docker, Compose, configuration validation, safe logging, and health/readiness routes.
- Implement review creation and image ingest/encryption/preview/purge.
- Implement server-only OpenAI connectivity/capability test.
- Send one sanitised image through live D1 with `store: false` and strict output.

**Exit:** one safely retained image reaches a server-side Responses API call, produces a validated D1 artifact, and leaves no raw upload, metadata, Base64 log, or browser-side secret.

### Phase 2 — Review configuration

- Implement versioned taxonomy loading and stable IDs.
- Implement Off/Review/Focus controls, parent bulk actions, presets, context, image order/replacement, and restore-on-reload.

**Exit:** a complete review configuration can be persisted and restored.

### Phase 3 — Full Design Analysis

- Implement worker recovery, progress, retry, cancellation, and idempotency.
- Implement D1–D6, immutable snapshots/versioning, Design Review, and Analysis Detail.
- Run prompt-injection and professional-quality evaluation fixtures.

**Exit:** one or more images produce a coherent, evidence-grounded, criteria-independent Design Review.

### Phase 4 — Criteria workflow

- Implement criterion and judgement CRUD/order controls.
- Implement criteria snapshots and Design Analysis version selection.
- Implement C1–C5, Criteria Review, and rerun semantics.

**Exit:** editing criteria produces a new Criteria Analysis version without changing the selected Design Analysis.

### Phase 5 — Completion and hardening

- Implement deterministic Integrated Review, Markdown/JSON export, automatic retention sweeps, review close/delete flows, safe diagnostics, and complete error recovery.
- Complete browser/accessibility tests, privacy tests, evaluation thresholds, Docker/LAN documentation, limitations, and the 24-item acceptance matrix.

**Exit:** every MVP acceptance criterion has an automated test or a documented manual deployment check.

## 12. Test and evaluation gates

### Automated test layers

- **Unit:** taxonomy transitions, ordering, schemas, semantic references, version allocation, prompt construction, retry classification, redaction, retention state, export formatting.
- **Image:** EXIF/GPS and orientation removal, corrupt/polyglot inputs, Unicode/path/XSS filenames, animated WebP, excessive pixels, and metadata-free outbound bytes.
- **Integration:** every D/C failure point, refusal, 429/5xx/timeout, invalid and semantically invalid output, restart/resume, double submit, concurrent edit, purge/run race, purged-image rerun, DB lock/disk failure, and response-received-before-persist crash.
- **Privacy/security:** outbound `store: false`, no secrets or image bodies in logs/browser bundles/exports, same-origin enforcement, CSP, stored-XSS protection, and prompt-injection fixtures.
- **E2E/accessibility:** full Design then Criteria workflow, multiple images, no context, custom/no judgement statements, version switching, keyboard-only three-state controls and reordering, progress, retry, purge, and export.

### Professional evaluation harness

Keep private learner work out of the repository. Use approved local or synthetic/openly licensed fixtures with reviewer-authored expected observations and plausible alternatives. Track:

- unsupported-claim and high-confidence-error rates;
- evidence specificity and referential accuracy;
- false-positive criticism;
- repeated-run stability;
- Focus sensitivity without blindness elsewhere;
- context-confirmation-bias delta;
- rubric discrimination and insufficient-evidence calibration;
- adversarial-pass value added;
- per-stage latency and token usage.

Quality, latency, and cost thresholds must be agreed before substituting cheaper models, reducing image detail, making a stage text-only, or sharding criteria.

## 13. Product-owner decisions needed before production defaults

These decisions do not block Phase 0 scaffolding, but they must be recorded before the affected feature is considered complete:

1. **Automatic image expiry:** choose the visible default duration for Mode A. The implementation should not hide or invent a production retention period.
2. **LAN trust:** confirm that unauthenticated access by every device on the configured trusted LAN is accepted. Otherwise approve a lightweight installation access token as a scope change; this is not a user-account system.
3. **Operational budgets:** approve maximum images, per-image bytes/megapixels, aggregate upload size, text/rubric lengths and counts, API/pass/run timeouts, retries, queue depth, and token budgets.
4. **Model budget:** approve the initial quality/cost evaluation pair and whether actual token usage should be shown in the UI.
5. **Settings precedence:** confirm whether non-secret environment values lock model/retention settings or only seed editable database settings. API keys remain environment/secret-only in either case.
6. **Original filenames:** confirm whether locally displayed filenames may be persisted/exported; filenames can contain identifying information. The privacy-first recommendation is to persist a user-editable display name and omit it from exports by default.

## 14. Definition of ready for coding

Development can start when:

- this plan is accepted as the implementation baseline;
- Phase 0 choices are recorded in a decision log;
- the repository scaffold is authorised;
- test-only image fixtures contain no private learner material;
- a development OpenAI API project/key is available when the live D1 milestone is reached.

Until then, the safest next action is Phase 0 only: scaffold the project, encode the state/domain/pass contracts, and build the fake-gateway test harness without making live OpenAI calls.
