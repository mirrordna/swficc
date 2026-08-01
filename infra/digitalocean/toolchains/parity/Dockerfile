# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH=/opt/swfipn-toolchain/bin:$PATH

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates=20230311+deb12u1 \
        curl=7.88.1-10+deb12u15 \
        git=1:2.39.5-0+deb12u3 \
        jq=1.6-2.1+deb12u2 \
        python3=3.11.2-1+b1 \
        python3-venv=3.11.2-1+b1 \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/swfipn-toolchain

COPY requirements.lock /tmp/requirements.lock

RUN pip install --requirement /tmp/requirements.lock \
    && rm /tmp/requirements.lock

WORKDIR /work

CMD ["bash"]
