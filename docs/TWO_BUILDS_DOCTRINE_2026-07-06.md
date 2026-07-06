# SWFI Two-Builds Doctrine — Paul-ratified 2026-07-06

Paul: "we have dashboard as build one and demo2 as build two that we keep
ready and bullet and future proofed."

## Build ONE — the product the team specs

- **Surface**: dashboard.swfi.com (and swfipn.activemirror.ai, same box).
- **Repos**: frontend `swfi-dashboard` (github mirrordna/swficc), backend
  THIS repo (`SWFI2.0-final`, github MirrorDNA-Reflection-Protocol/
  swfi2-final-backend).
- **Law source**: meeting minutes 2026-07-03 + Paul's directives; preview
  layer only, every chain ends at swfi.com.
- **Deploy**: `npm run acceptance:stack:deploy` from swfi-dashboard (ships
  BOTH repos' local trees to the acceptance box; 17-gate suite).
- **Parity gates in this repo verify against build one**
  (https://dashboard.swfi.com) — the deployment this backend actually
  serves. They previously pointed at terminal.activemirror.ai, a stale
  older deploy, which blocked every GitHub push and trapped commits on one
  machine (the bus-factor debt named in the 2026-07-06 architecture
  review). Override with SWFI_BACKEND_ORIGIN when intentionally testing
  another deployment.

## Build TWO — the reserve, kept ready and future-proofed

- **Surface**: demo2.swfi.com (auth-gated; droplet 167.172.146.76).
- **Repo**: `swfi-terminal-brd` (zero-dep Node terminal build).
- **Status at ratification**: live behind its gate (HTTP 401 unauth =
  correctly gated), working tree clean, HEAD pushed (0 ahead of origin).
- **Duty**: stays deployable at all times; receives idea-migrations both
  ways (e.g. its ECharts world map was ported INTO build one on
  2026-07-06); no team-facing law applies to it directly.

## Boundary rules

- The two builds are DIFFERENT deployments — never point one build's
  gates, configs, or deploy scripts at the other's surface (standing
  Paul rule 2026-07-05). Cross-pollination happens by PORTING code/ideas
  through commits, never by sharing runtime targets.
- terminal.activemirror.ai is neither build's canonical surface; treat it
  as legacy until Paul retires or reassigns it.
- One dataset (swfi-production Atlas, read-only) feeds both; schema truth
  is probed per-build before features ship.
