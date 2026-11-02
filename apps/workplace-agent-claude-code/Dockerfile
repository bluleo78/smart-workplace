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
# 빌드 때 genia-works 마켓플레이스를 받을 곳 — Pod 는 뜰 때 자기 Works 주소로 갱신한다.
ARG GENIA_WORKS_ORIGIN=https://genia-works.iacloud.kr

ENV DEBIAN_FRONTEND=noninteractive

# 도구 — gh·docker(CLI·compose v2)는 공식 apt 저장소. openjdk postinst 가 man 링크를 만들다 실패하지 않게 man 폴더를 먼저 만든다(PoC).
# tini 는 PID 1 로 SIGTERM 을 엔트리포인트에 넘기고 고아 프로세스(tmux 서버 등)를 거둔다.
# fonts-noto-cjk — 베이스의 한글 글꼴은 WenQuanYi·Unifont 뿐이라 한글 폭이 달라져 배치를 재는 E2E 가 작업 공간에서만 깨진다(WP-1285).
# 베이스의 fonts-wqy-zenhei 는 fontconfig 우선순위가 Noto 보다 높아 남겨 두면 계속 한글을 가져가므로 지운다(중국어도 Noto CJK 가 덮는다).
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

# jdtls(jdtls-lsp 플러그인이 PATH 에서 찾는다) — apt 에 없어 Eclipse 공식 milestone 을 해시로 확인해 받는다.
RUN set -eux; \
    mkdir -p /opt/jdtls; \
    curl -fsSL -o /tmp/jdtls.tar.gz "https://download.eclipse.org/jdtls/milestones/${JDTLS_VERSION}/jdt-language-server-${JDTLS_VERSION}-${JDTLS_BUILD}.tar.gz"; \
    echo "${JDTLS_SHA256}  /tmp/jdtls.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/jdtls.tar.gz -C /opt/jdtls; \
    rm /tmp/jdtls.tar.gz; \
    ln -s /opt/jdtls/bin/jdtls /usr/local/bin/jdtls

# Claude Code(고정 버전, 자동 업데이트 끔)·TS 언어 서버·pnpm(corepack — 저장소의 packageManager 버전을 쓴다).
# npm 전역 설치가 가장 단순하고 버전 고정이 확실하다(네이티브 설치는 홈에 깔려 휘발 홈과 맞지 않는다).
RUN set -eux; \
    npm install -g --no-fund --no-audit \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "typescript-language-server@${TYPESCRIPT_LANGUAGE_SERVER_VERSION}" \
      "typescript@${TYPESCRIPT_VERSION}"; \
    npm cache clean --force; \
    corepack enable

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
RUN chmod 755 /opt/genia/bin/entrypoint

# 플러그인 8개를 빌드 때 홈에 굳힌다 — 버전이 plugins.lock 과 다르면 빌드를 실패시킨다(마켓플레이스가 버전 지정을 받지 않는다).
USER 1001
ENV HOME=/home/agent \
    DISABLE_AUTOUPDATER=1
WORKDIR /home/agent
RUN bash -c '. /opt/genia/bin/lib.sh && install_plugins /opt/genia/plugins.lock "$0"' "$GENIA_WORKS_ORIGIN" && \
    claude --version

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
