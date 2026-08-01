import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/SourceListPage.tsx", "utf8");

assert.match(
  source,
  /endpoint: "\/api\/recent-transactions\/v1\?days=365&limit=10&page=1"/,
  "Transactions metadata must describe the governed recent-window source",
);
assert.match(
  source,
  /kind === "allocators" \|\| kind === "transactions" \? 10 : 25/,
  "Transactions and Active Allocators must open at 10 rows",
);
assert.match(
  source,
  /if \(!transactionFilter\) \{\s*return \{ main: `\/api\/recent-transactions\/v1\?days=365&limit=\$\{serverRowLimit\}&page=\$\{serverPageIndex \+ 1\}` \};\s*\}/,
  "Unfiltered Transactions must use the recent-window endpoint",
);
assert.match(
  source,
  /return \{ main: `\/api\/transactions\/v1\?limit=\$\{serverRowLimit\}&page=\$\{serverPageIndex \+ 1\}&q=\$\{encodeURIComponent\(transactionFilter\)\}` \};/,
  "Generic transaction text filtering must retain the complete source query",
);

console.log("SWFIPN transaction default contract: PASS");
