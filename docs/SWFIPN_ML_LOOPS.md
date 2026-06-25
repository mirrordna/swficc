# SWFIPN ML Loops

These are practical ML loops for SWFIPN. They are not autonomous model training
lanes. They are evidence loops: classify, rank, detect drift, queue review, and
fail closed.

Run:

```bash
npm run ml:loops
```

Receipt:

```text
output/swfipn-ml-loop-registry-latest.json
output/swfipn-ml-loop-registry-latest.md
```

## Loop Families

| Loop | Family | Purpose |
| --- | --- | --- |
| failure_classifier | supervised classifier | Convert failing receipts into one patch slice. |
| route_risk_ranker | ranking model | Rank risky routes by buyer impact and crawl evidence. |
| source_gap_detector | anomaly detector | Catch UI facts without source or mapped record. |
| legacy_url_resolver | entity resolution | Map old SWFI/CMS URLs to internal detail pages. |
| visual_contract_regressor | visual regression | Catch missing visuals, diagnostics, console issues, overflow. |
| table_controls_auditor | interaction model | Verify sort, filter, pagination, counts, row reachability. |
| money_number_normalizer | feature parser | Normalize money and AUM before sorting/ranking. |
| entity_resolution_loop | record linkage | Resolve names, IDs, slugs, source URLs, and detail routes. |
| search_relevance_loop | retrieval evaluator | Test query relevance, categories, counts, and clickable results. |
| provenance_depth_loop | graph walk | Verify source-to-record-to-related-record chains. |
| freshness_drift_loop | time-series monitor | Catch stale receipts, stale assets, and stale fact rails. |
| auth_boundary_loop | policy classifier | Keep product navigation internal and auth-aware. |
| dashboard_relevance_loop | ranking model | Rank dashboard rows by source-backed usefulness. |
| feedback_triage_loop | text classifier | Turn user/client feedback into defects, doctrine gaps, or enhancements. |
| pixel_truth_queue | multimodal retrieval | Queue layout-heavy pages/PDFs for screenshot evidence extraction. |
| contradiction_engine | consistency checker | Compare backend, UI, source, and extracted evidence. |
| deployment_canary_loop | canary classifier | Compare local, Docker, and public proof before sharing links. |
| copy_leak_detector | safety classifier | Catch internal diagnostics and implementation language. |
| record_coverage_sampler | active-learning sampler | Pick high-risk records for the next crawl/test batch. |
| repair_priority_ranker | cost-impact ranker | Select the smallest highest-impact next fix. |

## Contract

```text
signals in:
  receipts, crawls, screenshots, source maps, backend fact source, feedback

model behavior:
  classify, rank, detect anomaly, select sample, queue review

signals out:
  failing loop, risk score, next experiment, review queue

mutation boundary:
  no deploy
  no production restart
  no DB write
  no model training
  no public claim without PASS receipt
```

## Upgrade Path

The current implementation is deterministic so it can run safely in CI and
agent loops. ML can be added behind the same receipt contract:

```text
deterministic receipt parser
  -> feature rows
  -> local model or remote model
  -> predicted failure class / risk rank / next sample
  -> deterministic gate validates prediction
  -> receipt
```

Models may suggest; gates decide.
