# SWFIPN Browser QA Image

This image is the DigitalOcean-only execution environment for frontend builds,
Node regression tests, and real Chromium acceptance gates. It pins the official
Playwright browser image and installs the exact `package-lock.json` dependency
graph in a cacheable layer before copying candidate source.

Build it from the repository root on DigitalOcean:

```bash
infra/digitalocean/toolchains/browser-qa/build-and-verify.sh
```

The image is QA infrastructure. It must not receive a production tag or enter
the production Compose topology. Receipts must bind to its immutable image ID,
the Dockerfile hash, the package-lock hash, and the candidate source commit.
