# OpenFS container image. Build from the repository root:
#   docker build -f deploy/Dockerfile --build-arg OPENFS_COMMIT=$(git rev-parse --short=12 HEAD) -t openfs .
# Run with deploy/compose.yaml (data in a volume, port on loopback only,
# a reverse proxy on the host for HTTPS).

FROM oven/bun:1.3.11

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
# Dev dependencies are needed at runtime: the server bundles the SPA
# (Tailwind plugin) when it starts.
RUN bun install --frozen-lockfile

COPY tsconfig.json bun-env.d.ts ./
COPY src ./src
COPY scripts ./scripts
COPY docs ./docs

ARG OPENFS_COMMIT=""
ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    OPENFS_COMMIT=${OPENFS_COMMIT} \
    HOST=0.0.0.0 \
    PORT=3000 \
    TRUST_PROXY=1 \
    DB_PATH=/data/fahrschule.db \
    FILE_STORE_DIR=/data/files \
    BACKUP_DIR=/data/backups \
    TENANTS_DIR=/data/tenants \
    REGISTRY_PATH=/data/registry.db \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["bun", "src/index.ts"]
