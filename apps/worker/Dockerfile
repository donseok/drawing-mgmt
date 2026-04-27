# syntax=docker/dockerfile:1.7
#
# apps/worker — DWG conversion + thumbnail + PDF print BullMQ worker.
#
# R32 X-1.b — multistage alpine build with the runtime deps the worker
# actually needs:
#
#   - sharp (npm)              → ships its own libvips prebuild for
#                                linuxmusl, so no system vips package
#                                is required at runtime.
#   - libredwg + dwg2dxf CLI    → built from source in a dedicated stage;
#                                GPL, invoked only via subprocess from
#                                apps/worker/src/libredwg.ts (never as a
#                                JS library). Alpine and Debian don't
#                                ship a libredwg-tools package, so we
#                                pin LIBREDWG_VERSION and build it here.
#   - tini                     → PID 1 signal handler
#
# ODA File Converter is intentionally NOT installed:
#   - It's distributed under a per-user license that doesn't permit blanket
#     image redistribution.
#   - Operators provide it via a bind-mount + ODA_CONVERTER_PATH env. When
#     ODA isn't available the worker automatically falls through to LibreDWG
#     (see apps/worker/src/index.ts → convertDwgToDxf).
#
# Build context MUST be the repo root:
#
#   docker build -f apps/worker/Dockerfile -t drawmgmt/worker:dev .
#
# Runtime env:
#   DATABASE_URL                 postgres connection string
#   REDIS_URL                    redis://redis:6379
#   FILE_STORAGE_ROOT            shared volume (must match web container)
#   ODA_CONVERTER_PATH           OPTIONAL — path inside the container where
#                                ODAFileConverter has been bind-mounted.
#                                Falls back to libredwg if absent.
#   LIBREDWG_DWG2DXF_PATH        OPTIONAL — override the system dwg2dxf
#
# License posture:
#   - LibreDWG is GPL-3+. The runtime image holds the compiled binaries
#     under /usr/local/bin and /usr/local/lib. Our TypeScript code spawns
#     `/usr/local/bin/dwg2dxf` via execa (apps/worker/src/libredwg.ts) —
#     no @mlightcad/libredwg-web, libredwg-js, or other JS port is imported.
#     The MIT/Apache npm tree therefore never links GPL code.
#   - sharp, pdf-lib, bullmq, ioredis, prisma, execa, pino are all MIT/Apache.
# ============================================================================

ARG NODE_VERSION=20.18.0
ARG ALPINE_VERSION=3.20
ARG PNPM_VERSION=9.12.0
# Pin LibreDWG so image builds are reproducible. Bump cautiously and
# re-test against fixture .dwg files from real users.
ARG LIBREDWG_VERSION=0.13.4

# ─── 0) libredwg-build ──────────────────────────────────────────────────────
# Compile the LibreDWG `dwg2dxf` CLI from a release tarball in an isolated
# stage. Outputs land in /opt/libredwg/{bin,lib} and are copied into the
# runner. Build-time toolchain never reaches the final image.
FROM alpine:${ALPINE_VERSION} AS libredwg-build
ARG LIBREDWG_VERSION

RUN apk add --no-cache \
        build-base \
        autoconf \
        automake \
        libtool \
        pkgconfig \
        perl \
        texinfo \
        curl \
        tar \
        xz

WORKDIR /src
RUN curl -fsSL "https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.xz" \
        -o libredwg.tar.xz \
 && tar -xJf libredwg.tar.xz \
 && rm libredwg.tar.xz \
 && mv "libredwg-${LIBREDWG_VERSION}" libredwg

WORKDIR /src/libredwg
# --disable-bindings: skip Python/Perl/Ruby SWIG bindings we don't use.
# --disable-static:   shared lib only — smaller, simpler.
# --enable-release:   build with optimization.
# Programs installed include the `dwg2dxf` CLI we need.
RUN ./configure \
        --prefix=/opt/libredwg \
        --disable-bindings \
        --disable-static \
        --enable-release \
 && make -j"$(nproc)" \
 && make install-strip

# ─── 1) deps ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps
ARG PNPM_VERSION

# sharp 0.33 ships a prebuilt for `linuxmusl-x64` / `linuxmusl-arm64`, so we
# don't need to compile against the system libvips. libc6-compat is the
# glibc shim Prisma's query engine + a few prebuilt npm modules expect.
RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ─── 2) builder ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS builder
ARG PNPM_VERSION

RUN apk add --no-cache libc6-compat openssl \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker ./apps/worker
COPY packages/shared ./packages/shared
# Worker imports @prisma/client which expects the generated client.
# The schema lives under apps/web — copy it in for `prisma generate`.
COPY apps/web/prisma ./apps/web/prisma
COPY apps/web/package.json ./apps/web/package.json

# Generate Prisma client into the hoisted node_modules so the worker
# resolves @prisma/client through the workspace.
RUN pnpm --filter @drawing-mgmt/web db:generate

# Build the worker's TypeScript → dist/.
ENV NODE_ENV=production
RUN pnpm --filter @drawing-mgmt/worker build

# ─── 3) runner ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runner

# Runtime system deps:
#   - openssl        : Prisma engines link against it.
#   - tini           : PID 1 signal handler.
#   - libc6-compat   : glibc shim used by sharp's prebuilt + Prisma engines.
#
# sharp 0.33 ships a `linuxmusl` prebuild with libvips bundled, so we
# don't need the alpine `vips` package at runtime.
RUN apk add --no-cache libc6-compat openssl tini \
 && addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs worker

# Drop in the LibreDWG binaries from the dedicated build stage.
# /opt/libredwg/bin/dwg2dxf, /opt/libredwg/lib/libredwg.so*. We expose them
# under the standard prefix so /usr/local/bin/dwg2dxf "just works".
# musl auto-resolves shared libs from LD_LIBRARY_PATH (set below) — no
# `ldconfig` step is needed (and alpine doesn't ship one).
COPY --from=libredwg-build /opt/libredwg/bin/   /usr/local/bin/
COPY --from=libredwg-build /opt/libredwg/lib/   /usr/local/lib/

WORKDIR /app

ENV NODE_ENV=production \
    LIBREDWG_DWG2DXF_PATH=/usr/local/bin/dwg2dxf \
    LD_LIBRARY_PATH=/usr/local/lib

# Copy the worker bundle. We carry the workspace tree intact so pnpm's
# symlinked node_modules (root + per-package) keep resolving:
#
#   /app/apps/worker/dist                 ← built JS
#   /app/apps/worker/node_modules         ← symlinks into hoisted root
#   /app/node_modules                     ← hoisted real deps
#   /app/packages/shared                  ← workspace dep (resolved via link)
#
# Slightly larger than `pnpm deploy --prod` would produce, but immune to
# symlink breakage and works without inject-workspace-packages.
COPY --from=builder --chown=worker:nodejs /repo/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=worker:nodejs /repo/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /repo/packages/shared ./packages/shared
COPY --from=builder --chown=worker:nodejs /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder --chown=worker:nodejs /repo/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /repo/apps/worker/node_modules ./apps/worker/node_modules

# Schema alongside the worker for debug ergonomics
# (`docker exec ... npx prisma migrate status`).
COPY --from=builder --chown=worker:nodejs /repo/apps/web/prisma ./apps/web/prisma

USER worker

# The worker has no inbound port — it pulls from BullMQ. No EXPOSE.
# Healthcheck: `dwg2dxf --version` proves the CLI is wired and the
# GPL-isolation policy holds (we have the binary, not bindings).
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD dwg2dxf --version >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js"]
