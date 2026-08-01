#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const scriptsDir = path.resolve("scripts");
const hardCodedChromeChannel = /channel\s*:\s*["']chrome["']/;
const failures = [];

for (const entry of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
  const filePath = path.join(scriptsDir, entry.name);
  const source = fs.readFileSync(filePath, "utf8");
  if (hardCodedChromeChannel.test(source)) failures.push(filePath);
}

if (failures.length) {
  console.error(JSON.stringify({
    status: "fail",
    reason: "provider_specific_chrome_channel",
    files: failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "pass",
  contract: "browser gates use the Chromium bundled in the pinned Playwright image",
}, null, 2));
