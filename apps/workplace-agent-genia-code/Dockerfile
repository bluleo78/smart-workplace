# Gen:iA Code 작업 공간 이미지(WP-1296) — Works 가 띄우는 AI Pod 의 agent 컨테이너. 엔트리포인트가 genia·플러그인·저장소·work-loop 칸을 띄운다.
# Pod 와의 계약(마운트·env·UID 1001·디스크 배치)은 docs/integrations/agent-pod-contract.md.
#
# genia 프로그램은 이미지에 넣지 않는다 — 사내 프로그램이고 이 이미지는 Docker Hub 공개다. Pod 가 뜰 때 사내 배포 서버에서 받아 sha256 을 확인하고
# /work/.genia-app 에 둔다(bin/lib-genia.sh 의 install_genia). 이미지에는 그 서버에 닿을 루트 CA(genia-root.crt, 공개 인증서 — 시스템 CA 에 넣는다)만 넣는다.
# 베이스가 DHI 규칙의 예외인 이유는 Claude Code 이미지와 같다(개발용 작업 공간 — 셸·패키지 관리자·브라우저 의존 라이브러리가 필요하다).
# 컨텍스트는 저장소 루트(image-catalog.json) — Claude Code 이미지의 공용 함수(lib.sh)·작업 화면(agent-screen)과 genia-works 플러그인을 함께 COPY 한다.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

# GitLab CLI(WP-1276) — 플러그인 gw-repo 가 GitLab MR 을 다룰 때 쓴다. apt 에 없어 공식 릴리스 .deb 를 아키텍처별 해시로 확인해 받는다.
ARG GLAB_VERSION=1.123.0
ARG GLAB_SHA256_AMD64=0effb3e550b80fd826b5a50655acc7fe7142728d0afe9a1d5d857aa2fc651f5a
ARG GLAB_SHA256_ARM64=f7c1930977fdd75bea6735eed0b628d4411536b3208c124101db42d6cfb9378e

# Claude Code — 실행하지 않고 빌드 때 플러그인을 받는 데만 쓴다(아래). Claude 이미지와 같은 버전으로 둔다.
ARG CLAUDE_CODE_VERSION=2.1.316
# playwright-cli(WP-1404) — 화면 탐색 스킬이 쓰는 브라우저 명령. 두 작업 공간 이미지가 같은 버전을 쓴다.
ARG PLAYWRIGHT_CLI_VERSION=0.1.15

ENV DEBIAN_FRONTEND=noninteractive

# ---- Claude 이미지 Dockerfile 과 같은 도구 블록 — 바꾸면 함께(apps/workplace-agent-claude-code/Dockerfile) ----
# 도구 — gh·docker(CLI·compose v2)는 공식 apt 저장소. openjdk postinst 가 man 링크를 만들다 실패하지 않게 man 폴더를 먼저 만든다(PoC).
# tini 는 PID 1 로 SIGTERM 을 엔트리포인트에 넘기고 고아 프로세스(tmux 서버 등)를 거둔다.
# fonts-noto-cjk — 한글 폭이 달라져 배치를 재는 E2E 가 작업 공간에서만 깨지지 않게(WP-1285). fonts-wqy-zenhei 는 우선순위가 높아 지운다.
# 포트·프로세스 확인 도구(WP-1404) — Mac 에는 기본으로 있어 저장소·탐색 스크립트가 당연히 쓰는데 베이스에는 없다(일반 사용자라 Pod 에서 깔 수 없다).
# lsof·ss(iproute2)는 live-stack·explore-stack 의 듣는 포트 찾기와 빈 포트 판정, ip(iproute2)는 e2e-netns. 나머지는 Mac 기본 명령을 맞춘 것:
# nc(BSD 판 — Mac 과 같은 옵션)·netstat(net-tools)·fuser·killall(psmisc)·file·xxd·column(bsdextrautils)·bc·zip·dig·ping·rsync·uuidgen.
# 끝 줄은 빌드 때 존재 확인 — 빠지면 이미지가 빌드되지 않는다.
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
      fonts-noto-cjk \
      lsof iproute2 netcat-openbsd net-tools psmisc file xxd bsdextrautils bc zip dnsutils iputils-ping rsync uuid-runtime; \
    apt-get purge -y fonts-wqy-zenhei; \
    rm -rf /var/lib/apt/lists/*; \
    lsof -v 2>&1 | grep -q revision; ss -V; ip -V; nc -h 2>&1 | grep -q OpenBSD

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

# playwright-cli(WP-1404) — 화면 탐색 스킬(ai-driven-explorer)이 브라우저를 이것으로만 다룬다. 고정 버전으로 넣고,
# 이 cli 가 품은 Playwright 의 chromium 을 베이스 브라우저 폴더(/ms-playwright)에 받아 둔다 — 엔트리포인트가 PVC 브라우저 폴더에 링크한다(seed_browsers).
# cli 의 install-browser 는 0.1.15 에서 --no-shell 을 「--shell」 옵션으로 잘못 읽어, 품은 playwright-core 의 install 을 직접 부른다.
# 기본 설정(아래 ~/.playwright)이 channel chromium(정식 chromium 의 headless)이라 headless shell 은 받지 않는다.
# 브라우저 지우기(GC)는 끈다 — 베이스가 받은 chromium 은 설치 기록(.links)이 없어 GC 가 「안 쓰는 것」으로 보고 지운다.
# 품은 playwright-core 폴더는 /opt/genia/playwright-cli-core 로 가리켜 둔다 — 엔트리포인트가 PVC 브라우저 폴더의 설치 기록(.links)에 올려, 저장소 Playwright 를 받을 때 GC 가 이 chromium 을 지우지 않게 한다.
RUN set -eux; \
    npm install -g --no-fund --no-audit "@playwright/cli@${PLAYWRIGHT_CLI_VERSION}"; \
    npm cache clean --force; \
    core=$(node -e 'console.log(require("path").dirname(require.resolve("playwright-core", { paths: [process.argv[1]] })))' "$(npm root -g)/@playwright/cli"); \
    PLAYWRIGHT_SKIP_BROWSER_GC=1 node "$core/cli.js" install --no-shell chromium; \
    mkdir -p /opt/genia; \
    ln -sfn "$core" /opt/genia/playwright-cli-core; \
    playwright-cli --version

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

# 사내 Gen:iA 배포 서버·모델 서버의 루트 CA(공개 인증서) — 시스템 CA 에 넣어 curl·git 이 따로 CA 를 받지 않고도 믿게 한다(root 일 때만 할 수 있다).
# node(genia)는 시스템 CA 파일을 읽지 않으므로 엔트리포인트가 같은 파일을 NODE_EXTRA_CA_CERTS 묶음에 넣는다(genia_ca).
COPY --chmod=644 apps/workplace-agent-genia-code/genia-root.crt /usr/local/share/ca-certificates/genia-root.crt
RUN update-ca-certificates

# Claude 이미지와 같은 플러그인 목록(WP-1336)을 Claude Code 로 홈(~/.claude/plugins — genia 가 여기서 읽는다)에 굳힌다. 버전이 lock 과 다르면 빌드 실패다.
# genia-works 는 아래 genia 확장으로 따로 싣으므로 받지 않는다(두 번 실리지 않게). 네트워크로 오래 걸려 자주 바뀌는 COPY 보다 앞에 둔다(캐시).
# 이 단계에 필요한 공용 함수(lib.sh — Claude Code 이미지의 것)만 먼저 COPY 한다. 작업 화면(agent-screen)은 뒤의 bin/ 과 함께(캐시).
COPY --chmod=755 apps/workplace-agent-claude-code/bin/lib.sh /opt/genia/bin/lib.sh
COPY apps/workplace-agent-claude-code/plugins.lock /opt/genia/plugins.lock

USER 1001
# glab 의 사용 통계·업데이트 확인은 끈다 — 둘 다 gitlab.com 으로 나가고, 통계는 토큰 헤더까지 붙여 보낸다(1.123.0 에서 확인).
# genia 감싸개(~/.local/bin/genia)는 엔트리포인트가 매번 만든다 — PATH 앞에 둔다. 새 버전 확인은 끈다(버전은 Pod 가 뜰 때 배포 서버로 맞춘다).
ENV HOME=/home/agent \
    PATH=/home/agent/.local/bin:$PATH \
    GENIA_SKIP_VERSION_CHECK=1 \
    DISABLE_AUTOUPDATER=1 \
    GLAB_SEND_TELEMETRY=false \
    GLAB_CHECK_UPDATE=false
WORKDIR /home/agent
# superpowers 의 genia 확장(세션 시작·압축 뒤 using-superpowers 안내)은 버전이 든 설치 폴더를 고정 이름(~/.genia-superpowers)으로 가리켜
# 엔트리포인트가 genia 설정 extensions 에 싣는다(write_genia_settings) — genia 는 Claude 플러그인의 hook 을 돌리지 않는다.
RUN set -eu; \
    bash -c '. /opt/genia/bin/lib.sh && install_plugins /opt/genia/plugins.lock "" genia-works@genia-works'; \
    sp=$(claude plugin list --json | jq -r '[.[] | select(.id | startswith("superpowers@"))][0].installPath // empty'); \
    test -f "$sp/.pi/extensions/superpowers.ts"; \
    ln -sfn "$sp" /home/agent/.genia-superpowers
# playwright-cli 기본 설정(WP-1404) — Pod 에는 화면도 Google Chrome 도 없는데 cli 는 설정이 없으면 channel chrome 을 찾는다.
# 위에서 받은 chromium 을 headless 로 쓰게 전역 설정(~/.playwright/cli.config.json)을 둔다 — 가장 약한 설정이라 저장소의 .playwright/·--config 가 덮는다.
# 스킬이 --headed 로 띄우면 엔트리포인트가 띄운 가상 화면(Xvfb, start_display)에 그린다.
# 빌드 때 about:blank 를 실제로 열어 본다 — 브라우저·설정이 어긋나면 이미지가 빌드되지 않는다. 열어 본 흔적(세션·데몬 파일)은 지운다.
RUN set -eux; \
    mkdir -p /home/agent/.playwright; \
    printf '%s\n' '{"browser":{"browserName":"chromium","launchOptions":{"channel":"chromium","headless":true}}}' > /home/agent/.playwright/cli.config.json; \
    t=$(mktemp -d); \
    cd "$t"; \
    playwright-cli open about:blank; \
    playwright-cli close; \
    cd /; \
    rm -rf "$t" /home/agent/.cache/ms-playwright

# Claude 플러그인 중 에이전트 형식(code-simplifier)은 genia 가 읽지 못한다 — 같은 내용을 스킬로 옮겨 genia 가 읽는 ~/.agents/skills 에 둔다(WP-1336).
COPY --chown=1001:1001 apps/workplace-agent-genia-code/skills/ /home/agent/.agents/skills/

# genia-works 플러그인을 빌드 때 굳힌다 — 운영 마켓플레이스가 가리키는 옛 ref 에는 genia/(Gen:iA Code 확장)가 없다.
# Pod 는 뜰 때 마켓플레이스의 ref 에 genia/ 가 있으면 그것을 받아 쓰고, 없으면 이것을 쓴다(use_plugin).
# genia 가 쓰는 것만 고른다(-e 로 싣는 package.json·genia 확장·그것이 읽는 hooks·스크립트·스킬·버전 파일) — tests·codex·Claude 전용 명령은 넣지 않는다.
# 파일 권한은 저장소 그대로(스크립트의 실행 비트), 엔트리포인트 쪽은 COPY --chmod 로 정한다(따로 chmod 레이어를 만들지 않는다).
COPY plugins/genia-works/package.json /opt/genia/plugin/genia-works/package.json
COPY plugins/genia-works/.claude-plugin/ /opt/genia/plugin/genia-works/.claude-plugin/
COPY plugins/genia-works/genia/ /opt/genia/plugin/genia-works/genia/
COPY plugins/genia-works/hooks/ /opt/genia/plugin/genia-works/hooks/
COPY plugins/genia-works/scripts/ /opt/genia/plugin/genia-works/scripts/
COPY plugins/genia-works/skills/ /opt/genia/plugin/genia-works/skills/
# 작업 화면(agent-screen, WP-1277 — runner 가 exec 한다)은 Claude Code 이미지의 것을 그대로 쓴다.
COPY --chmod=755 apps/workplace-agent-claude-code/bin/agent-screen apps/workplace-agent-genia-code/bin/ /opt/genia/bin/

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
