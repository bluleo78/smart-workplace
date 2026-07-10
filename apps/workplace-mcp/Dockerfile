# === Stage 1: Build ===
# --platform=$BUILDPLATFORM 를 쓰지 않는다(= TARGETPLATFORM 네이티브 빌드). 아키/libc 종속
# 산출물이 타깃 런타임에서 그대로 동작해야 하기 때문.
# glibc 베이스(node:24, alpine=musl 금지) — glibc DHI 런타임(dhi.io/node:24)과 libc 를 맞춘다.
FROM node:24 AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# .npmrc(shamefully-hoist=true) 포함 — 미포함 시 node_modules 비평탄화로 tsc TS2742
# (@types/express-serve-static-core 명명 불가) 빌드 실패.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/workplace-mcp/package.json ./apps/workplace-mcp/
COPY packages/issue-tools-shared/package.json ./packages/issue-tools-shared/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-mcp...

COPY packages/issue-tools-shared/ ./packages/issue-tools-shared/
COPY apps/workplace-mcp/ ./apps/workplace-mcp/

RUN pnpm --filter @smart-workplace/issue-tools-shared build
RUN pnpm --filter @smart-workplace/workplace-mcp build

RUN pnpm --filter @smart-workplace/workplace-mcp deploy --legacy --prod /prod

# === Stage 2: Runtime ===
# DHI 하드닝 런타임(distroless) — shell/패키지매니저 없음, nonroot(node, UID 1000) 기본.
# distroless 라 addgroup/adduser/RUN chown 불가 → COPY 시 nonroot(1000) 소유로 복사.
FROM dhi.io/node:24-debian13

WORKDIR /app

COPY --from=build --chown=1000:1000 /prod ./
COPY --from=build --chown=1000:1000 /app/apps/workplace-mcp/dist ./dist

USER 1000

EXPOSE 7090

CMD ["node", "dist/index.js"]
