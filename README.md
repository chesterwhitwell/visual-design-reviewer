# Visual Design Reviewer

A privacy-conscious, self-hosted web application for structured visual design review. It accepts JPEG, PNG, and WebP work, runs an auditable multi-pass Design Analysis, optionally evaluates user-authored criteria, and exports completed results as Markdown or JSON.

The application is designed for one trusted user on a local machine or trusted LAN. It is not an internet-facing multi-user service.

## What is included

- A Next.js 16 and TypeScript interface for review setup, image ordering and purpose tagging, taxonomy selection, criteria, analysis progress, and results.
- Server-side OpenAI Responses API calls with structured output validation and `store: false`.
- A six-pass Design Analysis and five-pass Criteria Analysis with immutable snapshots, bounded validation retries, and per-pass provenance.
- Strict JPEG, PNG, and WebP validation; orientation normalisation; metadata removal; and safe previews.
- AES-256-GCM encryption for retained, sanitised images and previews.
- SQLite persistence with idempotent Drizzle migrations.
- A reusable assessment-criteria library with versioned JSON import and export.
- Optional single-administrator password authentication with revocable sessions.
- Per-pass token metering, immutable USD price snapshots, and local cost estimates.
- A protected administration page for configuration, usage, storage, and diagnostics.
- Deterministic Integrated Review and completed-artifact Markdown/JSON exports. Neither adds another model call.
- A non-root, read-only Docker runtime with a persistent data volume.

## Requirements

For local development:

- Node.js 24
- npm 11 or a compatible npm release
- OpenSSL, for generating the image-encryption key
- An OpenAI API project and key for live analysis

For container deployment, Docker Engine with Docker Compose is sufficient.

## Local setup

1. Create the local environment file:

   ```sh
   cp .env.example .env
   ```

2. Generate an encryption key:

   ```sh
   openssl rand -base64 32
   ```

   Put the complete output in `IMAGE_ENCRYPTION_KEY`. It must decode to exactly 32 bytes. Keep this key stable and backed up separately from the database: changing or losing it makes retained images unreadable. Completed textual analyses remain usable.

3. Add the required OpenAI settings to `.env`:

   ```dotenv
   OPENAI_API_KEY=your_server_side_key
   OPENAI_VISION_MODEL=gpt-5.6-terra
   OPENAI_SYNTHESIS_MODEL=gpt-5.6-terra
   ```

   `gpt-5.6-terra` is a reasonable balanced starting point. Model access and rate limits depend on the API project, so use the Settings page connection test before analysis. The model IDs are configuration, not domain logic. OpenAI's current model guidance describes Sol as the flagship tier, Terra as the intelligence/cost balance, and Luna for cost-sensitive high-volume work: [OpenAI model documentation](https://developers.openai.com/api/docs/models).

4. Install dependencies and initialise the database:

   ```sh
   npm install
   npm run db:migrate
   ```

5. Start the development server:

   ```sh
   npm run dev
   ```

6. Open <http://127.0.0.1:3080>. Visit **Settings** first to confirm that the API key, both models, and image-encryption key are present, then run the live connection test.

The application also applies pending migrations on its first database access. Running `npm run db:migrate` explicitly makes setup failures easier to diagnose.

## Docker setup

1. Copy `.env.example` to `.env`, generate `IMAGE_ENCRYPTION_KEY`, and configure the OpenAI values as described above.

2. Build and start the service:

   ```sh
   docker compose up --build -d
   ```

3. Open <http://127.0.0.1:3080> and check the Settings page.

The Compose deployment:

- stores SQLite files and encrypted images in the `reviewer-data` volume;
- mounts `config/review-taxonomy.v1.json` read-only;
- starts as an unprivileged user with all Linux capabilities dropped;
- uses a read-only container filesystem, with `/app/data` and `/tmp` as the intended writable locations;
- includes the taxonomy and database migration files in the standalone image; and
- runs a health check against `/api/health`.

To watch startup or migration failures:

```sh
docker compose logs -f reviewer
```

Stop the application without deleting its data:

```sh
docker compose down
```

Do not use `docker compose down --volumes` unless permanent removal of the database and encrypted image store is intended.

## Trusted LAN access

The server listens on port `3080`. To open it from another device, add the Docker host's IP address or local DNS name to `ALLOWED_HOSTS`, for example:

```dotenv
ALLOWED_HOSTS=localhost,127.0.0.1,[::1],192.168.1.20,design-review.local
```

Restart the process or container after changing `.env`. Host validation is a defence-in-depth check, not authentication. The application has no TLS termination and its default authentication mode is disabled, so restrict port `3080` with the host firewall and network configuration. Do not publish an unauthenticated instance directly to the internet. If broader access is required, enable password authentication and put it behind an HTTPS reverse proxy.

## Password authentication

Authentication is disabled by default for compatibility with trusted local installations. To enable the single-administrator password mode, generate a password hash and random session secret:

```sh
npm run auth:setup
```

The password prompt does not echo typed characters. Copy the generated `AUTH_*` values into `.env` or the Unraid container variables and restart the service. For a prebuilt container, the same generator is included in the image:

```sh
docker run --rm -it --entrypoint node chesterwhitwell/visual-design-reviewer:latest \
  scripts/generate-auth.mjs
```

Password mode uses a salted scrypt password hash and random, signed, database-backed sessions. Session cookies are `HttpOnly` and `SameSite=Lax`; `AUTH_COOKIE_SECURE=auto` adds the `Secure` attribute when the request is served through HTTPS. The Administration page can revoke every active session.

Direct HTTP does not encrypt a password or session while it crosses the network. Use only a trusted LAN for HTTP. For remote or less-trusted access, place the application behind an HTTPS reverse proxy, preserve the original `Host`, replace `X-Forwarded-Proto` and `X-Forwarded-For`, set `AUTH_TRUST_PROXY_HEADERS=true`, and keep the public hostname in `ALLOWED_HOSTS`. Never enable proxy-header trust when clients can connect directly to the application port.

Google or other OpenID Connect login is not implemented yet. The current session records include a provider boundary so an OIDC adapter can be added later without changing review ownership; this remains a shared, single-administrator installation rather than a multi-tenant service.

## OpenAI model and data configuration

The main model settings are:

| Variable | Purpose |
| --- | --- |
| `OPENAI_VISION_MODEL` | Image-input model used by passes that inspect the supplied work. |
| `OPENAI_SYNTHESIS_MODEL` | Model used by text-only adjudication and synthesis passes. |
| `OPENAI_IMAGE_DETAIL` | `low`, `auto`, `high`, or `original`, subject to model support. |
| `OPENAI_REASONING_EFFORT` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`, subject to model support. |
| `MODEL_REQUEST_TIMEOUT_MS` | Timeout for one model request. |
| `MODEL_SCHEMA_RETRIES` | Bounded retries after invalid structured output. |
| `MAX_OUTPUT_TOKENS_PER_PASS` | Server-enforced output cap for each pass. |
| `ANALYSIS_LEASE_MS` | Lease duration used by the durable local analysis worker. |

Keep `OPENAI_API_KEY` server-side and never rename it with a `NEXT_PUBLIC_` prefix. The browser receives only a boolean indicating whether a key is configured.

Every analysis request explicitly sets `store: false`. That setting is not the same as Zero Data Retention. OpenAI states that standard API abuse-monitoring logs may contain customer content and are retained for up to 30 days by default; Zero Data Retention and Modified Abuse Monitoring require eligibility and prior approval. `OPENAI_DATA_MODE=zdr` is only an installation label and cannot verify the organisation or project setting. Review the current [OpenAI API data controls documentation](https://developers.openai.com/api/docs/guides/your-data) before submitting sensitive material.

Images are sent to the configured OpenAI model for analysis. The local encryption described below protects data at rest on this installation; it does not make the model call local or offline.

## Token usage and cost estimates

Every OpenAI response records input, cached input, cache-write input, output, reasoning-output, and total tokens when the provider returns them. Usage is retained for successful and unsuccessful attempts, including retries after schema or semantic validation failures. Requests that fail before a provider response may have no usage metadata.

The bundled `config/openai-pricing.v1.json` catalogue contains versioned USD rates for supported model IDs. The application copies the applicable rate and multiplier snapshot into each attempt, so later catalogue changes do not rewrite historical estimates. Unknown models remain visibly unpriced. The Administration page shows lifetime totals and model breakdowns, while completed analysis provenance shows per-pass tokens and estimated cost.

These values are local estimates rather than an OpenAI invoice. Credits, tax, account-specific terms, future pricing changes, and usage from other applications are outside this calculation. Review the source and effective date in the pricing catalogue before relying on the totals.

## Administration and diagnostics

Select the gear in the application header to open `/admin`. It reports configuration readiness, authentication and HTTPS warnings, run state, recent safe failures, database and encrypted-storage sizes, retention state, token usage, and estimated cost. From this page an administrator can test OpenAI, run a bounded retention sweep, run SQLite `quick_check`, revoke all sessions, or download a redacted diagnostics JSON file.

Diagnostics never include API keys, encryption keys, password hashes, session tokens, images, prompts, or raw model responses. `/api/health` remains a deliberately minimal unauthenticated container liveness endpoint.

## Final work and development evidence

Every uploaded image has an analysis purpose. New uploads and images created before this feature default to **Final work**. In the Image workspace, select an image and change its purpose to **Concept & development** when it shows exploration, alternatives, iteration, testing, or refinement. Thumbnail badges and the captured counts make the distinction visible without relying on colour.

Design Analysis requires at least one retained Final work image. Development images are treated as process evidence rather than unfinished final outcomes: the review assesses visible exploration and refinement, then relates supported decisions to the final work. A relationship claim must be grounded in evidence from both image purposes. The displayed image order supplies the development sequence, but the analysis does not invent chronology or intent beyond the submitted evidence.

Criteria Analysis uses the image-purpose assignments captured by its selected Design Analysis. Outcome-focused criteria primarily use Final work; process-focused criteria use Concept & development evidence; mixed criteria can use both. When a criterion describes process but no development evidence was supplied, the analysis must preserve insufficient evidence rather than infer a process from the final result. Retagging or reordering images creates a new immutable input revision and never rewrites completed analyses. Run a new Design Analysis to use changed image-purpose assignments.

## Image lifecycle, retention, and purge

On upload, the server validates the real container format, rejects unsupported or animated/polyglot content, normalises orientation, strips metadata, and creates sanitised analysis and preview representations. Raw upload bytes are not retained after processing. The sanitised representations are encrypted separately with AES-256-GCM before being written to `IMAGE_STORAGE_PATH`.

`IMAGE_RETENTION_HOURS` controls whether new image records receive an expiry time:

- leave it blank for manual purge only;
- set a positive number of hours to record a visible expiry time for each new upload.

The server runs a bounded retention sweep at startup and opportunistically on health requests. Interrupted `purge_pending` work is always reconciled; when `IMAGE_RETENTION_HOURS` is configured, expired retained images are claimed as well. Use **Purge retained images** in the review workspace when evidence should be removed sooner. A database-atomic claim prevents purge while a queued or running analysis references an image and prevents new analysis work from using an image once purge begins. Purge removes both encrypted analysis and preview blobs before clearing their locators; completed structured analyses and exports remain available.

Use **Delete review** in the review header, or the trash action on a review card on the opening page, to permanently remove a review, its current and historical encrypted image/preview blobs, criteria, analysis attempts, results, and version history. The interface requires explicit confirmation, and deletion is refused while analysis is queued or running. Files are purged before database records are removed, so an interrupted or failed deletion leaves a closed review that can be retried without orphaning known ciphertext. Deletion cannot retract exports already downloaded or copies retained by host-level backups.

Deletion is cryptographic and best effort. The application cannot guarantee physical erasure from SSD remapping, filesystem snapshots, host backups, or copies of the Docker volume. Backup and disposal procedures must account for those layers.

## Reusable criteria sets

Select **Manage criteria sets** on the opening page to build a set from scratch in the editable draft, load and revise saved sets, update or rename them, and import or export a portable JSON document. The same library is available from the Assessment criteria section of each review, where a set can replace or append to that review's criteria editor.

Loading a set creates fresh review-local criterion and judgement-statement IDs and leaves the editor in an unsaved state. Select **Save criteria** after checking the result. Later changes to a saved set never alter reviews or immutable Criteria Analysis snapshots that previously used it.

Criteria-set exports use the strict `visual-design-reviewer.criteria-set` format at schema version `1.0.0`. They contain names, descriptions, criterion wording, assessor notes, and ordered judgement statements, but no review IDs, analysis results, images, or timestamps. Imports are bounded by the configured criteria and judgement limits. Name collisions require an explicit replace or renamed-copy decision.

## Exports

Completed results can be downloaded from the Results workspace as:

- Markdown: a human-readable report with review metadata, captured image purposes and context, version/provenance information, Design Review, Criteria Review, and the deterministic Integrated Review when a matching pair exists;
- JSON: the validated Design and Criteria domain artifacts, their schema/prompt-set versions, and the deterministic relationship view.

Exports are built only from persisted completed artifacts and do not make model calls. They do not embed source images or stored filenames. Download responses are attachments with private, no-store cache headers. Persisted free text is escaped in Markdown so it is treated as report content rather than executable markup.

By default, an export uses the newest Criteria Analysis and its exact source Design Analysis; if no Criteria Analysis exists, it uses the newest Design Analysis. The UI passes explicit artifact IDs when a historical version is selected. The endpoint is also available directly:

```text
GET /api/reviews/:reviewId/exports/markdown
GET /api/reviews/:reviewId/exports/json
GET /api/reviews/:reviewId/exports/json?designAnalysisId=...&criteriaAnalysisId=...
```

## Database and taxonomy

Local defaults:

```text
data/reviewer.db
data/images/
config/review-taxonomy.v1.json
```

`DATABASE_PATH` and `IMAGE_STORAGE_PATH` can be changed in `.env`. In Docker, Compose overrides them to `/app/data/reviewer.db` and `/app/data/images` inside the persistent volume.

The taxonomy file is versioned and schema validated at runtime. Preserve existing taxonomy versions used by completed artifacts when customising it. Analysis snapshots retain the selected area labels and taxonomy version so historical results do not silently change when current configuration changes.

Back up the SQLite database, encrypted image directory, taxonomy file, and encryption key according to the installation's recovery requirements. Store the encryption key separately from the data backup.

## Development commands

```sh
npm run dev          # development server on port 3080
npm run db:migrate   # apply pending SQLite migrations
npm run auth:setup   # generate password-authentication environment values
npm run lint         # ESLint and Next.js rules
npm run typecheck    # TypeScript without emission
npm test             # unit and integration tests
npm run test:e2e     # Playwright tests, when browser fixtures are configured
npm run build        # production standalone build
npm run check        # lint, typecheck, tests, and production build
```

Generated migrations live in `lib/db/migrations`. When the schema deliberately changes, update the migration with `npm run db:generate`, inspect it, and test both a new database and an existing database upgrade.

## Operational limits

The `.env.example` file documents the server-enforced defaults for image count, individual and aggregate upload bytes, dimensions, decoded pixels, sanitised output, previews, context, criteria, judgements, request timeouts, retries, and output tokens. Tighten these for smaller hosts. Raising them increases memory usage, model input size, latency, and cost.

## Current limitations

- Password mode protects one shared administrator workspace; it does not provide per-user ownership, roles, collaboration, or tenant isolation. Google/OIDC login is not implemented yet.
- Analysis requires network access to OpenAI and valid project access to both configured models; it is not an offline evaluator.
- The explicit `fake` gateway is test-only and cannot create saved review findings.
- Automatic expiry is opportunistic rather than scheduled: startup and health requests run bounded sweeps, so installations that disable health polling should invoke the health endpoint or restart the service after expiries become due.
- JPEG, PNG, and WebP are supported. PDF, SVG, GIF, video, animated WebP, and multi-page media are rejected.
- The Integrated Review is deterministic. It connects recorded criterion relationships and finding references but adds no new interpretation.
- Markdown and JSON exports include completed structured analyses only; failed, cancelled, queued, and running passes are deliberately excluded.
- Secure deletion cannot guarantee erasure from storage snapshots, backups, or device-level remapping.
- Availability, latency, rate limits, feature support, and cost remain properties of the configured OpenAI project and model.
- Displayed API costs are local USD estimates from captured token usage and versioned configured rates, not provider invoices.
