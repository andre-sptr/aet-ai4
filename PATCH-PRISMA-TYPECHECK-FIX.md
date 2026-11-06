# Patch: Prisma repository typecheck

## Files changed
- `apps/api/src/repository.ts`

## What changed
- Replaced `Parameters<typeof db.<model>.<operation>>[0]['data']` casts with explicit Prisma input types:
  - `Prisma.NewsUncheckedCreateInput`
  - `Prisma.NewsUncheckedUpdateInput`
  - `Prisma.EventUncheckedCreateInput`
  - `Prisma.EventUncheckedUpdateInput`
  - `Prisma.TeamMemberUncheckedCreateInput`
  - `Prisma.TeamMemberUncheckedUpdateInput`
- This avoids extracting the parameter type from Prisma's generic delegate methods, which can resolve to `unknown`.
- Kept `socials: null` semantics as SQL NULL via Prisma's `DbNull` sentinel.
- Added a clear runtime error if the generated Prisma Client does not expose `DbNull`, rather than silently omitting the field.

## Required steps on Windows

Run from the project root in PowerShell:

```powershell
npm ci
npm run db:generate
npm run typecheck
npm test
```

`npm run db:generate` is important after installing dependencies or changing `apps/api/prisma/schema.prisma`. It regenerates the Prisma Client from the schema used by this repository.

If `npm run db:generate` reports a missing `DATABASE_URL`, ensure the project's normal `.env` is present and contains the configured database URL. Prisma generation normally does not connect to the database, but the repository's environment wrapper loads `.env`.

## Scope and safety
- No Prisma schema changes.
- No database migration.
- No API/SSE contract changes.
- No routing or orchestration behavior changes.
- No frontend changes.
- The fix only corrects Prisma type usage in the existing repository adapter.

## Validation status
The uploaded environment did not have a complete `node_modules` installation. An attempted `npm ci` timed out and left an incomplete dependency tree; consequently, a full TypeScript build and test run could not be completed here. The patch is source-level and should be validated using the commands above in the user's Node.js 24 environment.
