# === Stage 1: Build ===
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# 워크스페이스 설정·lockfile·.npmrc(shamefully-hoist) 먼저 복사 → 의존성 캐싱
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# pnpm-workspace.yaml 의 patchedDependencies(WP-113) 가 참조 — 없으면 frozen install 이 실패한다
COPY patches ./patches
COPY apps/workplace-admin/package.json ./apps/workplace-admin/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-admin...

COPY apps/workplace-admin/ ./apps/workplace-admin/
# vite.config 가 import 하는 버전 상수·version.json 헬퍼(WP-439) — 빌드가 tsc -b 로 vite.config.ts 를 타입 검사하므로 .d.mts 선언도 함께 복사한다(없으면 TS7016)
COPY scripts/vite-app-version.mjs scripts/vite-app-version.d.mts ./scripts/

# 릴리스 버전·커밋(WP-436) — vite 가 빌드 상수(__APP_VERSION__ 등)와 version.json 으로 번들에 박는다.
# VITE_* 가 아닌 일반 env 로 받는다(클라이언트 env 노출 방지). 소스 COPY 뒤에 두어 의존성 레이어 캐시는 지킨다.
ARG APP_VERSION=dev
ARG GIT_SHA=dev
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA

RUN pnpm --filter @smart-workplace/workplace-admin build

# === Stage 2: Nginx (DHI 하드닝 런타임, non-root) ===
# distroless nginx — shell 없음, nginx(UID 65532) 유저, 8080 리슨(nonroot 는 <1024 바인드 불가).
# 기본 nginx.conf 가 conf.d/*.conf 를 include 하므로 server 블록만 덮어쓴다(nginx.conf listen 8080).
# ENTRYPOINT/CMD(["nginx"] + ["-g","daemon off;"])는 베이스에 내장 → 재정의 금지.
FROM dhi.io/nginx:1.29-debian13

COPY --from=build /app/apps/workplace-admin/dist /usr/share/nginx/html
COPY apps/workplace-admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# 릴리스 버전·커밋(WP-436) — 빌드 인자가 바뀌어도 위 레이어 캐시가 깨지지 않도록 스테이지 맨 끝에 둔다.
# LABEL 은 이미지 메타데이터로 버전을 식별한다(번들 안의 버전은 빌드 스테이지에서 주입).
ARG APP_VERSION=dev
ARG GIT_SHA=dev
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.source=https://gitlab.iacloud.kr/iacloud/smart-workplace
