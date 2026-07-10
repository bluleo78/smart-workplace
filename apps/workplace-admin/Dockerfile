# === Stage 1: Build ===
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# 워크스페이스 설정·lockfile·.npmrc(shamefully-hoist) 먼저 복사 → 의존성 캐싱
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/workplace-admin/package.json ./apps/workplace-admin/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-admin...

COPY apps/workplace-admin/ ./apps/workplace-admin/

RUN pnpm --filter @smart-workplace/workplace-admin build

# === Stage 2: Nginx (DHI 하드닝 런타임, non-root) ===
# distroless nginx — shell 없음, nginx(UID 65532) 유저, 8080 리슨(nonroot 는 <1024 바인드 불가).
# 기본 nginx.conf 가 conf.d/*.conf 를 include 하므로 server 블록만 덮어쓴다(nginx.conf listen 8080).
# ENTRYPOINT/CMD(["nginx"] + ["-g","daemon off;"])는 베이스에 내장 → 재정의 금지.
FROM dhi.io/nginx:1.29-debian13

COPY --from=build /app/apps/workplace-admin/dist /usr/share/nginx/html
COPY apps/workplace-admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
