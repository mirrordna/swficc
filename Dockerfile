# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_SWFI_BACKEND_URL=same-origin
ARG NEXT_PUBLIC_BACKEND_URL=
ARG SWFIPN_ASSET_VERSION=
ARG SWFIPN_GIT_SHA=unknown
ARG SWFIPN_GIT_DIRTY=0
ENV NEXT_PUBLIC_SWFI_BACKEND_URL=${NEXT_PUBLIC_SWFI_BACKEND_URL}
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ENV SWFIPN_ASSET_VERSION=${SWFIPN_ASSET_VERSION}
ENV SWFIPN_GIT_SHA=${SWFIPN_GIT_SHA}
ENV SWFIPN_GIT_DIRTY=${SWFIPN_GIT_DIRTY}
RUN npm run build

FROM python:3.13-alpine AS runtime
ARG SWFIPN_ASSET_VERSION=
ARG SWFIPN_GIT_SHA=unknown
ARG SWFIPN_GIT_DIRTY=0
LABEL org.opencontainers.image.revision="${SWFIPN_GIT_SHA}" \
  ai.activemirror.swfipn.asset_version="${SWFIPN_ASSET_VERSION}" \
  ai.activemirror.swfipn.git_dirty="${SWFIPN_GIT_DIRTY}"
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SWFIPN_HOST=0.0.0.0 \
    SWFIPN_PORT=8353 \
    SWFIPN_ROOT=/app/out \
    SWFIPN_BACKEND=http://host.docker.internal:8362 \
    SWFIPN_BACKEND_TIMEOUT=60
RUN adduser -D -H -u 10001 swfipn
COPY --from=build /app/out /app/out
COPY scripts/serve-static-with-headers.py /app/serve-static-with-headers.py
COPY scripts/swfipn-freshness-sync.py /app/swfipn-freshness-sync.py
COPY scripts/swfipn-container-healthcheck.py /app/swfipn-container-healthcheck.py
RUN chmod 0555 /app/serve-static-with-headers.py /app/swfipn-freshness-sync.py /app/swfipn-container-healthcheck.py \
  && chown -R swfipn:swfipn /app
USER swfipn
EXPOSE 8353
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python /app/swfipn-container-healthcheck.py
CMD ["python", "/app/serve-static-with-headers.py"]
