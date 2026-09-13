# Campaign Operating Workspace

A structured campaign planning app centered on audience engagement maps, progressive planning, portfolio coordination, and governed campaign naming and links.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Web app: `artifacts/campaign-workspace`
- API routes: `artifacts/api-server/src/routes/campaigns.ts`
- API contract: `lib/api-spec/openapi.yaml`
- Database schema: `lib/db/src/schema/campaign.ts`

## Architecture decisions

- Engagement-map connections are persisted domain rules, not presentation-only edges.
- Campaign creation saves after four questions and generates an initial audience-to-outcome map.
- Regional campaigns remain linked to their global parent through inheritance metadata.
- Conflict detection is deterministic; optional AI only proposes changes requiring explicit acceptance.
- Published UTM values are immutable records tied to the taxonomy version that generated them.

## Product

- Plan campaigns using a persistent React Flow audience engagement map.
- Manage strategy, timing, delivery, generated UTM links, and presentation views.
- Coordinate global and regional campaigns through a portfolio and conflict center.
- Govern activity types, readable taxonomy terms, naming conventions, and tracking links.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
