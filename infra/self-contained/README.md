# SWFI2 Remote-Source Runtime

This stack runs the SWFI web and backend services against an explicitly
configured remote Atlas source. It must not depend on the laptop,
`host.docker.internal`, local keychain, browser-side scraping, or any local or
in-stack Mongo process.

## Runtime Contract

- Product facts come from the governed remote Atlas projection:
  `SWFI2_FACT_SOURCE=mongo` with `SWFI_MONGO_URI=$SWFI_ATLAS_URI`.
- `SWFI_ATLAS_URI` is mandatory and must resolve to a non-local host. Loopback,
  localhost, and an in-stack Mongo service are forbidden without exception.
- SWFI.com/API remains upstream authority and provenance for the remote
  projection. This dashboard stack does not create a second local copy.
- The frontend talks to the backend through same-origin proxying only.
- Staleness and source gaps fail closed. No fallback values are rendered.

## Compose

1. Create an uncommitted environment file containing the required remote
   `SWFI_ATLAS_URI`, API tokens, authentication secrets, and public domain.

2. Build and boot:

   ```bash
   SWFI2_BACKEND_CONTEXT=/absolute/path/to/SWFI2.0-final \
   SWFIPN_FRONTEND_CONTEXT=/absolute/path/to/swfi-dashboard \
   docker compose --env-file infra/self-contained/.env.self-contained \
     -f infra/self-contained/compose.yml up -d --build
   ```

3. Run public gates against the configured domain:

   ```bash
   npm run source-truth:gate:public
   npm run phase2:backend:acceptance:public
   npm run record-mirror:gate:public
   npm run acceptance:gate:public
   ```

Backups, restores, and upstream refreshes belong to the governed remote data
platform. They are deliberately absent from this dashboard runtime.

## Kubernetes

Use `infra/self-contained/kubernetes/swfipn-stack.template.yaml` as the starting
manifest. Replace every `REPLACE_ME` value through your secret manager before
applying. The template contains:

- `Deployment/swfi2-backend`
- `Deployment/swfipn-web`
- `Ingress/swfipn`

The image references are digest placeholders. Replace
`registry.example.com/swfi2/*@sha256:REPLACE_*_DIGEST` with pushed images before
cluster cutover.

## Gate

Run:

```bash
npm run self-contained:gate
```

The gate fails if the stack depends on the host/laptop network, provisions a
Mongo workload, accepts a local Mongo URI, omits required runtime manifests, or
weakens the public acceptance harness.

To validate Compose syntax, provide non-secret placeholders whose Mongo host is
still explicitly remote:

```bash
SWFI_ATLAS_URI='mongodb+srv://example.invalid/swfi' \
SWFI2_API_TOKEN=replace SWFIPN_BACKEND_TOKEN=replace \
SWFIPN_AUTH_USERNAME=replace SWFIPN_AUTH_PASSWORD=replace \
SWFIPN_AUTH_SESSION_SECRET=replace SWFIPN_DOMAIN=example.invalid \
docker compose -f infra/self-contained/compose.yml config --quiet
```
