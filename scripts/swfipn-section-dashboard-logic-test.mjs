// Fixture tests for the Dashboard 2.0 section-panel logic. Runs the exact
// shipped module (src/lib/sectionDashboards.ts) under node with a pinned
// clock. Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//   --experimental-strip-types scripts/swfipn-section-dashboard-logic-test.mjs
import {
  parseStamp,
  firstStamp,
  largestRanking,
  mostRecentRanking,
  closingSoonestRanking,
  focusRanking,
  freshnessSummary,
  daysUntilLabel,
} from "../src/lib/sectionDashboards.ts";

const NOW = Date.parse("2026-07-08T12:00:00Z");
const DAY = 86_400_000;
let failures = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n  expected: ${b}\n  actual:   ${a}`);
  }
}

function rec(overrides) {
  return {
    label: "record",
    category: "Sovereign Wealth Fund",
    geography: "Norway",
    sizeDisplay: "Not disclosed",
    sizeValue: null,
    dateStamp: 0,
    createdStamp: 0,
    updatedStamp: 0,
    deadlineStamp: 0,
    ...overrides,
  };
}

// parseStamp
check("parseStamp ISO date", parseStamp("2026-07-01") > 0, true);
check("parseStamp garbage", parseStamp("not a date"), 0);
check("parseStamp empty", parseStamp(""), 0);
check("parseStamp non-string", parseStamp(12345), 0);

// firstStamp precedence
check(
  "firstStamp takes first parseable",
  firstStamp(["", "junk", "2026-06-30", "2026-01-01"]),
  Date.parse("2026-06-30"),
);
check("firstStamp all invalid", firstStamp([null, undefined, "x"]), 0);

// largestRanking
const sized = [
  rec({ label: "small", sizeValue: 1e9, sizeDisplay: "$1B" }),
  rec({ label: "big", sizeValue: 9e12, sizeDisplay: "$9T" }),
  rec({ label: "mid", sizeValue: 5e10, sizeDisplay: "$50B" }),
  rec({ label: "undisclosed", sizeValue: null }),
  rec({ label: "zero", sizeValue: 0, sizeDisplay: "$0" }),
];
check(
  "largestRanking orders desc and drops undisclosed/zero",
  largestRanking(sized).map((r) => r.label),
  ["big", "mid", "small"],
);
check("largestRanking under min renders nothing", largestRanking(sized.slice(0, 2)), []);
check(
  "largestRanking caps at top",
  largestRanking(
    Array.from({ length: 8 }, (_, i) => rec({ label: `r${i}`, sizeValue: (i + 1) * 1e9 })),
  ).length,
  5,
);

// mostRecentRanking
const dated = [
  rec({ label: "old", dateStamp: NOW - 300 * DAY }),
  rec({ label: "new", dateStamp: NOW - 1 * DAY }),
  rec({ label: "mid", dateStamp: NOW - 30 * DAY }),
  rec({ label: "undated", dateStamp: 0 }),
];
check(
  "mostRecentRanking newest first, undated dropped",
  mostRecentRanking(dated).map((r) => r.label),
  ["new", "mid", "old"],
);

// closingSoonestRanking
const deadlined = [
  rec({ label: "past", deadlineStamp: NOW - 2 * DAY }),
  rec({ label: "soon", deadlineStamp: NOW + 3 * DAY }),
  rec({ label: "later", deadlineStamp: NOW + 40 * DAY }),
  rec({ label: "next", deadlineStamp: NOW + 9 * DAY }),
];
check(
  "closingSoonestRanking future only, soonest first",
  closingSoonestRanking(deadlined, NOW).map((r) => r.label),
  ["soon", "next", "later"],
);
check(
  "closingSoonestRanking under min renders nothing",
  closingSoonestRanking(deadlined.slice(0, 2), NOW),
  [],
);

// focusRanking
const focusRecords = [
  rec({ label: "infra-mena", category: "Infrastructure", geography: "Saudi Arabia", sizeValue: 2e9, dateStamp: NOW - 9 * DAY }),
  rec({ label: "infra-eu", category: "Infrastructure", geography: "Norway", sizeValue: 8e9 }),
  rec({ label: "pension-us", category: "Public Pension", geography: "United States" }),
  rec({ label: "sa-fund", category: "Sovereign Wealth Fund", geography: "saudi arabia", dateStamp: NOW - 1 * DAY }),
];
check(
  "focusRanking matches category or geography, case-insensitive, size then date",
  focusRanking(focusRecords, ["infrastructure", "Saudi Arabia"]).map((r) => r.label),
  ["infra-eu", "infra-mena", "sa-fund"],
);
check("focusRanking with no terms renders nothing", focusRanking(focusRecords, ["", "  "]), []);

// freshnessSummary
const freshRows = [
  rec({ label: "new-3d", createdStamp: NOW - 3 * DAY }),
  rec({ label: "upd-5d", updatedStamp: NOW - 5 * DAY }),
  rec({ label: "upd-20d", updatedStamp: NOW - 20 * DAY }),
  rec({ label: "future-created", createdStamp: NOW + 5 * DAY }),
  rec({ label: "ancient", createdStamp: NOW - 200 * DAY, updatedStamp: NOW - 190 * DAY }),
];
const fresh7 = freshnessSummary(freshRows, NOW);
check("freshness uses 7-day window when it holds 2+", fresh7.windowDays, 7);
check("freshness entries newest first", fresh7.entries.map((e) => e.record.label), ["new-3d", "upd-5d"]);
check("freshness classifies new vs updated", fresh7.entries.map((e) => e.changeKind), ["new", "updated"]);
check("freshness counts", [fresh7.newCount, fresh7.updatedCount], [1, 1]);
const fresh30 = freshnessSummary(
  [rec({ label: "upd-20d", updatedStamp: NOW - 20 * DAY }), rec({ label: "new-25d", createdStamp: NOW - 25 * DAY })],
  NOW,
);
check("freshness widens to 30 days when 7 is thin", fresh30.windowDays, 30);
check(
  "freshness null below 2 changes in both windows",
  freshnessSummary([rec({ label: "ancient", createdStamp: NOW - 100 * DAY })], NOW),
  null,
);
check(
  "freshness ignores future-dated stamps",
  (freshnessSummary(freshRows, NOW)?.entries || []).some((e) => e.record.label === "future-created"),
  false,
);
const newIsNotAlsoUpdated = freshnessSummary(
  [rec({ label: "both", createdStamp: NOW - 2 * DAY, updatedStamp: NOW - 1 * DAY }), rec({ label: "upd", updatedStamp: NOW - 3 * DAY })],
  NOW,
);
check("a recently created record counts once, as new", newIsNotAlsoUpdated.entries.map((e) => `${e.record.label}:${e.changeKind}`), ["both:new", "upd:updated"]);

// daysUntilLabel
check("daysUntil today", daysUntilLabel(NOW - 1, NOW), "Closes today");
check("daysUntil tomorrow", daysUntilLabel(NOW + 1 * DAY, NOW), "Closes tomorrow");
check("daysUntil N days", daysUntilLabel(NOW + 9 * DAY, NOW), "Closes in 9 days");

console.log(failures === 0 ? `ALL CHECKS PASS (${failures} failures)` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
