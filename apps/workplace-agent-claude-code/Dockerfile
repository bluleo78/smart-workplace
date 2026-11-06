# Claude Code 작업 공간 이미지(WP-1252) — Works 가 띄우는 AI Pod 의 agent 컨테이너. 엔트리포인트가 플러그인·저장소·work-loop 칸을 띄운다.
# Pod 와의 계약(마운트·env·UID 1001·디스크 배치)은 docs/integrations/agent-pod-contract.md.
#
# 베이스는 DHI 규칙의 예외다(11-01 사용자 결정): 이 이미지는 운영 서비스가 아니라 AI 가 저장소를 받아 빌드·테스트(E2E 브라우저·JDK·docker)를
# 하는 개발용 작업 공간이라 셸·패키지 관리자·브라우저 의존 라이브러리가 모두 필요하다. Playwright 공식 noble 이미지가 브라우저 의존성과
# node 24 를 이미 갖춰, DHI dev 변형에 같은 것을 손으로 쌓는 것보다 작고 맞는다. 컨텍스트는 이 폴더(image-catalog.json) — COPY 는 이 폴더 안만 쓴다.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

ARG CLAUDE_CODE_VERSION=2.1.316
ARG JDTLS_VERSION=1.62.0
ARG JDTLS_BUILD=202610131109
ARG JDTLS_SHA256=f587dafd8410633c2c2bf005e853a2bbb03cddee88933d49bfe6d9cb1cf09342
ARG TYPESCRIPT_LANGUAGE_SERVER_VERSION=6.0.2
ARG TYPESCRIPT_VERSION=5.9.3
# playwright-cli(WP-1404) — 화면 탐색 스킬이 쓰는 브라우저 명령. 두 작업 공간 이미지가 같은 버전을 쓴다.
ARG PLAYWRIGHT_CLI_VERSION=0.1.15
# GitLab CLI(WP-1276) — 플러그인 gw-repo 가 GitLab MR 을 다룰 때 쓴다. apt 에 없어 공식 릴리스 .deb 를 아키텍처별 해시로 확인해 받는다.
ARG GLAB_VERSION=1.123.0
ARG GLAB_SHA256_AMD64=0effb3e550b80fd826b5a50655acc7fe7142728d0afe9a1d5d857aa2fc651f5a
ARG GLAB_SHA256_ARM64=f7c1930977fdd75bea6735eed0b628d4411536b3208c124101db42d6cfb9378e
# 빌드 때 genia-works 마켓플레이스를 받을 곳 — Pod 는 뜰 때 자기 Works 주소로 갱신한다.
ARG GENIA_WORKS_ORIGIN=https://genia-works.iacloud.kr

ENV DEBIAN_FRONTEND=noninteractive

# 도구 — gh·docker(CLI·compose v2)는 공식 apt 저장소. openjdk postinst 가 man 링크를 만들다 실패하지 않게 man 폴더를 먼저 만든다(PoC).
# tini 는 PID 1 로 SIGTERM 을 엔트리포인트에 넘기고 고아 프로세스(tmux 서버 등)를 거둔다.
# fonts-noto-cjk — 베이스의 한글 글꼴은 WenQuanYi·Unifont 뿐이라 한글 폭이 달라져 배치를 재는 E2E 가 작업 공간에서만 깨진다(WP-1285).
# 베이스의 fonts-wqy-zenhei 는 fontconfig 우선순위가 Noto 보다 높아 남겨 두면 계속 한글을 가져가므로 지운다(중국어도 Noto CJK 가 덮는다).
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

# jdtls(jdtls-lsp 플러그인이 PATH 에서 찾는다) — apt 에 없어 Eclipse 공식 milestone 을 해시로 확인해 받는다.
RUN set -eux; \
    mkdir -p /opt/jdtls; \
    curl -fsSL -o /tmp/jdtls.tar.gz "https://download.eclipse.org/jdtls/milestones/${JDTLS_VERSION}/jdt-language-server-${JDTLS_VERSION}-${JDTLS_BUILD}.tar.gz"; \
    echo "${JDTLS_SHA256}  /tmp/jdtls.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/jdtls.tar.gz -C /opt/jdtls; \
    rm /tmp/jdtls.tar.gz; \
    ln -s /opt/jdtls/bin/jdtls /usr/local/bin/jdtls

# glab — 공식 릴리스 패키지(gitlab.com/gitlab-org/cli). 아키텍처마다 checksums.txt 의 해시로 확인한다.
RUN set -eux; \
    arch=$(dpkg --print-architecture); \
    case "$arch" in amd64) sum="$GLAB_SHA256_AMD64" ;; arm64) sum="$GLAB_SHA256_ARM64" ;; *) echo "glab: 지원하지 않는 아키텍처 $arch" >&2; exit 1 ;; esac; \
    curl -fsSL -o /tmp/glab.deb "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${arch}.deb"; \
    echo "${sum}  /tmp/glab.deb" | sha256sum -c -; \
    dpkg -i /tmp/glab.deb; \
    rm /tmp/glab.deb; \
    glab --version

# Claude Code(고정 버전, 자동 업데이트 끔)·TS 언어 서버·pnpm(corepack — 저장소의 packageManager 버전을 쓴다).
# npm 전역 설치가 가장 단순하고 버전 고정이 확실하다(네이티브 설치는 홈에 깔려 휘발 홈과 맞지 않는다).
RUN set -eux; \
    npm install -g --no-fund --no-audit \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "typescript-language-server@${TYPESCRIPT_LANGUAGE_SERVER_VERSION}" \
      "typescript@${TYPESCRIPT_VERSION}"; \
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
# /work 은 PVC 가 덮지만 PVC 없이 띄워도(확인용 docker run) 쓸 수 있게 1001 소유로 둔다. /run/genia 는 runner 가 파일만 꽂는 곳.
RUN set -eux; \
    if getent passwd 1001 >/dev/null; then \
      old=$(getent passwd 1001 | cut -d: -f1); oldg=$(getent group 1001 | cut -d: -f1); \
      groupmod -n agent "$oldg"; usermod -l agent -d /home/agent -m "$old"; \
    else \
      groupadd -g 1001 agent; useradd -u 1001 -g 1001 -m -d /home/agent -s /bin/bash agent; \
    fi; \
    mkdir -p /work/tmp /work/.cache /work/.gradle /work/.pnpm-store /work/agents /run/genia; \
    chown -R 1001:1001 /work

COPY bin/ /opt/genia/bin/
COPY plugins.lock /opt/genia/plugins.lock
RUN chmod 755 /opt/genia/bin/entrypoint /opt/genia/bin/agent-screen

# 플러그인 8개를 빌드 때 홈에 굳힌다 — 버전이 plugins.lock 과 다르면 빌드를 실패시킨다(마켓플레이스가 버전 지정을 받지 않는다).
USER 1001
# glab 의 사용 통계·업데이트 확인은 끈다 — 둘 다 gitlab.com 으로 나가고, 통계는 토큰 헤더까지 붙여 보낸다(1.123.0 에서 확인).
ENV HOME=/home/agent \
    DISABLE_AUTOUPDATER=1 \
    GLAB_SEND_TELEMETRY=false \
    GLAB_CHECK_UPDATE=false
WORKDIR /home/agent
RUN bash -c '. /opt/genia/bin/lib.sh && install_plugins /opt/genia/plugins.lock "$0"' "$GENIA_WORKS_ORIGIN" && \
    claude --version

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

# 디스크 배치(계약) — 다시 받기 비싼 것은 /work(PVC)로. 빌드 RUN 이 끝난 뒤에 둔다(/work/tmp 가 없으면 빌드 중 dpkg·npm 이 실패한다).
# 브라우저 폴더를 PVC 로 옮기므로 베이스의 /ms-playwright 는 엔트리포인트가 링크해 둔다(같은 버전이면 받지 않는다).
ENV TMPDIR=/work/tmp \
    XDG_CACHE_HOME=/work/.cache \
    PLAYWRIGHT_BROWSERS_PATH=/work/.cache/ms-playwright \
    GRADLE_USER_HOME=/work/.gradle \
    npm_config_store_dir=/work/.pnpm-store \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /work
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/genia/bin/entrypoint"]

# 릴리스 버전·커밋(WP-436) — 빌드 인자가 바뀌어도 위 레이어 캐시가 깨지지 않도록 스테이지 맨 끝에 둔다.
# 환경 변수(ENV)로는 두지 않고 라벨로만 남긴다 — 이 이미지는 AI 가 저장소를 빌드·테스트하는 작업 공간이라,
# APP_VERSION 이 셸에 있으면 웹 빌드·vitest(appVersionDefine)가 그 값을 읽어 「dev」를 가정한 테스트가 깨진다(WP-1279).
ARG APP_VERSION=dev
ARG GIT_SHA=dev
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.source=https://gitlab.iacloud.kr/iacloud/smart-workplace
