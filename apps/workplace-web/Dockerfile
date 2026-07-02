# === Stage 1: Build ===
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# 워크스페이스 설정·lockfile·.npmrc(shamefully-hoist) 먼저 복사 → 의존성 캐싱
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/workplace-web/package.json ./apps/workplace-web/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-web...

COPY apps/workplace-web/ ./apps/workplace-web/

# 운영 도메인에서 MCP 연결 명령이 localhost 로 안내되지 않도록 빌드 시점에 주입.
# Vite 는 import.meta.env.VITE_* 를 빌드 시점 정적 인라인하므로 런타임 env 로는 불가.
ARG VITE_MCP_URL
ENV VITE_MCP_URL=$VITE_MCP_URL

RUN pnpm --filter @smart-workplace/workplace-web build

# === Stage 2: Nginx ===
FROM nginx:alpine

COPY --from=build /app/apps/workplace-web/dist /usr/share/nginx/html
COPY apps/workplace-web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
