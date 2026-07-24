# SWFIPN DigitalOcean Acceptance Stack

This stack is additive. It is intended for a new DigitalOcean acceptance droplet,
not an existing SWFI production droplet.

## Services

- `swfi2-backend`: FastAPI backend from `/Users/mirror-pro/repos/SWFI2.0-final`.
- `swfipn-web`: static `/swficc` frontend and same-origin backend proxy.
- `caddy`: public HTTPS reverse proxy.

## Known Acceptance Droplet

DigitalOcean project: `SWFI`

Acceptance droplet:

```text
name: swfipn-acceptance
region: NYC1
size: 4 GB RAM / 120 GB Disk
public IPv4: 161.35.56.218
```

Local Keychain service for read-only DO inventory:

```text
swfi-digital-ocean
```

Run a read-only inventory/probe from this repo:

```bash
npm run do:inventory
```

The command writes:

```text
output/swfipn-digitalocean-inventory-latest.json
```

SSH is a separate requirement. If `ssh root@161.35.56.218` fails with
`Permission denied (publickey)`, the local public key must be installed on the
droplet before deploy scripts can run.

On this machine the working SSH alias is:

```bash
ssh swfipn-do
```

It uses:

```text
HostName 161.35.56.218
User root
IdentityFile ~/.ssh/swfi_do_migration_ed25519
```

Current live release observed on 2026-06-21 after the public DNS cutover:

```text
/opt/swfipn-acceptance/releases/20260621T124226Z
```

Public hostname:

```text
swfipn.activemirror.ai -> Cloudflare proxied A -> 161.35.56.218
```

API hostname target:

```text
api.swfi.com -> A 161.35.56.218
```

The acceptance Caddy config includes a dedicated `SWFIPN_API_DOMAIN`
virtual host. It proxies `https://api.swfi.com/docs` and `/v1/*` directly
to `swfi2-backend:8362`. Until DNS points `api.swfi.com` at this droplet,
the public production API gate remains blocked even when the acceptance API
control passes at `https://swfipn.activemirror.ai`.

Preflight the DNS cutover without changing records:

```bash
npm run brd:api-dns:cutover
```

Apply the cutover only with a DigitalOcean token that can write `swfi.com`
DNS records:

```bash
SWFIPN_API_DNS_APPLY=1 npm run brd:api-dns:cutover
```

The cutover controller reads the token from `DIGITALOCEAN_ACCESS_TOKEN`,
`DO_API_TOKEN`, or the `swfi-digital-ocean` Keychain service. By default it
prefers the `swfipn-acceptance` Keychain account before falling back to a
service-only lookup. It writes `output/swfipn-api-dns-cutover-latest.json` with
redacted values, the prior record id/data/TTL for rollback, the patch result,
DNS polling samples, and the post-cutover API gate result.

Verified public asset version:

```text
2026-06-21T124325893Z
```

The deploy script uses an explicit Compose project name:

```text
swfipn_acceptance
```

## GitHub-native acceptance deployment

`scripts/deploy_acceptance_from_git.sh` is the preferred path when the control
machine is not a dashboard source host. It never copies frontend or backend
source from the invoking machine:

- the frontend is fetched from `mirrordna/swficc` at one full commit SHA;
- the active release must exactly match `acceptance-baseline.json`;
- the active frontend and backend image IDs must match the baseline;
- read-only preflight verifies `SWFI2_FACT_SOURCE=mongo`, database `swfi`,
  strict TLS, the exact URI option set, direct-only topology, the configured
  host allowlist, live DNS results, and the runtime DNS pin against a separately
  pinned Mongo source policy;
- Mongo receipts bind the exact policy and resolved source identity with
  SHA-256 digests without writing credentials, URI values, hostnames, or IPs;
- the pinned backend image is retagged for the candidate release and is not
  rebuilt from an unverified source tree;
- the new release is built under `/opt/swfipn-acceptance/releases`;
- health and the public release marker must attest the candidate before
  `current` is switched;
- activation failure, interruption, or failed evidence collection restores the
  prior release;
- a remote systemd rollback guard restores the prior release if the invoking
  runner disappears after activation begins;
- every preflight or deploy attempt writes a v9 receipt.

Read-only preflight:

```bash
SWFIPN_HOST=root@161.35.56.218 \
SWFIPN_DOMAIN=swfipn.activemirror.ai \
SWFIPN_FRONTEND_GIT_SHA=<full-commit-sha> \
SWFIPN_MONGO_POLICY_SHA256=<sha256-of-server-policy-file> \
npm run deploy:acceptance:preflight
```

The protected `.github/workflows/swfipn-deploy-acceptance.yml` workflow runs
the same preflight and deploy path from an ephemeral GitHub runner. Configure
the `swfipn-acceptance` GitHub environment with:

- deployment branches restricted to the approved candidate branch;
- a required reviewer who did not initiate the run;
- self-review disabled;
- administrator bypass disabled;
- the following environment secrets:

```text
SWFIPN_ACCEPTANCE_HOST
SWFIPN_ACCEPTANCE_DOMAIN
SWFIPN_ACCEPTANCE_SSH_KEY
SWFIPN_ACCEPTANCE_KNOWN_HOSTS
SWFIPN_ACCEPTANCE_MONGO_POLICY_SHA256
```

Dispatch requires the full candidate SHA and the exact
`DEPLOY_SWFIPN_ACCEPTANCE` approval phrase. The requested SHA must also equal
the workflow's own `GITHUB_SHA`. Creating the environment secrets, configuring
the protection rules, and approving a workflow run are privileged external
actions; the repository does not create credentials or deploy merely by
containing this workflow.

Older releases may still have orphaned containers from timestamp-derived
Compose project names. Do not infer live state from `docker compose ps` inside
the `current` symlink unless the compose project is explicit.

## Required Secret Files

Create these on the server next to `compose.acceptance.yml`.

`.env.swfi2-backend`:

```bash
SWFI2_FACT_SOURCE=mongo
SWFI_MONGO_URI=
SWFI_MONGO_ALLOWED_HOSTS=
SWFI_MONGO_DB=swfi
SWFI2_API_TOKEN=
SWFI2_PRODUCT_API_KEYS=
SWFI2_MSCI_COMPAT_KEY_IDS=
SWFI2_SYNC_MAX_STALENESS_SECONDS=1800
```

`SWFI_MONGO_ALLOWED_HOSTS` contains the normalized URI seed hostname(s), never
credentials. It is checked against the independently pinned
`/opt/swfipn-acceptance/shared/mongo-source-policy.json` file:

```json
{
  "schema_version": "swfipn.mongo_source_policy.v3",
  "connection_mode": "direct_single_endpoint",
  "allowed_direct_endpoint": {
    "host": "<approved-direct-host>",
    "port": 27017
  },
  "allowed_resolved_ips": ["<approved-public-ip>"],
  "runtime_dns_pin": {
    "host": "<approved-direct-host>",
    "ip": "<approved-public-ip>"
  },
  "required_options": {
    "directconnection": ["true"],
    "tls": ["true"]
  }
}
```

The protected deployment supports only a standard `mongodb://` URI with one
hostname, one port, explicit `directConnection=true`, strict TLS, and exactly
the normalized options listed in `required_options`. `mongodb+srv://`,
replica-set discovery, load-balanced discovery, SRV polling, legacy semicolon
option separators, invalid ports, TLS downgrade, certificate-validation
relaxations, loopback, private, link-local, multicast, reserved, unspecified,
mapped loopback, numeric-alias, and DNS-alias destinations fail closed.

`runtime_dns_pin` selects one currently verified public address for the
approved hostname. The deploy writes that pair to the root-only release
environment and Compose injects it into the backend container's `/etc/hosts`.
This prevents a later DNS change from routing the backend beyond the pinned
source. Additional non-routing URI options such as `authSource` or
`retryWrites` are permitted only when their normalized lower-case keys and
values are included exactly in `required_options`.

Pin the exact byte-level SHA-256 of this root-owned file in the GitHub
environment secret
`SWFIPN_ACCEPTANCE_MONGO_POLICY_SHA256`; changing either side independently
must fail preflight. The pinned backend image performs live A/AAAA resolution
in a read-only, capability-dropped container.

Both environment files and the Mongo source policy must be owned by
`root:root` with mode `0600`. The policy IP set is intentionally fail-closed:
legitimate DNS or Atlas topology rotation requires a reviewed policy update and
matching GitHub environment digest before another deployment can pass.

`SWFI2_MSCI_COMPAT_KEY_IDS` contains comma-separated API key identifiers, not raw API keys. It is the explicit allowlist for the legacy `/v1/api` compatibility facade.

Product API keys may also be created through the service-token protected
lifecycle endpoint after deploy. The compose stack persists managed key hashes
in the `swfipn_acceptance_api_product_key_store` Docker volume at:

```text
/app/product-state/api-product-keys.json
```

The create endpoint returns the raw API key once. List and revoke responses do
not return key material or key hashes.

Use `SWFI2_FACT_SOURCE=swfi_api` only if the server has SWFI.com API
credentials or a valid session cookie. Do not print or commit either file.

`.env.swfipn-web`:

```bash
SWFIPN_AUTH_USERNAME=
SWFIPN_AUTH_PASSWORD=
SWFIPN_AUTH_SESSION_SECRET=
SWFIPN_BACKEND_TOKEN=
SWFIPN_REQUIRE_RECORD_AUTH=1
```

`SWFIPN_BACKEND_TOKEN` must equal backend `SWFI2_API_TOKEN`.

Optional Phase 2 runtime integrations stay disabled until their receipts pass:

```bash
# .env.swfipn-web
SWFIPN_SWFI_SESSION_BRIDGE_SECRET=
SWFIPN_SWFI_SESSION_BRIDGE_ISSUER=swfi.com
SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE=https://swfipn.activemirror.ai/swficc/
SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED=1

# .env.swfi2-backend
SWFI2_SENDGRID_API_KEY=
SWFI2_SENDGRID_FROM_EMAIL=
SWFI2_SENDGRID_FROM_NAME=SWFI
SWFI2_SENDGRID_SANDBOX_MODE=0
```

Apply these without exposing values in terminal output:

```bash
SWFIPN_HOST=swfipn-do \
SWFIPN_SWFI_SESSION_BRIDGE_SECRET="$SWFI_BRIDGE_SECRET" \
SWFIPN_SWFI_SESSION_BRIDGE_ISSUER=swfi.com \
SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE=https://swfipn.activemirror.ai/swficc/ \
SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED=1 \
SWFI2_SENDGRID_API_KEY="<sendgrid-api-key>" \
SWFI2_SENDGRID_FROM_EMAIL=notifications@example.com \
SWFI2_SENDGRID_FROM_NAME=SWFI \
SWFIPN_RESTART=1 \
npm run runtime:config:apply
```

The script writes `output/swfipn-runtime-config-apply-latest.json` with key
names only. After applying, rerun:

```bash
npm run runtime:phase2:preflight:public
npm run brd:swfi-session:gate:public
npm run brd:sendgrid-email:gate:public
```

## Deploy

From the directory that contains both repos:

```bash
SWFI2_BACKEND_CONTEXT=./SWFI2.0-final \
SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard \
SWFIPN_DOMAIN=swfipn-acceptance.example.com \
SWFIPN_API_DOMAIN=api.swfi.com \
docker compose -f swfi-dashboard/infra/digitalocean/compose.acceptance.yml up -d --build
```

## Gates

Run from the `swfi-dashboard` repo with `SWFIPN_ORIGIN` set to the acceptance
domain:

```bash
npm run source-truth:gate:public
npm run doctrine:gate:public
npm run visual:gate:public
npm run e2e:gate:public
```

Do not send the link until the gates pass and the acceptance receipt says
`sendable: true`.
