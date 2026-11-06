# Codex 작업 공간 이미지(WP-1297) — Works 가 띄우는 AI Pod 의 agent 컨테이너. 엔트리포인트가 Codex·플러그인·저장소·work-loop 칸을 띄운다.
# Pod 와의 계약(마운트·env·UID 1001·디스크 배치)은 docs/integrations/agent-pod-contract.md.
#
# Codex(@openai/codex)는 공개 npm 패키지라 이미지에 고정 버전으로 넣는다(Gen:iA Code 처럼 Pod 가 받지 않는다). 로그인은 ChatGPT 구독 계정의
# auth.json 을 Pod 가 뜰 때 심는다(엔트리포인트 seed_login). 베이스가 DHI 규칙의 예외인 이유는 Claude Code 이미지와 같다(개발용 작업 공간).
# 컨텍스트는 저장소 루트(image-catalog.json) — Claude Code 이미지의 공용 함수(lib.sh)·작업 화면(agent-screen)·plugins.lock,
# Gen:iA Code 이미지의 code-simplifier 스킬, genia-works 플러그인을 함께 COPY 한다.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

# GitLab CLI(WP-1276) — 플러그인 gw-repo 가 GitLab MR 을 다룰 때 쓴다. apt 에 없어 공식 릴리스 .deb 를 아키텍처별 해시로 확인해 받는다.
ARG GLAB_VERSION=1.123.0
ARG GLAB_SHA256_AMD64=0effb3e550b80fd826b5a50655acc7fe7142728d0afe9a1d5d857aa2fc651f5a
ARG GLAB_SHA256_ARM64=f7c1930977fdd75bea6735eed0b628d4411536b3208c124101db42d6cfb9378e

# Claude Code — 실행하지 않고 빌드 때 플러그인을 받는 데만 쓴다(아래). Claude 이미지와 같은 버전으로 둔다.
ARG CLAUDE_CODE_VERSION=2.1.316

ENV DEBIAN_FRONTEND=noninteractive

# ---- Claude 이미지 Dockerfile 과 같은 도구 블록 — 바꾸면 함께(apps/workplace-agent-claude-code/Dockerfile) ----
# 도구 — gh·docker(CLI·compose v2)는 공식 apt 저장소. openjdk postinst 가 man 링크를 만들다 실패하지 않게 man 폴더를 먼저 만든다(PoC).
# tini 는 PID 1 로 SIGTERM 을 엔트리포인트에 넘기고 고아 프로세스(tmux 서버 등)를 거둔다.
# fonts-noto-cjk — 한글 폭이 달라져 배치를 재는 E2E 가 작업 공간에서만 깨지지 않게(WP-1285). fonts-wqy-zenhei 는 우선순위가 높아 지운다.
RUN set -eux; \
    mkdir -p /usr/share/man/man1 /etc/apt/keyrings; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list; \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      tmux git jq tini procps less openssh-client unzip \
      openjdk-21-jdk-headless gh docker-ce-cli docker-compose-plugin docker-buildx-plugin \
      fonts-noto-cjk; \
    apt-get purge -y fonts-wqy-zenhei; \
    rm -rf /var/lib/apt/lists/*

# glab — 공식 릴리스 패키지(gitlab.com/gitlab-org/cli). 아키텍처마다 checksums.txt 의 해시로 확인한다.
RUN set -eux; \
    arch=$(dpkg --print-architecture); \
    case "$arch" in amd64) sum="$GLAB_SHA256_AMD64" ;; arm64) sum="$GLAB_SHA256_ARM64" ;; *) echo "glab: 지원하지 않는 아키텍처 $arch" >&2; exit 1 ;; esac; \
    curl -fsSL -o /tmp/glab.deb "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${arch}.deb"; \
    echo "${sum}  /tmp/glab.deb" | sha256sum -c -; \
    dpkg -i /tmp/glab.deb; \
    rm /tmp/glab.deb; \
    glab --version

# pnpm(corepack — 저장소의 packageManager 버전을 쓴다). jdtls·TS 언어 서버는 이 이미지에 넣지 않는다.
# Claude Code 는 플러그인을 받는 데만 쓴다 — genia 가 Claude Code 에 설치된 플러그인의 스킬·명령을 그대로 읽으므로(genia 2611.3.0)
# Claude 이미지와 같은 plugins.lock 을 받아 superpowers 등 개발 절차를 한 벌로 맞춘다(WP-1336).
RUN set -eux; \
    npm install -g --no-fund --no-audit "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; \
    npm cache clean --force; \
    corepack enable

# agent 사용자 UID/GID 1001 — 베이스의 pwuser 가 1001 이라 이름과 홈만 바꾼다(없으면 새로 만든다).
# /work 은 PVC·노드 폴더가 덮지만 그 없이 띄워도(확인용 docker run) 쓸 수 있게 1001 소유로 둔다. /run/genia 는 runner 가 파일만 꽂는 곳.
RUN set -eux; \
    if getent passwd 1001 >/dev/null; then \
      old=$(getent passwd 1001 | cut -d: -f1); oldg=$(getent group 1001 | cut -d: -f1); \
      groupmod -n agent "$oldg"; usermod -l agent -d /home/agent -m "$old"; \
    else \
      groupadd -g 1001 agent; useradd -u 1001 -g 1001 -m -d /home/agent -s /bin/bash agent; \
    fi; \
    mkdir -p /work/tmp /work/.cache /work/.gradle /work/.pnpm-store /work/agents /run/genia; \
    chown -R 1001:1001 /work
# ---- 같은 도구 블록 끝 ----

# Claude 이미지와 같은 플러그인 목록(WP-1336)을 Claude Code 로 홈(~/.claude/plugins)에 받은 뒤, 스킬이 있는 플러그인의 skills 폴더를
# Codex 가 읽는 ~/.agents/skills/<플러그인 이름> 으로 링크한다(11-06 codex 0.164 확인: ~/.agents/skills 아래를 링크 폴더까지 한 단계 더 찾는다 —
# superpowers·frontend-design). 명령(commands)·에이전트 형식은 Codex 가 읽지 못한다. 버전이 lock 과 다르면 빌드 실패다.
# genia-works 는 아래에서 구동기와 함께 따로 굳히므로 받지 않는다. 네트워크로 오래 걸리므로 자주 바뀌는 것(Codex 버전·COPY)보다 앞에 둔다(캐시) —
# 그래서 이 단계에 필요한 공용 함수(lib.sh)·lock 만 먼저 COPY 한다.
COPY --chmod=755 apps/workplace-agent-claude-code/bin/lib.sh /opt/genia/bin/lib.sh
COPY apps/workplace-agent-claude-code/plugins.lock /opt/genia/plugins.lock

USER 1001
# glab 의 사용 통계·업데이트 확인은 끈다 — 둘 다 gitlab.com 으로 나가고, 통계는 토큰 헤더까지 붙여 보낸다(1.123.0 에서 확인).
ENV HOME=/home/agent \
    PATH=/home/agent/.local/bin:$PATH \
    DISABLE_AUTOUPDATER=1 \
    GLAB_SEND_TELEMETRY=false \
    GLAB_CHECK_UPDATE=false
WORKDIR /home/agent
RUN set -eu; \
    bash -c '. /opt/genia/bin/lib.sh && install_plugins /opt/genia/plugins.lock "" genia-works@genia-works'; \
    mkdir -p /home/agent/.agents/skills; \
    claude plugin list --json | jq -r '.[] | "\(.id) \(.installPath)"' | while read -r id path; do \
      [ -d "$path/skills" ] || continue; \
      ln -sfn "$path/skills" "/home/agent/.agents/skills/${id%@*}"; \
    done; \
    test -f /home/agent/.agents/skills/superpowers/using-superpowers/SKILL.md
# 에이전트 형식이라 Codex 가 읽지 못하는 code-simplifier 는 Gen:iA Code 이미지가 스킬로 옮긴 것(같은 내용, Apache-2.0)을 그대로 쓴다(WP-1336).
COPY --chown=1001:1001 apps/workplace-agent-genia-code/skills/ /home/agent/.agents/skills/

# Codex CLI — 고정 버전(11-06 npm latest). 버전을 올리면 구동기(plugins/genia-works/codex)의 exec·resume·-c 인자와 config.toml 키
# (bin/lib-codex.sh write_codex_config)가 그대로 먹는지 확인한다. 플러그인 받기 뒤에 두어 버전만 올릴 때 그 단계를 다시 하지 않는다.
# 전역 설치라 root 로 하고, npm 캐시가 agent 홈에 root 소유로 남지 않게 HOME 을 /root 로 둔다. 버전은 엔트리포인트가 codex --version 으로 남긴다.
USER root
ARG CODEX_VERSION=0.167.0
RUN set -eux; \
    export HOME=/root; \
    npm install -g --no-fund --no-audit "@openai/codex@${CODEX_VERSION}"; \
    npm cache clean --force; \
    codex --version
USER 1001

# genia-works 플러그인을 빌드 때 굳힌다 — Codex 칸은 agent-project 의 codex 분기가 띄우는 구동기(scripts/gw-codex-loop → codex/driver.mjs)로 돈다.
# 구동기가 쓰는 것만 고른다: codex/(구동기·키 보호 hook), genia/loop.js(반복 상태 기계 — 구동기가 import)와 그것이 import 하는 hooks/lib.js,
# plugin.json(버전 → User-Agent), scripts/(칸·키·알림 감시·gw-models), skills/(work-loop 스킬 파일을 구동기가 직접 가리킨다). tests 는 넣지 않는다.
# 파일 권한은 저장소 그대로(스크립트의 실행 비트), 엔트리포인트 쪽은 COPY --chmod 로 정한다(따로 chmod 레이어를 만들지 않는다).
COPY plugins/genia-works/package.json /opt/genia/plugin/genia-works/package.json
COPY plugins/genia-works/.claude-plugin/ /opt/genia/plugin/genia-works/.claude-plugin/
COPY plugins/genia-works/codex/ /opt/genia/plugin/genia-works/codex/
COPY plugins/genia-works/genia/ /opt/genia/plugin/genia-works/genia/
COPY plugins/genia-works/hooks/ /opt/genia/plugin/genia-works/hooks/
COPY plugins/genia-works/scripts/ /opt/genia/plugin/genia-works/scripts/
COPY plugins/genia-works/skills/ /opt/genia/plugin/genia-works/skills/
# 작업 화면(agent-screen, WP-1277 — runner 가 exec 한다)은 Claude Code 이미지의 것을 그대로 쓴다.
COPY --chmod=755 apps/workplace-agent-claude-code/bin/agent-screen apps/workplace-agent-codex/bin/ /opt/genia/bin/

# 디스크 배치(계약) — 다시 받기 비싼 것은 /work 로. 빌드 RUN 이 끝난 뒤에 둔다(/work/tmp 가 없으면 빌드 중 dpkg·npm 이 실패한다).
# 브라우저 폴더를 /work 로 옮기므로 베이스의 /ms-playwright 는 엔트리포인트가 링크해 둔다(같은 버전이면 받지 않는다).
ENV TMPDIR=/work/tmp \
    XDG_CACHE_HOME=/work/.cache \
    PLAYWRIGHT_BROWSERS_PATH=/work/.cache/ms-playwright \
    GRADLE_USER_HOME=/work/.gradle \
    npm_config_store_dir=/work/.pnpm-store \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /work
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/genia/bin/entrypoint"]

# 릴리스 버전·커밋(WP-436) — 레이어 캐시가 깨지지 않도록 스테이지 맨 끝에 둔다. ENV 로 두지 않는 이유는 Claude Code 이미지와 같다(WP-1279).
ARG APP_VERSION=dev
ARG GIT_SHA=dev
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.source=https://gitlab.iacloud.kr/iacloud/smart-workplace
