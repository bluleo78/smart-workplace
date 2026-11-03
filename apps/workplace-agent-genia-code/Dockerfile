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

# pnpm(corepack — 저장소의 packageManager 버전을 쓴다). Claude Code·jdtls·TS 언어 서버·Claude 플러그인은 이 이미지에 넣지 않는다.
RUN corepack enable

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
# 공용 함수(lib.sh)·작업 화면(agent-screen, WP-1277 — runner 가 exec 한다)은 Claude Code 이미지의 것을 그대로 쓴다.
COPY --chmod=755 apps/workplace-agent-claude-code/bin/lib.sh apps/workplace-agent-claude-code/bin/agent-screen /opt/genia/bin/
COPY --chmod=755 apps/workplace-agent-genia-code/bin/ /opt/genia/bin/

USER 1001
# glab 의 사용 통계·업데이트 확인은 끈다 — 둘 다 gitlab.com 으로 나가고, 통계는 토큰 헤더까지 붙여 보낸다(1.123.0 에서 확인).
# genia 감싸개(~/.local/bin/genia)는 엔트리포인트가 매번 만든다 — PATH 앞에 둔다. 새 버전 확인은 끈다(버전은 Pod 가 뜰 때 배포 서버로 맞춘다).
ENV HOME=/home/agent \
    PATH=/home/agent/.local/bin:$PATH \
    GENIA_SKIP_VERSION_CHECK=1 \
    GLAB_SEND_TELEMETRY=false \
    GLAB_CHECK_UPDATE=false

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
