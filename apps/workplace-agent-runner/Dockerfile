# workplace-agent-runner 이미지 — 실행 위치마다 Helm 차트(deploy/helm-agent-runner)로 설치한다.
# 빌드 컨텍스트는 저장소 루트: docker build -f apps/workplace-agent-runner/Dockerfile .

# === Stage 1: Build ===
# --platform=$BUILDPLATFORM 를 쓰지 않는다(= TARGETPLATFORM 네이티브 빌드) — 산출물이 타깃 런타임에서 그대로 돌게.
# glibc 베이스(node:24) — glibc DHI 런타임(dhi.io/node:24)과 libc 를 맞춘다.
FROM node:24 AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# pnpm-workspace.yaml 의 patchedDependencies 가 patches 를 참조 — 없으면 frozen install 이 실패한다
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
COPY apps/workplace-agent-runner/package.json ./apps/workplace-agent-runner/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-agent-runner...

COPY apps/workplace-agent-runner/ ./apps/workplace-agent-runner/

RUN pnpm --filter @smart-workplace/workplace-agent-runner build

RUN pnpm --filter @smart-workplace/workplace-agent-runner deploy --legacy --prod /prod

# === Stage 2: Runtime ===
# DHI 하드닝 런타임(distroless) — shell/패키지매니저 없음, nonroot(node, UID 1000) 기본.
FROM dhi.io/node:24-debian13

WORKDIR /app

COPY --from=build --chown=1000:1000 /prod ./
COPY --from=build --chown=1000:1000 /app/apps/workplace-agent-runner/dist ./dist

USER 1000

# /healthz
EXPOSE 8080

# 릴리스 버전·커밋(WP-436) — 빌드 인자가 바뀌어도 위 레이어 캐시가 깨지지 않도록 스테이지 맨 끝에 둔다.
ARG APP_VERSION=dev
ARG GIT_SHA=dev
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.source=https://gitlab.iacloud.kr/iacloud/smart-workplace

CMD ["node", "dist/main.js"]
