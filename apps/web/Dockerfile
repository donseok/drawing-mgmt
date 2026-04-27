# syntax=docker/dockerfile:1.7
#
# apps/web — Next.js 14 (App Router) production image.
#
# R32 X-1.a — multistage alpine build that emits a thin runtime layer
# containing only the Next.js standalone server, Prisma client, sharp's
# native libs, and a non-root user.
#
# Build context MUST be the repo root (so pnpm workspaces resolve):
#
#   docker build -f apps/web/Dockerfile -t drawmgmt/web:dev .
#
# Runtime env (none baked in — pass at `docker run`):
#   DATABASE_URL          postgres connection string
#   REDIS_URL             redis://redis:6379
#   AUTH_SECRET           Auth.js JWT secret
#   NEXTAUTH_URL          public URL of the app
#   FILE_STORAGE_ROOT     mounted volume for uploaded artifacts
#
# License posture:
#   - All node deps are MIT/Apache (sharp, pdf-lib, three, dxf-viewer …).
#   - The web container does NOT install LibreDWG (worker's job). Even if a
#     user shells in, GPL isolation is preserved because no JS bindings are
#     imported.
# ============================================================================

ARG NODE_VERSION=20.18.0
ARG ALPINE_VERSION=3.20
ARG PNPM_VERSION=9.12.0

# ─── 1) deps ────────────────────────────────────────────────────────────────
# Install the full monorepo's dev+prod deps once. We rely on pnpm's workspace
# linking so apps/web sees @drawing-mgmt/shared by source.
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps
ARG PNPM_VERSION

# libc6-compat: Prisma's query engine + sharp's prebuilt binaries expect glibc
# symbols that musl supplies via this shim.
RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

# Copy only manifests first so Docker can cache the install layer.
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

# Pull installed deps from `deps` stage.
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules

# Copy the actual sources.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

# Generate Prisma client (the schema lives in apps/web/prisma).
RUN pnpm --filter @drawing-mgmt/web db:generate

# Ensure apps/web/public exists (Next does not create it). The directory may
# legitimately be empty in this repo today; we still need it for the COPY in
# the runner stage and for Next's static asset routing.
RUN mkdir -p apps/web/public

# Build Next.js. The standalone trace (set in next.config.mjs) walks
# the workspace root we exposed via outputFileTracingRoot.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN pnpm --filter @drawing-mgmt/web build

# ─── 3) runner ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runner
ARG NODE_VERSION

# libc6-compat for sharp / Prisma engines at runtime; openssl for Prisma; tini
# as PID 1 so SIGTERM from `docker stop` actually unwinds Next properly.
RUN apk add --no-cache libc6-compat openssl tini \
 && addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Next's standalone build emits a self-contained server tree under
# `.next/standalone`. With `outputFileTracingRoot` set to the monorepo
# root, that tree is rooted at the repo (e.g. `apps/web/server.js`,
# `node_modules/...`). Copy it intact, then layer in the public/static
# bundles which standalone leaves to the operator.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

# Prisma engines + the schema (used by Prisma Client at runtime to find
# its query engine). The schema isn't strictly required to run, but is
# tiny and useful for `prisma migrate deploy` exec'd into the container.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/prisma ./apps/web/prisma

USER nextjs

EXPOSE 3000

# Health hint for orchestrators (compose/k8s configure their own probes;
# this is just a self-documenting default).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/api/v1/health || exit 1

# `tini -- node` so signals propagate. Standalone's entrypoint is
# `apps/web/server.js` because outputFileTracingRoot=monorepo root.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
