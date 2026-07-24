#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  eligibleTextQuery,
  isShortTextQuery,
  isTextQueryReady,
  MIN_TEXT_QUERY_CHARACTERS,
  normalizeTextQuery,
} from "../src/lib/textQueryPolicy.ts";

assert.equal(MIN_TEXT_QUERY_CHARACTERS, 3);

for (const value of ["", " ", "a", " a ", "ab", " ab "]) {
  assert.equal(isTextQueryReady(value), false, `must not run: ${JSON.stringify(value)}`);
  assert.equal(eligibleTextQuery(value), "", `must not emit an API query: ${JSON.stringify(value)}`);
}

for (const value of ["abc", " abc ", "AI funds", "GIC"]) {
  assert.equal(isTextQueryReady(value), true, `must run: ${JSON.stringify(value)}`);
  assert.equal(eligibleTextQuery(value), normalizeTextQuery(value));
}

assert.equal(isShortTextQuery(""), false, "empty input is an intentional idle/default-list state");
assert.equal(isShortTextQuery("a"), true);
assert.equal(isShortTextQuery("ab"), true);
assert.equal(isShortTextQuery("abc"), false);

console.log(JSON.stringify({
  pass: true,
  evidence_class: "NOT_ACCEPTANCE",
  reason: "Pure policy-unit coverage; real candidate browser evidence is required for acceptance.",
  minimum_characters: MIN_TEXT_QUERY_CHARACTERS,
  checked_lengths: [0, 1, 2, 3],
  empty_input: "idle_or_default_list",
  short_typed_input: "no_query",
}, null, 2));
