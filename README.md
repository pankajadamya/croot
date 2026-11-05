# croot

Multi-tenant review platform for retreat organisers and retreat properties. Guests receive a private
link and share a public story, private feedback, optional photos and, through a separate channel,
anonymous notes. Nothing is published without the guest's explicit per-item consent **and**
organiser approval.

The product specification and screen designs live in `../balance-and-beyond-reviews-design/README.md`.
Balance & Beyond's India Yoga & Pilates Retreat (Oct 2026) is the first tenant.

## Review types

Each review programme (`Retreat` in the schema) has a `kind`:

| | `itinerary`: hosted journey | `property`: retreat venue |
| --- | --- | --- |
| Guests | One cohort who travelled together | Individual guests after their own stays |
| Dates | Retreat start/end (required) | Per-guest `stayStart`/`stayEnd` (private, optional) |
| Public details | Dates, route, itinerary link | Location, address, highlights, website |
| Default categories | Instruction, excursions, transfers, group… | Arrival, room, cleanliness, food, staff, calm… |

One organisation can run both kinds.

## Stack

Mirrors Collab: React 19 + Vite + TypeScript, react-router 7, TanStack Query · Express 5 · Prisma 7
(`@prisma/adapter-pg`) on PostgreSQL · zod · sharp for image processing · Vitest + supertest.
One Node process serves the API and the built SPA (Dockerfile → Coolify on OVH).

## Multi-tenancy

- Shared database; every tenant-owned row carries `organisationId`, and tenant indexes lead with it.
- Admin API lives under `/api/admin/orgs/:orgSlug/*`. `requireOrgMember` resolves the tenant and checks
  membership; handlers fetch parent records only through `server/src/lib/tenant.ts`, so another
  tenant's ids return "not found".
- Public sites: `/o/:orgSlug/r/:programmeSlug`, or a tenant's **custom domain** (`OrgDomain`) serving
  its site at `/`. Invite links use the tenant's domain when one is mapped.
- Onboarding: retreat owners use **Request access** on the landing page → a platform admin approves at
  `/platform` → a one-time owner setup link is shown for manual sharing. There is no organiser self-signup.
- Scaling: stateless API (DB-backed sessions), S3-compatible media storage (`STORAGE_BACKEND=s3`),
  explicit pool limits. For several instances, move rate limits to a shared store
  (`server/src/middleware/rateLimits.ts`). Row-level security can be layered on later without reshaping.

## Sign-in and accounts

- **Guests** need no account. Their unique invitation link opens, saves and resumes a review. They can also sign in
  with an **email code** or **Google** using the address the invitation went to. They then see **My reviews**
  (`/my-reviews`), listing every review addressed to that email.
- **Changing a sent review needs sign-in.** The server rejects edits to an already-sent review unless the session's
  verified email matches the invited guest. Withdrawing permissions or deleting data stays available from the receipt link.
  An edited review that was already published keeps its approved version live, flagged "Updated since published"
  for the organiser.
- **Organisers** are onboarded with one-time setup links from `/platform` (*Create tenant*, or approving a request).
  They sign in with an email code, Google or a password at `/signin`. Self-service organiser sign-up exists but is off
  (`ORG_SIGNUP_ENABLED=false`). When on, new organisations start as *pending* until approved (`SIGNUP_AUTO_APPROVE`).
- Email codes are 6 digits, valid for 10 minutes and single use, and die after 5 wrong attempts. Only an HMAC (`AUTH_SECRET`) is stored.
  Responses never reveal whether an address has an account. Google uses PKCE, state and nonce, and accepts only verified emails.
- In development `EMAIL_PROVIDER=console` prints codes to the API log. Production uses Amazon SES (`EMAIL_PROVIDER=ses`, `SES_*`, the same names as Collab) and requires `AUTH_SECRET`.
- **Where secrets live:** never in this repository. Deployment follows the snaprows-infra pattern used for MyAyurvedaTrip:
  `snaprows-infra/apps/croot-uat/app.yml` describes the app; `apps/croot-uat/generate-secrets.sh` creates the gitignored
  `secrets/CROOT/UAT/croot-uat.env`, which is saved to the Bitwarden folder `CROOT/UAT` and pushed to Coolify by
  `snaprows-ops app apply`. Locally, put them in your own `.env` (gitignored).

## Privacy boundaries (enforced server-side)

- Tokens (invite, receipt, session, setup) are random and stored only as SHA-256 hashes; logs redact them.
- Public endpoints read only `PublicationRevision` snapshots, never `Response` rows.
- Publishing re-checks consent, photo approval and that the excerpt is verbatim.
- Guest withdrawal is immediate (story 410s, photos 404); every change is audited.
- Anonymous notes: separate endpoint mounted before cookie parsing, no attendee/response/invite key,
  stored with the week only, no audit row.
- Organisers can't edit guest words; they "request changes" and the guest resubmits.

## GDPR

See [docs/gdpr.md](docs/gdpr.md) for roles, the record of processing, lawful bases, retention, rights
procedures and the open actions before launch. In short:

- A generated privacy notice for each organisation at `/o/:orgSlug/privacy`, plus platform legal drafts at `/legal/*`.
- Guests can download or delete their data from their receipt page. Owners handle requests under **Workspace → Privacy**.
- Per-organisation retention periods, enforced by `server/src/jobs/retention.ts` (every 6 h, or `npm run retention`).
- Processing-terms acceptance, audited platform-admin access, and organisation export and deletion.

## Local development

No Docker needed. An embedded Postgres (PGlite) runs on port 6432:

```bash
npm install
cp .env.example .env   # then set DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:6432/postgres?sslmode=disable
npx pglite-server --db=./.pglite/dev --port=6432 --max-connections=10   # terminal 1
npm run db:migrate:deploy && npm run db:seed
npm run dev:api        # terminal 2 — API on :6021
npm run dev            # terminal 3 — web on :6020
```

The seed prints sign-ins and invite links (all fictional). It creates Balance & Beyond (itinerary
retreat, mapped to `reviews.balance.localhost`), Demo Mountain Retreats (a property plus a draft
retreat) and a pending access request. To use a real local Postgres instead, point `DATABASE_URL` at it.

## Tests

```bash
npm test
```

This starts a throwaway in-memory PGlite on :6433, migrates it and runs the suites: tenant isolation,
CSRF, consent-gated publishing, private-data leakage, withdrawal, anonymous-note unlinkability, property
stay dates, log redaction and theme contrast. Set `TEST_DATABASE_URL` to use a real Postgres in CI.

## Deployment (not done yet; confirm with the operator first)

Container build → Coolify, runtime-only secrets, `/health/ready` readiness check, migrations at start,
separate database and bucket from Collab/MyAyurvedaTrip, encrypted backups with a tested restore.
See "Decisions to confirm" in the design README before importing real attendee emails.
