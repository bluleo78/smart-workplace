# === Stage 1: Build ===
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/workplace-ai-agent/package.json ./apps/workplace-ai-agent/

RUN pnpm install --frozen-lockfile --filter @smart-workplace/workplace-ai-agent...

COPY apps/workplace-ai-agent/ ./apps/workplace-ai-agent/

RUN pnpm --filter @smart-workplace/workplace-ai-agent build

RUN pnpm --filter @smart-workplace/workplace-ai-agent deploy --legacy --prod /prod

# === Stage 2: Runtime ===
FROM node:22-alpine

# Claude Code CLI — @anthropic-ai/claude-agent-sdk 요구
RUN npm install -g @anthropic-ai/claude-code

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
