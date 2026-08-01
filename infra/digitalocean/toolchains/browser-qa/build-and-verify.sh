#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
dockerfile="$repo_root/infra/digitalocean/toolchains/browser-qa/Dockerfile"
tag="${SWFIPN_BROWSER_QA_TAG:-swfipn/browser-qa:20260801}"

docker build --pull=false --file "$dockerfile" --tag "$tag" "$repo_root"
docker run --rm --network none "$tag" bash -c '
  set -e
  node --version
  npm --version
  npx playwright --version
  node -e "import(\"playwright\").then(() => console.log(\"playwright-import-pass\"))"
'
docker image inspect --format '{{.Id}}' "$tag"
