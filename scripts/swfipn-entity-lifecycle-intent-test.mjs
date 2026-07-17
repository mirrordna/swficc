import assert from "node:assert/strict";
import { entityLifecycleIntent } from "../src/lib/entityLifecycle.ts";

assert.deepEqual(entityLifecycleIntent("Sovereign Wealth Funds investing in AI"), {
  entityStatus: "active",
  sourceQuery: "Sovereign Wealth Funds investing in AI",
  explicitDefunctRequest: false,
});
assert.deepEqual(entityLifecycleIntent("defunct sovereign wealth funds"), {
  entityStatus: "defunct",
  sourceQuery: "sovereign wealth funds",
  explicitDefunctRequest: true,
});
assert.deepEqual(entityLifecycleIntent("inactive institutions in Europe"), {
  entityStatus: "defunct",
  sourceQuery: "institutions in Europe",
  explicitDefunctRequest: true,
});
assert.equal(entityLifecycleIntent("inactive investing strategies").explicitDefunctRequest, false);

console.log(JSON.stringify({ status: "PASS", cases: 4 }));
