# 노트 실시간 동시 편집 동기화 서버(workplace-collab, WP-288) — apps/workplace-mcp/Dockerfile 과 같은 구조.
# === Stage 1: Build ===
# --platform=$BUILDPLATFORM 를 쓰지 않는다(= TARGETPLATFORM 네이티브 빌드) — prod node_modules 가 타깃 런타임과
# 같은 아키/libc 여야 하기 때문. glibc 베이스(node:24, alpine=musl 금지) — DHI 런타임(glibc)과 libc 를 맞춘다.
FROM node:24 AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# 워크스페이스 설정·lockfile·.npmrc(shamefully-hoist) 먼저 복사 → 의존성 레이어 캐싱
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# pnpm-workspace.yaml 의 patchedDependencies(WP-113) 가 참조 — 없으면 frozen install 이 실패한다
COPY patches ./patches
COPY apps/workplace-collab/package.json ./apps/workplace-collab/
COPY packages/wiki-editor-schema/package.json ./packages/wiki-editor-schema/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-collab...

# 노트 에디터 공용 스키마(WP-284) — TS 소스를 export 하므로 빌드 산출물이 없다. tsup 이 번들에 포함한다(noExternal).
COPY packages/wiki-editor-schema/src/ ./packages/wiki-editor-schema/src/
COPY apps/workplace-collab/ ./apps/workplace-collab/

RUN pnpm --filter @smart-workplace/workplace-collab build

# 런타임엔 번들(dist) + prod node_modules(@hocuspocus/server·yjs·@tiptap/* 등 external 의존성)만.
RUN pnpm --filter @smart-workplace/workplace-collab deploy --legacy --prod /prod

# === Stage 2: Runtime ===
# DHI 하드닝 런타임(distroless) — shell/패키지매니저 없음, nonroot(UID 1000). 헬스 체크는 httpGet(GET /health) 로.
FROM dhi.io/node:24-debian13

WORKDIR /app

COPY --from=build --chown=1000:1000 /prod ./
COPY --from=build --chown=1000:1000 /app/apps/workplace-collab/dist ./dist

USER 1000

ENV PORT=7095
EXPOSE 7095

CMD ["node", "dist/index.js"]
