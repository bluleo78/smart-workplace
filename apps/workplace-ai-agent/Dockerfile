# === Stage 1: Build ===
# 빌드 스테이지는 최종 이미지에 남지 않으므로 stock 이미지를 쓴다 (정책 A: 런타임만 DHI).
# ⚠️ --platform=$BUILDPLATFORM 를 쓰지 않는다(= TARGETPLATFORM 네이티브 빌드). 이 앱은
#    @anthropic-ai/claude-agent-sdk 의 arch/libc별 네이티브 `claude` 바이너리(optionalDependency)와
#    opencode 바이너리를 런타임에 spawn 하므로, 산출물이 아키텍처에 종속된다.
# ⚠️ glibc 베이스여야 한다(alpine=musl 금지). alpine 에서 deploy 하면 claude-agent-sdk-linux-*-musl 이
#    설치돼 glibc DHI 런타임에서 실행 불가. node:24(Debian, glibc)에서 deploy 해야 -linux-<arch>(glibc)가 깔린다.
FROM node:24 AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# .npmrc(shamefully-hoist=true) 포함 — 미포함 시 node_modules 비평탄화로 tsc TS2742
# (@types/express-serve-static-core 명명 불가) 빌드 실패.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/workplace-ai-agent/package.json ./apps/workplace-ai-agent/
COPY packages/issue-tools-shared/package.json ./packages/issue-tools-shared/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-ai-agent...

COPY packages/issue-tools-shared/ ./packages/issue-tools-shared/
COPY apps/workplace-ai-agent/ ./apps/workplace-ai-agent/

RUN pnpm --filter @smart-workplace/issue-tools-shared build
RUN pnpm --filter @smart-workplace/workplace-ai-agent build

# --prod deploy: /prod/node_modules 에 claude-agent-sdk 네이티브 `claude` 바이너리(glibc optionalDependency)
# 를 동봉한다. SDK(0.2.141)는 이 번들 바이너리를 인-프로세스로 쓰므로 별도 `npm install -g claude-code` 불필요(#462).
RUN pnpm --filter @smart-workplace/workplace-ai-agent deploy --legacy --prod /prod

# opencode 바이너리 벤더링 — 런타임에 `opencode serve`로 spawn되므로 PATH에 있어야 한다.
# 인스톨러가 uname -m/ldd로 arch·libc를 자동감지 → glibc TARGETPLATFORM 네이티브 바이너리 획득.
# distroless 런타임엔 curl/셸이 없으므로 반드시 빌드 스테이지에서 받아둔다.
# ⚠️ 버전 고정 필수: 미지정 시 인스톨러가 GitHub '최신'을 받아 빌드 재현성이 깨진다.
#    OPENCODE_VERSION 은 @opencode-ai/sdk(package.json ^1.17.13)와 호환되는 값으로 유지(서버↔클라이언트 스큐 방지).
ARG OPENCODE_VERSION=1.17.18
RUN curl -fsSL https://opencode.ai/install | bash -s -- --version "${OPENCODE_VERSION}" \
    && cp /root/.opencode/bin/opencode /opencode

# 런타임 nonroot(node, uid 1000)가 쓸 $HOME(/home/node) 스켈레톤을 미리 만든다.
# spawn 되는 claude 가 ~/.claude 에 쓴다. 토큰 자체는 매 호출 시 workplace-api DB 에서 fetch(호스트 의존 없음).
RUN mkdir -p /home-node/.claude/debug /home-node/.claude/projects \
    && echo '{}' > /home-node/.claude/remote-settings.json

# === Stage 2: Runtime ===
# DHI 하드닝 런타임(distroless) — shell/패키지매니저 없음, nonroot(node, UID 1000) 기본.
# 현장 진단은 이미지에 shell을 넣지 않고 Docker Debug 사이드카로 수행한다.
FROM dhi.io/node:24-debian13

WORKDIR /app
ENV NODE_ENV=production
# DISABLE_FILE_LOG=true — 파일 로그(/app/logs)를 끄고 stdout 으로만 출력(컨테이너 정석).
# distroless 라 /app 은 root 소유 → uid 1000 이 /app/logs 를 못 만든다.
ENV DISABLE_FILE_LOG=true
ENV HOME=/home/node

# distroless라 RUN chown 불가 → COPY 시 nonroot(1000) 소유로 복사
COPY --from=build --chown=1000:1000 /prod ./
COPY --from=build --chown=1000:1000 /app/apps/workplace-ai-agent/dist ./dist
COPY --from=build --chown=1000:1000 /home-node/.claude /home/node/.claude
# opencode 바이너리를 PATH(/usr/local/bin)에 배치
COPY --from=build --chmod=755 /opencode /usr/local/bin/opencode

USER 1000

EXPOSE 7070

CMD ["node", "dist/index.js"]
