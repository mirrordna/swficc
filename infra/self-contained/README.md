# SWFI2 Self-Contained Runtime

This stack is the target shape for a sovereign SWFI2 deployment: web, backend,
Mongo vault, sync, receipts, health checks, and ingress are owned by the
deployment. It must not depend on the laptop, `host.docker.internal`, local
keychain, or browser-side scraping.

## Runtime Contract

- Product facts come from the in-stack Mongo mirror only:
  `SWFI2_FACT_SOURCE=mongo`.
- SWFI.com/API is upstream authority and provenance, used by the bootstrap and
  recurring sync jobs to refresh the Mongo mirror.
- The frontend talks to the backend through same-origin proxying only.
- The backend talks to `mongo:27017` or `swfi2-mongo:27017`, not the host.
- Staleness and source gaps fail closed. No fallback values are rendered.

## Compose

1. Copy the env template:

   ```bash
   cp infra/self-contained/.env.example infra/self-contained/.env.self-contained
   ```

2. Fill in secrets in `.env.self-contained`. Do not commit it.

3. Build and boot:

   ```bash
   SWFI2_BACKEND_CONTEXT=/absolute/path/to/SWFI2.0-final \
   SWFIPN_FRONTEND_CONTEXT=/absolute/path/to/swfi-dashboard \
   docker compose --env-file infra/self-contained/.env.self-contained \
     -f infra/self-contained/compose.yml up -d --build
   ```

4. The stack runs `swfi2-sync-init` before the strict backend starts. For a
   manual one-shot refresh after boot:

   ```bash
   docker compose --env-file infra/self-contained/.env.self-contained \
     -f infra/self-contained/compose.yml --profile sync run --rm swfi2-sync
   ```

5. Run public gates against the configured domain:

   ```bash
   npm run source-truth:gate:public
   npm run phase2:backend:acceptance:public
   npm run record-mirror:gate:public
npm run acceptance:gate:public
```

## Backup / Restore

Create a compressed Mongo archive:

```bash
docker-compose --env-file infra/self-contained/.env.self-contained \
  -f infra/self-contained/compose.yml --profile backup run --rm swfi2-backup
```

Restore a named archive from the `swfi2_mongo_backups` volume:

```bash
SWFI_RESTORE_ARCHIVE=swfi-YYYYMMDDTHHMMSSZ.archive \
docker-compose --env-file infra/self-contained/.env.self-contained \
  -f infra/self-contained/compose.yml --profile restore run --rm swfi2-restore
```

## Kubernetes

Use `infra/self-contained/kubernetes/swfipn-stack.template.yaml` as the starting
manifest. Replace every `REPLACE_ME` value through your secret manager before
applying. The template contains:

- `StatefulSet/swfi2-mongo`
- `Deployment/swfi2-backend`
- `Deployment/swfipn-web`
- `CronJob/swfi2-mongo-sync`
- `CronJob/swfi2-mongo-backup`
- `Ingress/swfipn`

The image references are digest placeholders. Replace
`registry.example.com/swfi2/*@sha256:REPLACE_*_DIGEST` with pushed images before
cluster cutover.

## Gate

Run:

```bash
npm run self-contained:gate
```

The gate fails if the self-contained stack depends on the host/laptop network,
omits Mongo, omits sync, omits Kubernetes manifests, or weakens the public
acceptance harness.

To validate Compose syntax without creating a real secrets file:

```bash
SWFI2_ENV_FILE=./.env.example \
docker-compose --env-file infra/self-contained/.env.example \
  -f infra/self-contained/compose.yml config --quiet
```
