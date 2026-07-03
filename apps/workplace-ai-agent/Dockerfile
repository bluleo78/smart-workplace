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
COPY apps/workplace-ai-agent/package.json ./apps/workplace-ai-agent/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-ai-agent...

COPY apps/workplace-ai-agent/ ./apps/workplace-ai-agent/

RUN pnpm --filter @smart-workplace/workplace-ai-agent build

RUN pnpm --filter @smart-workplace/workplace-ai-agent deploy --legacy --prod /prod

# === Stage 2: Runtime ===
FROM node:22-alpine

# Claude Code CLI — @anthropic-ai/claude-agent-sdk 요구
RUN npm install -g @anthropic-ai/claude-code

# opencode CLI — @opencode-ai/sdk 의 createOpencode() 가 순수 JS 서버가 아니라 이 실행파일을
# cross-spawn 으로 자식 프로세스 spawn 하는 방식이라, npm 패키지 설치만으로는 부족하고 PATH 상에
# 별도 설치가 필요하다(docs/OPENCODE_LIVE_SMOKE.md 참고). 설치 스크립트가 bash 전용 문법([[ ]])을
# 쓰는데 alpine 기본 쉘은 busybox ash 라 bash+curl 을 우선 설치.
RUN apk add --no-cache --virtual .opencode-install curl bash \
    && curl -fsSL https://opencode.ai/install | bash \
    && mv /root/.opencode/bin/opencode /usr/local/bin/opencode \
    && apk del .opencode-install

# Claude Code CLI 가 root 실행을 차단하므로 비루트 사용자 생성
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=build /prod ./
COPY --from=build /app/apps/workplace-ai-agent/dist ./dist

RUN chown -R appuser:appgroup /app

RUN mkdir -p /home/appuser/.claude/debug /home/appuser/.claude/projects \
    && echo '{}' > /home/appuser/.claude/remote-settings.json \
    && chown -R appuser:appgroup /home/appuser/.claude

USER appuser

EXPOSE 7070

CMD ["node", "dist/index.js"]
