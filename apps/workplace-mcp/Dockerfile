# === Stage 1: Build ===
# 빌드 스테이지에 --platform=$BUILDPLATFORM 를 쓰지 않는다(빌더 네이티브 아키 고정 금지).
# @anthropic-ai/claude-agent-sdk 는 아키별 네이티브 CLI 바이너리(linux-x64-musl 등)를
# optional dep 으로 받는데, 빌드 스테이지를 빌더(arm64) 아키에 고정하면 그 node_modules 가
# 타깃(amd64) 런타임으로 그대로 COPY 되어 "Native CLI binary for linux-x64 not found" 로 죽는다.
# 핀을 빼면 멀티아치 빌드 시 각 타깃이 자기 아키(QEMU 에뮬)로 install 해 올바른 네이티브 패키지를 받는다.
FROM node:22-alpine AS build

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
FROM node:22-alpine

# 비루트 사용자로 실행 (ai-agent 와 동일 관례 — 최소권한 유지)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=build /prod ./
COPY --from=build /app/apps/workplace-mcp/dist ./dist

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 7090

CMD ["node", "dist/index.js"]
