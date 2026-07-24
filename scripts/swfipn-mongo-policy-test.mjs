#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  ALLOW_LOCAL_MONGO,
  assertRemoteMongoUri,
  isLocalMongoUri,
  isRemoteMongoUri,
  mongoHosts,
} from "./swfipn-mongo-policy.mjs";

assert.equal(ALLOW_LOCAL_MONGO, false);
assert.deepEqual(mongoHosts("mongodb://user:pass@remote-a.example:27017,remote-b.example:27018/swfi"), ["remote-a.example", "remote-b.example"]);
for (const uri of [
  "mongodb://localhost:27017/swfi",
  "mongodb://127.0.0.1:27017/swfi",
  "mongodb://0.0.0.0:27017/swfi",
  "mongodb://[::1]:27017/swfi",
]) {
  assert.equal(isLocalMongoUri(uri), true, uri);
  assert.equal(isRemoteMongoUri(uri), false, uri);
  assert.throws(() => assertRemoteMongoUri(uri), /Local Mongo is disabled/);
}
assert.equal(isRemoteMongoUri("mongodb+srv://readonly@cluster.example.mongodb.net/swfi"), true);
assert.equal(assertRemoteMongoUri("mongodb+srv://readonly@cluster.example.mongodb.net/swfi").remote, true);
assert.equal(isRemoteMongoUri("not-a-uri"), false);

console.log(JSON.stringify({ status: "pass", local_mongo_allowed: ALLOW_LOCAL_MONGO }));
