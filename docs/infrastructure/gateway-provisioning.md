# Voltessa Gateway Provisioning — Operator Runbook

Status: living document, authoritative for the gateway identity/provisioning workflow. Read this
before enrolling any physical Voltessa Gateway unit. For the remote-management architecture itself
(Headscale control plane, Tailscale client, SSH-over-overlay) see the design record in this
milestone's own history — this document covers only the workflow layered on top of it: how a
physical unit goes from a freshly-flashed Debian image to a `Gateway` row in Voltessa's database,
associated with the organization/plant it serves.

## Prerequisites

- The existing Headscale control plane (`headscale.voltessa.ai`, running on the
  `voltessa-fusionsolar-proxy` Scaleway VM — see `docs/infrastructure/scaleway-production.md`) must
  already be up. This workflow does not stand up any new infrastructure.
- The Headscale user `voltessa-gateways` must already exist (`headscale users create
voltessa-gateways`, a one-time setup step, not part of this per-gateway workflow).
- SSH access to the Scaleway VM (`ssh root@51.15.103.175`) from the machine running these scripts —
  the same access every other operation on that VM already requires.
- A working `DATABASE_URL` (the same one `apps/web` uses in development/production).

## The three-step workflow

Each step is a standalone script under `apps/web/scripts/gateway/`, run from the repo root via
`pnpm tsx`. They are deliberately separate, not one combined command — each corresponds to a real,
distinct moment in a physical unit's life (office prep → physical enrollment → customer
assignment), and each is independently re-runnable/inspectable.

### 1. `provision-gateway.ts` — issue the enrollment credential (run at the office)

```
pnpm tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/gateway/provision-gateway.ts --hostname gw-<name>
```

- Looks up the existing `voltessa-gateways` Headscale user (does not create it).
- Creates a single-use, 1-hour, `tag:gateway`-scoped Headscale preauthkey — never a reusable or
  shared credential (see the Remote Management milestone's security model).
- Creates a `Gateway` row in Postgres: `hostname`, `status: PROVISIONED`.
- Prints the exact `tailscale up --login-server=https://headscale.voltessa.ai --authkey=... --hostname=... --ssh=false`
  command to run once on the physical unit. The key expires in 1 hour — run step 2's prerequisite
  (the physical `tailscale up`) promptly.

### 2. `confirm-enrollment.ts` — correlate the real node (run once the unit is online)

```
pnpm tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/gateway/confirm-enrollment.ts --hostname gw-<name>
```

- Looks up the Headscale node matching that hostname (fails clearly if it hasn't enrolled yet, or
  isn't tagged `tag:gateway`).
- Records the node's real Headscale identity (`headscaleNodeKey`, the actual per-unit cryptographic
  identity; `headscaleNodeId`, an operational convenience) on the `Gateway` row.
- Advances `status` to `ENROLLED`.
- Safe to re-run — e.g. after a unit replacement re-enrolls under the same hostname, this refreshes
  the recorded identity without touching organization/plant association or downgrading status.

### 3. `associate-gateway.ts` — assign to a customer (run once the plant/organization is known)

```
pnpm tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/gateway/associate-gateway.ts --gateway-id <id> --organization <organizationId> [--plant <plantId>]
```

- Pure database update — no Headscale interaction (the network identity is already established by
  step 2).
- Requires the gateway to be `ENROLLED` (not still `PROVISIONED`, not `REVOKED`).
- If a plant is given, enforces that it belongs to the specified organization — refuses a
  cross-tenant association, the same tenant-isolation discipline every other model in this schema
  follows.
- Advances `status` to `ACTIVE`, sets `associatedAt`.

## Gateway status lifecycle

```
PROVISIONED --(confirm-enrollment.ts)--> ENROLLED --(associate-gateway.ts)--> ACTIVE
                                             |
                                             +--(re-run, e.g. unit replacement)--> ENROLLED (refreshed)

Any status --(Headscale-side revocation, see below)--> REVOKED
```

## Revocation

There is no `revoke-gateway.ts` script yet — this milestone intentionally scoped provisioning
(bringing a gateway in) separately from revocation (taking one out), and revocation was already
proven manually during the Remote Management milestone's own testing (`headscale nodes
delete -i <id>`, confirmed to immediately and completely cut that node's network access with zero
effect on any other node). Until a dedicated script exists, revoke a gateway by:

1. `ssh root@51.15.103.175 "headscale nodes delete -i <headscaleNodeId> --force"` — cuts the
   physical unit's overlay access immediately.
2. Manually set that `Gateway` row's `status` to `REVOKED` in Postgres (Prisma Studio or a direct
   update) — there is no script for this step yet; add one if revocation becomes routine enough to
   justify it.

## Live connectivity on `/admin/gateways`

`/admin/gateways` shows two deliberately separate things per gateway: `status` (the lifecycle field
above, stored in Postgres, unaffected by whether the unit happens to be reachable right now) and a
live `ONLINE`/`OFFLINE`/`UNKNOWN` indicator, fetched fresh from Headscale on every page load —
never cached, never written back to the database.

This runs inside a Next.js Server Component on Vercel, which has no SSH access to the Scaleway VM
(unlike the three provisioning scripts above, which run from an operator's own machine). It instead
calls Headscale's own HTTP API directly (`GET https://headscale.voltessa.ai/api/v1/node`, Bearer
`HEADSCALE_API_KEY`) — see `lib/admin/headscale-live-status.ts`. Correlation uses each `Gateway`
row's stored `headscaleNodeKey` (the stable cryptographic node identity), never hostname matching.

- **`HEADSCALE_API_KEY`**: created once via `ssh root@51.15.103.175 "headscale apikeys create -e 90d"`
  (the key is only ever shown at creation time — if lost, create a new one and expire the old one:
  `headscale apikeys expire`). **Must be set manually in Vercel Production and Preview** — declared
  in `turbo.json` `globalEnv` and documented in `CLAUDE.md`, but (same risk `ENTSOE_API_TOKEN` had
  before its own milestone caught it) declaring it is not the same as it actually being set as a
  real Vercel value. Verify it's set before assuming the live indicator works in production.
- If Headscale can't be reached (network issue, expired/missing API key, Headscale itself down),
  the page still loads and shows every `Gateway` row — the live column shows `UNKNOWN`, never a
  false `OFFLINE`.

## What this workflow deliberately does not do (yet)

No provisioning UI, no internal API route for enrollment, no `Permissions.can*` bucket beyond the
existing platform-admin gate, no automated reconciliation/polling of Headscale state into Postgres
(the live indicator above is a page-load lookup, not a background job), no hardware-serial
tracking, no revocation script. All reasonable next steps once there's an actual fleet size that
makes manual/scripted operation painful — not needed at today's scale (see this milestone's own
design record for the reasoning).
