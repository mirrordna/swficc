# SWFIPN Self-Improvement Loop

This is the anti-circle algorithm for SWFIPN work.

It does not promise that software can never break. It promises broken work does
not silently pass, does not get explained away, and does not get sent as ready.

## Loop Law

```text
1. Doctrine is the spec.
2. SWFI records are the product fact rail.
3. SWFI.com URLs are provenance/final-source references.
4. 200 is not green.
5. A screenshot alone is not green.
6. A route existing is not green.
7. One failing receipt creates one patch slice.
8. Patch only that slice.
9. Rerun the loop.
10. Do not send a test link unless the loop receipt is PASS.
```

## Command

Smoke proof:

```bash
npm run self:loop
```

Full public proof:

```bash
npm run self:loop:full
```

Container proof:

```bash
npm run self:loop:docker
```

Each run writes:

```text
output/swfipn-self-improvement-loop-latest.json
output/swfipn-self-improvement-loop-latest.md
```

## Algorithm

```text
read latest doctrine and receipts
preflight repo, scripts, git state, node/npm
run lint
run production build
run source-truth gate
run record-mirror gate
run controls gate
run visual gate
run e2e gate
optional: build Docker image
optional: wait for Docker healthcheck
optional: run container product-contract healthcheck

if any step fails:
  stop
  write receipt
  name the first failing slice
  patch only that slice
  rerun loop

if all steps pass:
  write PASS receipt
  only then send public test link
```

## Why This Stops Drift

The loop removes judgment calls from readiness. The assistant does not get to
decide that something is "probably fine" because the route returned 200. The
machine must verify source truth, doctrine coverage, table controls, visual
content, click-through behavior, and build/runtime health.

## Failure Handling

The first failing receipt wins. Do not combine unrelated fixes in one pass.

Examples:

```text
lint fails
=> fix lint only

visual gate fails
=> fix dashboard/rendering only

source-truth gate fails
=> fix provenance/data mapping only

Docker health fails
=> fix container/runtime only
```

## Production Boundary

This loop does not deploy, restart production, edit Cloudflare, or mutate
Hetzner. Those actions require the deploy gate. The loop can prove whether the
candidate is ready to be deployed.
