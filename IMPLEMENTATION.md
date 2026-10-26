# Rebuild checklist and source audit

This checklist describes the new implementation; no legacy documentation or evaluation output is a specification.

- Source application identified at `/workspace/reference/aetpcr/package.json`; source remains reference material.
- Public routes audited from actual App Router pages: home, news/list and slug detail, events/list and ID detail, team, login, admin dashboard/news/events/team, and the existing coming-soon route.
- UI inventory: navy/blue/white public layout, hero/product preview, three persona cards, workflow/community/map/footer; responsive navigation; chat history/streaming/attachments/rich answers; protected content forms.
- Asset inventory: local Plus Jakarta Sans WOFF2 with its license, favicon, and byte-identical source document copies. Rebuilt source keeps one document under `apps/web/public/AETPCR.docx`.
- Data audit: one published news article, one publicly visible event, one team member. Export records to clean JSON, preserve Markdown/IDs/slugs/timestamps/image URLs, and import into PostgreSQL with verified idempotent upserts.
- Date convention: preserve UTC instants from epoch milliseconds; display/edit events using Asia/Jakarta. Legacy event visibility maps to `published:true` because the old public page listed all events.
- External images: all three original Vercel Blob requests were blocked by the current proxy with 403; availability is unknown. Keep valid source URLs with graceful UI fallbacks.
- Architecture: npm workspaces, static Next.js export, separate Fastify/Prisma/PostgreSQL API, shared validated contracts. No runtime API route or secret in the web application.
- Static details: route-key-only manifest, explicit API synchronization, actionable unavailable-data failure, deliberate seed-only offline option, runtime publication enforcement, rebuild required for new/renamed keys.
- AI: clean task-aware default-on router, bounded strategy/tools/checks, safe typed streaming/cancellation, fixed backend Sumopod endpoint/key, explicit authenticated manual model test, mocked automated tests.
- Delivery checks: typecheck, lint, fresh unit/component/integration tests, API build, webpack static build, route/asset/document/export and secret checks. Record actual commands/results in the final validation report; do not infer success from this checklist.
