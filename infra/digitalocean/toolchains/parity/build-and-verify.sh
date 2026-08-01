#!/usr/bin/env bash
set -euo pipefail

toolchain_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tag="${SWFIPN_PARITY_TOOLCHAIN_TAG:-swfipn/parity-toolchain:20260801}"

docker build --pull=false --tag "$tag" "$toolchain_dir"
docker run --rm --network none "$tag" bash -c '
  set -e
  node --version
  npm --version
  /opt/swfipn-toolchain/bin/python3 --version
  /opt/swfipn-toolchain/bin/python3 -c "import httpx, pymongo, pytest, requests, ruff"
  git --version
  jq --version
  curl --version | head -n 1
'
docker image inspect --format '{{.Id}}' "$tag"
