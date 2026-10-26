# Deploy the static website and separate API

Use a static host for `apps/web/out/`, a Node.js 24 service for the API, and persistent PostgreSQL. The API does not require the old SQLite database. Files created in a local API container are not persistent upload storage.

## API

1. Supply the backend `DATABASE_URL`, a strong `SESSION_SECRET`, the intended `APP_ORIGIN`, and the operator's `SUMOPOD_API_KEY`. Do not inject them into the web build. Leave the provider key empty only when live generation is intentionally unavailable.
2. Install the lockfile with `npm ci`; generate Prisma with `npm run db:generate`; build with `npm run build:api`.
3. Apply the fresh SQL migrations with `npm run db:migrate`. The runner stores names and SHA-256 checksums in `_aet_migrations`, uses an advisory lock, and rejects changes to applied migration files. This is the project's SQL migration command; do not substitute `prisma migrate deploy` and assume its separate tracking table already exists. Run `npm run seed` once when importing the audited source records; repeating the import is idempotent but restores those records' original content.
4. Create the initial administrator with `npm run admin:create` through a secure terminal. The CLI hashes the password; there are no default admin credentials.
5. Start the compiled API with `NODE_ENV=production npm run start --workspace=@aet/api` (or set `NODE_ENV=production` in the service configuration before running its start command). This activates Secure host-only cookies and production headers; do not rely on a host to set the mode implicitly. Keep the process supervised. Terminate HTTPS at the service or a trusted proxy and make the public API origin accessible to browsers.
6. Verify `GET /health`, public content endpoints, login/logout, protected authorization failures, and credentialed CORS using the deployed frontend origin.

The API permits only the exact origins in `APP_ORIGIN`; it does not use wildcard CORS with credentials. Browser requests include credentials. Session cookies are HttpOnly, signed, expiring, and Secure in production. The default SameSite policy is Lax. Prefer frontend/API domains under the same site, such as `www.example.com` and `api.example.com`. A truly cross-site deployment may need the optional backend `COOKIE_SAME_SITE=none`, HTTPS, and browsers that permit the cookie; third-party-cookie restrictions can still block it. Do not weaken origin/CSRF checks to work around a hosting mismatch.

## Frontend

1. Set **only** `NEXT_PUBLIC_API_BASE_URL` for the browser build, pointing to the deployed API. This setting is compiled into static files, so changing it requires a rebuild.
2. With the public API available, run `npm run build:web`. The route synchronization must succeed. Do not silently reuse a stale manifest if the API is unavailable.
3. Publish the complete `apps/web/out/` directory. Preserve directories and trailing-slash routes; serve `news/<slug>/index.html` and `events/<id>/index.html` at their matching paths. Use the exported 404 page for unknown paths. No Next.js production server, API rewrites, or server actions are required.
4. Test public lists/details, admin authentication, chat streaming/cancellation, the document download, and mobile navigation against the deployed API. Check the browser console and network panel for blocked origins or mixed content.

If building deliberately from the audited source content without an API connection, run `npm run sync:routes -- --from-seed`, build the contracts, run the web workspace's build through `scripts/with-env.mjs`, and run `npm run verify:export`. This includes only the audited seed route keys, not subsequent CMS changes. It never substitutes for testing runtime API connectivity.

### Headers at the static host

Next.js static export cannot add runtime response headers. Set these at the hosting layer:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: camera=(self), microphone=(), geolocation=()
```

Add a Content Security Policy appropriate to the deployed domains. A starting policy is below; replace the API origin and narrow image hosts to the storage providers actually used. Next's exported bootstrap includes inline scripts, so a stricter script policy requires hashing the build's exact inline scripts at deployment time.

```text
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https://api.example.com; frame-src https://www.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Serve HTML with revalidation or a short cache lifetime. Hashed `/_next/static/` assets can be cached immutably. Keep the current document and all exported asset paths in the release.

## CMS changes and detail URL rebuilds

Lists fetch current public API content. Detail HTML shells exist only for keys generated at build time. Creating a news article/event, renaming a news slug, or changing a route key requires a new frontend build/deployment. Ordinary edits to an existing detail body are fetched from the API without embedding stale body text in exported HTML. Deleted/unpublished records are rejected by the public API even if an old HTML shell survives in a CDN or browser cache.

An optional backend-only `STATIC_REBUILD_HOOK_URL` may notify the host after CMS changes. Configure an HTTPS URL under the operator's control; keep any hook authentication embedded in that server-side URL private. It is disabled when absent, and failures must not prevent ordinary CMS writes. If a hook is not configured, rebuild manually. A hook invocation does not prove a deployment succeeded.

## Optional integrations

These settings do not belong in the five-value default `.env.example`:

| Backend-only setting | Enables |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Persistent Vercel Blob image uploads through the storage adapter. Without it, upload returns an honest unavailable error; URL-based images remain usable. |
| `TAVILY_API_KEY` | Optional live web search. Without it, search is unavailable and results/citations are never fabricated. |
| `STATIC_REBUILD_HOOK_URL` | Optional post-CMS static rebuild notification. |
| `COOKIE_SAME_SITE` | Cookie policy override when the chosen deployment requires it; cross-site `none` requires HTTPS production. |
| `PORT` | API listener port when the service requires a different port. |

Sumopod uses a fixed server-side endpoint and one `SUMOPOD_API_KEY`. Edit the small server model catalog to match the account, then use the authenticated manual model-test screen. No live test, benchmark, pricing job, or application credit workflow runs automatically. Provider-side account limits are managed outside this application.

## Operational checks

- Keep PostgreSQL backups and apply migrations deliberately to the intended database.
- Keep production secrets in the hosting environment's secure configuration; never place them in browser-visible variables or static artifacts.
- Review API logs for minimal request/routing/error metadata, without prompts, raw documents, cookies, or provider credentials.
- The built-in limiter is per API instance and uses the direct peer IP; forwarding headers are deliberately not trusted. If deploying multiple instances or behind a reverse proxy, use an edge/shared limiter and an explicitly reviewed proxy policy so client attribution is correct without trusting arbitrary forwarded headers.
- Imported Vercel Blob URLs were blocked by the onboarding network proxy (403); validate their availability from the chosen production host and retain graceful image fallbacks.
- A completed local build does not establish that a production host, account model, storage service, or external credential has been tested.
