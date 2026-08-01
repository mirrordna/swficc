# SWFIPN Parity Toolchain

This image is the durable DigitalOcean execution environment for SWFI parity
and source-truth gates. Macs may author or relay source, but they are not a
runtime or package dependency.

The image contains pinned Node, Python, PyMongo, pytest, Ruff, Git, `jq`, and
`curl`. Both the base image digest and package revisions are pinned. It must be
built and retained on DigitalOcean, identified by immutable image ID in every
verification receipt, and mounted against candidate source read-only. It must
never receive a production image tag.

Build and verify it on the acceptance droplet:

```bash
infra/digitalocean/toolchains/parity/build-and-verify.sh
docker tag \
  swfipn/parity-toolchain:20260801 \
  swfipn/parity-toolchain:current
```

The `current` tag is a convenience pointer only. Receipts must record the
immutable image ID returned by `docker image inspect`, not the mutable tag.
The toolchain is QA infrastructure and is not part of the production Compose
topology.
