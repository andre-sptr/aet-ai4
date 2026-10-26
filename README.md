# AET AI

A clean rebuild of the AET PCR website and its three AI workspaces. The Indonesian content, AET blue/navy appearance, existing public URLs, local Plus Jakarta Sans font, favicon, and document are based on the supplied application. Its source, Git history, old documentation, benchmarks, and SQLite runtime were not reused as the new implementation.

The website is a **static Next.js export**. A separate Fastify API handles authentication, PostgreSQL content, uploads, document extraction, tools, and Sumopod requests. A deployed frontend does not need a Next.js server.

```text
apps/web/              Next.js App Router → out/ static files
apps/api/              Fastify + Prisma/PostgreSQL, sessions, CMS, AI
packages/contracts/    Shared validated browser/API contracts
data/                  Audited legacy content and route-key manifest
scripts/               Environment loading, migrations, import, route/export checks
```

The frontend baseline is Next.js **16.4.2**, React/React DOM **19.3.1**, TypeScript **5.9.3**, Tailwind/PostCSS **4.3.3**, and Lucide React **1.60.0**. Use the installed Node.js **24** runtime and npm. Node 24 satisfies the requested minimum and gives this workspace one consistent runtime for the native Node tooling, CLI, tests, and API. The lockfile records the installed dependency tree.

## Local development

1. From the project root, run `npm ci` and copy `.env.example` to the ignored `.env`.
2. Set the five core values described below. Start a dedicated PostgreSQL database.
3. Run `npm run db:generate`, `npm run db:migrate`, and `npm run seed`.
4. Run `npm run admin:create` and enter the first administrator's username and password interactively. No admin password is stored in the environment example or source.
5. Run `npm run dev` to start the web/API development processes. The separate commands are `npm run dev:web` and `npm run dev:api`.

The root environment loader is used by local API commands and frontend builds. Keep real `.env` files out of source control. PostgreSQL and provider authentication are backend responsibilities. The SQL migration runner records applied migration names and SHA-256 checksums in `_aet_migrations`, uses a PostgreSQL advisory lock, and rejects edits to already applied migrations; it does not use a native Prisma migration-engine download or bypass schema checks.

| Core setting | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Public API base URL compiled into the browser build; the only required browser-visible variable. |
| `DATABASE_URL` | Backend PostgreSQL connection string. |
| `SESSION_SECRET` | Backend random session-signing secret, at least 32 characters; generate securely outside source control. |
| `SUMOPOD_API_KEY` | One backend Sumopod key. Leave empty for development with mocks; live generation will report unavailable. |
| `APP_ORIGIN` | Exact permitted frontend origin, including scheme and port. Multiple intentional origins may be comma separated. |

There is no browser API-key field, routing enable switch, model unlock process, or application credit system. Optional storage, search, cookie, and rebuild settings are documented separately in [DEPLOYMENT.md](DEPLOYMENT.md).

## Features and routes

Public routes are `/`, `/news/`, `/news/[slug]/`, `/events/`, `/events/[id]/`, `/team/`, and `/login/`. The old event directory was named `[slug]`, but its actual database lookup used the event ID; the public ID URL is preserved. Protected admin screens include `/admin/`, `/admin/news/`, `/admin/events/`, `/admin/team/`, and `/admin/ai/`.

The chat personas are Smart Companion, Academic Writer, and Coding Expert. Fast, Normal, and Think change task classification, model choice when compatible alternatives are configured, and bounded processing strategy. Adaptive routing runs for normal requests by default; it does not depend on benchmark files or an enable flag. Server-side model candidates and their conservative capabilities live together in `apps/api/src/ai/models.ts`. Catalog entries are configuration candidates, not proof that the operator's Sumopod account supports them. The administrator can explicitly test a model ID and prompt in the model-test panel using the configured backend key. No live request runs during install, build, or automated tests.

History stays in the browser. Partial or cancelled responses are not treated as completed answers, and raw image base64 is not retained in local history. The separate API extracts supported documents and validates attachment bytes, sizes, and MIME types. Optional tools report when a required integration is unavailable; source citations are not invented.

## Content and static detail routes

`data/legacy-content.json` deliberately exports exactly **one published news article, one public event, and one team member** from the supplied SQLite database. IDs, Markdown, original image URLs, timestamps, and the existing news slug (including its double hyphen) are preserved. `npm run seed` uses idempotent upserts and verifies imported fields and counts; repeating it retains unrelated records. It updates the three imported records to the audited source values, so use it deliberately after editing those records in the CMS.

SQLite timestamps were epoch milliseconds. The import uses UTC ISO timestamps without changing the instant. Event display/editing uses `Asia/Jakarta`; FESTRON starts at **20 January 2026, 08:00 WIB** and ends at **21 January 2026, 16:00 WIB**, as represented by the original data. The legacy event had no publication flag; it was publicly listed, so its imported publication state is `true`.

Before a frontend build, `npm run sync:routes` fetches the API's public news/events and atomically saves **route keys only** in `data/routes.json`. Unavailable or invalid route data fails with an actionable error. No article body is embedded in those exported detail pages: the browser requests the current published record, and the API returns not found for deleted/unpublished records.

`npm run build:web` synchronizes routes, runs `next build --webpack`, then checks the export. New or renamed detail URLs require rebuilding and redeploying the frontend. Deleting or unpublishing content removes API access immediately, even if a stale HTML shell remains cached. A manually selected seed-only manifest can be generated with `npm run sync:routes -- --from-seed`; it is not a silent substitute for the current CMS state. See deployment instructions for a deliberate offline build.

`AETPCR.docx` has one canonical source copy: `apps/web/public/AETPCR.docx`. Links use `/AETPCR.docx`; the static output contains `apps/web/out/AETPCR.docx`. The exported copy is checked against the source bytes.

The three imported external images use the original Vercel Blob host. Requests during the audit received a network-proxy **403**, so availability could not be established; this is not proof the files have been removed. Their original URLs remain, and the UI supplies graceful image fallbacks. The map and official social/organization links come from the actual source UI rather than fabricated content. Read-only checks of the official website, Instagram, YouTube, and Facebook links were also blocked by the proxy, so they require validation from a deployment network that permits those destinations.

## Checks and production output

```sh
npm run typecheck
npm run lint
npm test
npm run build:api
npm run build:web
npm run verify:export
```

Automated provider tests use mocks. Use an isolated/disposable PostgreSQL database for integration tests, never production content. The export verifier checks required routes and local assets, the canonical document, frontend/backend separation, and configured secret values. These commands describe the supported workflow; the completion report records which checks were actually executed and their results.

The executed results are recorded in [VALIDATION.md](VALIDATION.md): 80 tests passed with a disposable PostgreSQL database, plus 14 public/chat and 8 admin browser checks. Browser entry points are `npm run test:browser` and `npm run test:browser:admin`; serve the static export and API first. Admin browser checks additionally require `AET_TEST_DATABASE_URL` for a local database ending in `_test` and `AET_TEST_DISPOSABLE_DB=true`; they use temporary identities and provider/storage fixtures and clean up their own records.

### Windows command startup

The project wrappers invoke the npm, TSX, and Prisma JavaScript entry points through the current Node executable. They do not depend on launching Windows `.cmd` shims directly or enabling a shell. If an older checkout reports `spawn npm/tsx/prisma ENOENT`, pull the fix, run `npm ci`, then rerun `npm run db:generate` before the API build. Missing `PrismaClient` exports after failed generation are a consequence of the ungenerated client. Run setup commands in order and stop if one fails. For an existing local Docker container use `docker start aet-postgres`; `docker run --name aet-postgres ...` creates it only once.

Deploy **only `apps/web/out/`** to a static host and run the compiled API as a separate service connected to PostgreSQL. See [DEPLOYMENT.md](DEPLOYMENT.md) and [API.md](API.md) for the deployment and HTTP contracts.
