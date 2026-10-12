# syntax=docker/dockerfile:1.7
#
# KTL, self-hosted, in one container:
#
#   Postgres 17          your data (one volume: /data)
#   GoTrue               accounts, passwords, sessions
#   PostgREST            the data API, guarded by row-level security
#   Node gateway         the web app, setup and admin pages, and the one
#                        front door on :3000 (reverse-proxy friendly):
#                        live updates, push, backups, account deletion
#   cloudflared          optional, when a Cloudflare Tunnel token is set
#
# all supervised by s6-overlay. Build from the repository root:
#
#   docker build -f selfhost/Dockerfile -t ktl .

ARG NODE_VERSION=22
ARG PG_MAJOR=17
ARG GOTRUE_VERSION=v2.197.0
ARG POSTGREST_VERSION=v14.18

# ── the web app ────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public public
COPY src src
RUN npx vite build && node -p "require('./package.json').version" > dist/version.txt

# ── the gateway's dependencies ─────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS gateway
WORKDIR /app/gateway
COPY selfhost/gateway/package.json selfhost/gateway/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM supabase/gotrue:${GOTRUE_VERSION} AS gotrue
FROM postgrest/postgrest:${POSTGREST_VERSION} AS postgrest
FROM node:${NODE_VERSION}-bookworm-slim AS node

# ── the image ──────────────────────────────────────────────────────────
FROM postgres:${PG_MAJOR}-bookworm

ARG TARGETARCH
ARG S6_OVERLAY_VERSION=3.2.1.0
ARG CLOUDFLARED_VERSION=2026.10.0

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils libstdc++6; \
    rm -rf /var/lib/apt/lists/*; \
    case "$TARGETARCH" in \
      amd64) S6_ARCH=x86_64; CF_ARCH=amd64 ;; \
      arm64) S6_ARCH=aarch64; CF_ARCH=arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}"; \
    curl -fsSL "$base/s6-overlay-noarch.tar.xz" | tar -C / -Jxp; \
    curl -fsSL "$base/s6-overlay-${S6_ARCH}.tar.xz" | tar -C / -Jxp; \
    curl -fsSL -o /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${CF_ARCH}"; \
    chmod 755 /usr/local/bin/cloudflared

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=gotrue /usr/local/bin/auth /usr/local/bin/gotrue
COPY --from=gotrue /usr/local/etc/auth/migrations /usr/local/etc/auth/migrations
COPY --from=postgrest /bin/postgrest /usr/local/bin/postgrest

# Fail the build here, not at first boot, if a copied binary can't run
# on this base (e.g. one linked against musl).
RUN node --version && gotrue version && postgrest --version && cloudflared --version

COPY --from=web /src/dist /app/web
COPY --from=gateway /app/gateway/node_modules /app/gateway/node_modules
COPY selfhost/gateway /app/gateway
COPY selfhost/db /app/db
COPY db/migrations /app/db/migrations
COPY db/tests /app/db/tests
COPY selfhost/rootfs /

# Belt and braces for a Windows checkout: LF endings and the exec bit.
RUN set -eux; \
    find /etc/s6-overlay /etc/ktl /usr/local/bin/ktl-admin -type f -exec sed -i 's/\r$//' {} +; \
    find /etc/s6-overlay/s6-rc.d -type f \( -name run -o -name up -o -name finish -o -name check \) -exec chmod 755 {} +; \
    chmod 755 /etc/s6-overlay/scripts/* /usr/local/bin/ktl-admin; \
    mkdir -p /data /var/run/postgresql; \
    chown postgres:postgres /var/run/postgresql

ENV S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_KILL_GRACETIME=15000 \
    S6_VERBOSITY=1 \
    PGDATA=/data/postgres \
    KTL_PORT=3000 \
    TZ=Europe/London

VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/healthz >/dev/null || exit 1

ENTRYPOINT ["/init"]
