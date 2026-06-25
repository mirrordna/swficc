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

Verified public asset version:

```text
2026-06-21T124325893Z
```

The deploy script uses an explicit Compose project name:

```text
swfipn_acceptance
```

Older releases may still have orphaned containers from timestamp-derived
Compose project names. Do not infer live state from `docker compose ps` inside
the `current` symlink unless the compose project is explicit.

## Required Secret Files

Create these on the server next to `compose.acceptance.yml`.

`.env.swfi2-backend`:

```bash
SWFI2_FACT_SOURCE=mongo
SWFI_MONGO_URI=
SWFI_MONGO_DB=swfi
SWFI2_API_TOKEN=
SWFI2_SYNC_MAX_STALENESS_SECONDS=1800
```

Use `SWFI2_FACT_SOURCE=swfi_api` only if the server has SWFI.com API
credentials or a valid session cookie. Do not print or commit either file.

`.env.swfipn-web`:

```bash
SWFIPN_AUTH_USERNAME=
SWFIPN_AUTH_PASSWORD=
SWFIPN_AUTH_SESSION_SECRET=
SWFIPN_BACKEND_TOKEN=
```

`SWFIPN_BACKEND_TOKEN` must equal backend `SWFI2_API_TOKEN`.

## Deploy

From the directory that contains both repos:

```bash
SWFI2_BACKEND_CONTEXT=./SWFI2.0-final \
SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard \
SWFIPN_DOMAIN=swfipn-acceptance.example.com \
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
