# SWFIPN Docker Runtime

This packages the SWFICC frontend as a self-contained `/swficc` web container.
Browser navigation stays inside `/swficc`; source URLs are provenance metadata,
not click targets.

## Build And Run

```bash
docker compose -f docker-compose.swfipn.yml up -d --build swfipn
```

Open:

```text
http://127.0.0.1:8353/swficc/
```

The frontend container proxies same-origin `/api/*` and `/v1/*` calls to
`SWFIPN_BACKEND`. On the production droplet (`swfipn-do`) this should point at the existing SWFI backend
service, not at `swfi.com`.

## Runtime Contract

The container healthcheck is not a plain 200 check. It fetches `/swficc/` and
requires the dashboard contract to be present:

- KPI cards and insight tables.
- Visual panels: Active Allocator Activity, Largest Recent Deals, RFP Deadline
  Timeline, and Sector Flow.
- `Data source: SWFI records`.
- No internal diagnostics such as endpoints, source packets, Mongo IDs, truth
  state, or source-detail placeholders.

Run it directly inside a running container when debugging:

```bash
docker compose -f docker-compose.swfipn.yml exec swfipn \
  python /app/swfipn-container-healthcheck.py
```

## Proof Gates

Before sending a public URL, run the browser-level gates from the repo root.
These use Playwright when the Browser MCP is unavailable.

```bash
npm run self:loop
```

For container proof too:

```bash
npm run self:loop:docker
```

`self:loop` runs lint, build, source truth, record mirror, table controls,
visual proof, and end-to-end gates. It writes
`output/swfipn-self-improvement-loop-latest.json` and fails closed on the first
broken slice. `visual:gate:public` also writes desktop and mobile screenshots
and fails on stale public assets, missing visual panels, leaked diagnostics,
console errors, broken source links, too few visual bars, or horizontal
overflow.

## Docker / MCP Boundary

No separate Docker MCP config is required for SWFIPN in this repo. The MCP/tool
surface used by agents is:

- Docker CLI/Compose for `Dockerfile` and `docker-compose.swfipn.yml`.
- Browser MCP when available for rendered proof.
- Playwright fallback via the package scripts when Browser MCP is unavailable.

Do not point product navigation directly at `swfi.com`. SWFI.com URLs remain
provenance metadata; product navigation stays inside `/swficc`.

## Freshness Sync

Run the optional freshness sidecar only with an explicit sync command or sync
endpoint:

```bash
SWFIPN_SYNC_URL="http://host.docker.internal:8362/api/source-mirror/sync" \
SWFIPN_FRESHNESS_URL="http://host.docker.internal:8362/api/source-mirror/status" \
docker compose -f docker-compose.swfipn.yml --profile freshness up -d --build
```

Alternative for a host-managed sync job:

```bash
SWFIPN_SYNC_COMMAND="systemctl start swfi-source-mirror.service" \
SWFIPN_FRESHNESS_URL="http://host.docker.internal:8362/api/source-mirror/status" \
docker compose -f docker-compose.swfipn.yml --profile freshness up -d --build
```

The sidecar writes receipts to the `swfipn_freshness` Docker volume at
`/var/lib/swfipn/freshness/latest.json`.
