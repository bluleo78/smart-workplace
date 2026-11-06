# 작업 공간 엔트리포인트의 함수들(WP-1252) — bin/entrypoint 와 Dockerfile(빌드 때 플러그인 설치)이 source 한다.
# Pod 가 주는 것(마운트·env·디스크 배치)은 docs/integrations/agent-pod-contract.md 가 기준이다. 사람이 start-agent 4~6번으로 하던
# 절차(프로젝트 읽기 → 저장소 받기 → 칸 띄우기)를 같은 플러그인 스크립트로 사람 손 없이 돈다.
# 테스트가 함수 하나씩 부를 수 있게 나눴고, 경로·시간은 아래 env 로 바꿀 수 있다(운영은 기본값). 맥(bash 3.2)에서도 돌게 쓴다.
# 키·토큰 원문은 명령줄 인자·로그에 남기지 않는다 — 파일·표준 입력으로만 넘긴다.
# 플러그인을 찾은 뒤(resolve_plugin_scripts)에는 플러그인의 공용 함수(gw-lib.sh)를 읽어 키 저장·키 검사·경로·파일 쓰기를 플러그인과 같은 규칙으로 한다.
# 그 앞(필수 확인·마켓플레이스)은 이미지에 genia-works 가 없을 수도 있어(빌더에서 Works 에 닿지 않음) gw-lib 없이 돈다.
# Gen:iA Code 이미지(apps/workplace-agent-genia-code, WP-1296)도 이 파일을 그대로 COPY 해 쓰고, 그 이미지 전용 함수(lib-genia.sh)를 뒤에 읽어 덮어쓴다 —
# 함수 이름·인자를 바꾸면 그 이미지의 엔트리포인트·테스트도 함께 본다.
#   다른 이미지가 덮어쓰는 지점: trust_folders(7 의 폴더 신뢰). 함께 쓰는 것: adopt_plugin_scripts·bg_wait 와 필수 확인·CA·키·git·dind·프로젝트·감독·정리.
#   Claude Code 전용(다른 이미지는 부르지 않는다): update_plugins·resolve_plugin_scripts·write_settings·mark_trust·install_plugins·verify_plugin_lock.

GENIA_RUN_DIR=${GENIA_RUN_DIR:-/run/genia}          # runner 가 파일 하나씩(subPath) 꽂는 곳 — 읽기만 한다
GENIA_WORK=${GENIA_WORK:-/work}                     # PVC — 다시 받기 비싼 것만(AI 폴더·저장소·캐시)
TMUX_BIN=${GW_TMUX:-tmux}                           # 플러그인 스크립트와 같은 테스트 훅(격리 tmux 서버)
GENIA_DIND_WAIT=${GENIA_DIND_WAIT:-60}              # docker 소켓을 기다리는 초
GENIA_SUPERVISE_INTERVAL=${GENIA_SUPERVISE_INTERVAL:-60}
GENIA_RESTART_AFTER=${GENIA_RESTART_AFTER:-518400}  # 6일 — /loop 반복이 7일 뒤 끝나기 전에 칸을 다시 띄운다
GENIA_STOP_WAIT=${GENIA_STOP_WAIT:-40}              # SIGTERM 뒤 칸이 끝나기를 기다리는 초(grace 60초 안)
GENIA_BASE_BROWSERS=${GENIA_BASE_BROWSERS:-/ms-playwright}
BROWSERS_DIR=${PLAYWRIGHT_BROWSERS_PATH:-$GENIA_WORK/.cache/ms-playwright} # PVC 의 Playwright 브라우저 폴더
GENIA_PLAYWRIGHT_CLI_CORE=${GENIA_PLAYWRIGHT_CLI_CORE:-/opt/genia/playwright-cli-core} # playwright-cli 가 품은 playwright-core(이미지 빌드가 링크, WP-1404)
GENIA_XVFB=${GENIA_XVFB:-Xvfb}                      # 가상 화면 서버(베이스 이미지에 있다)
GENIA_DISPLAY=${GENIA_DISPLAY:-:99}
# 운영 Works origin — 빌드(install_plugins)와, 플러그인을 찾기 전이라 gw_api_url 을 쓸 수 없는 마켓플레이스 단계의 기본값.
# runner 는 GENIA_WORKS_API_URL 을 늘 넣으므로 Pod 에서는 대개 쓰이지 않는다.
GENIA_DEFAULT_ORIGIN=https://genia-works.iacloud.kr

log() { printf '[entrypoint] %s\n' "$*" >&2; }
die() {
  log "$*"
  exit 1
}

# 1. 필수 파일·env — 없으면 한 줄 사유로 끝낸다(runner 가 만든 Pod 가 아니거나 Secret·ConfigMap 이 덜 됐다).
#    플러그인을 찾기 전이라 gw-lib 없이 검사한다.
check_required() {
  CONFIG="$GENIA_RUN_DIR/config.json"
  [ -n "${GENIA_AGENT_NAME:-}" ] || die "GENIA_AGENT_NAME 이 없습니다 — runner 가 만든 Pod 에서만 띄울 수 있습니다"
  # 이름은 폴더·키 파일·tmux 세션 이름이 된다 — 플러그인(gw_valid_name)과 같은 규칙.
  case "$GENIA_AGENT_NAME" in
    . | .. | me | *[!A-Za-z0-9._@-]*) die "GENIA_AGENT_NAME 형식이 아닙니다: $GENIA_AGENT_NAME" ;;
  esac
  [ -s "$CONFIG" ] || die "$CONFIG 가 없습니다 — runner 의 ConfigMap 마운트를 확인하세요"
  jq -e . "$CONFIG" >/dev/null 2>&1 || die "$CONFIG 를 JSON 으로 읽지 못했습니다"
  [ -s "$GENIA_RUN_DIR/agent-key" ] || die "$GENIA_RUN_DIR/agent-key 가 없습니다 — runner 의 Secret 마운트를 확인하세요"
  AI_HOME="$GENIA_WORK/agents"
  AI_DIR="$AI_HOME/$GENIA_AGENT_NAME"
}

# config.json 한 값(jq 식).
config_get() { jq -r "$1" "$CONFIG"; }

# /work 아래 폴더 — TMPDIR 이 없으면 dpkg·npm·claude plugin 이 실패한다(PoC). 플러그인 명령보다 먼저 만든다.
prepare_dirs() {
  mkdir -p "$GENIA_WORK/tmp" "$GENIA_WORK/.cache" "$GENIA_WORK/.gradle" "$GENIA_WORK/.pnpm-store" "$AI_DIR/state" ||
    die "$GENIA_WORK 에 폴더를 만들지 못했습니다 — PVC 와 fsGroup 1001 을 확인하세요"
  seed_browsers
}

# 베이스 이미지의 Playwright 브라우저(/ms-playwright)를 PVC 의 브라우저 폴더에 링크한다 — 저장소가 같은 버전이면 받지 않아도 된다.
# 받아 둔 진짜 폴더는 두고, 링크·빈 자리만 이번 이미지를 가리키게 한다(이미지가 바뀌어 끊긴 링크도 치운다).
seed_browsers() {
  mkdir -p "$BROWSERS_DIR" || return 0
  for l in "$BROWSERS_DIR"/*; do
    [ -L "$l" ] && [ ! -e "$l" ] && rm -f "$l"
  done
  # playwright-cli 의 chromium 을 설치 기록(.links)에 올린다(WP-1404) — 저장소 Playwright 를 받을 때 GC 는 기록된 설치가 쓰는 브라우저만 남기고
  # 나머지를 지우므로, 올리지 않으면 이미지에서 링크한 cli 의 chromium 이 첫 저장소 준비에서 지워진다.
  if [ -f "$GENIA_PLAYWRIGHT_CLI_CORE/browsers.json" ]; then
    mkdir -p "$BROWSERS_DIR/.links" && printf '%s' "$GENIA_PLAYWRIGHT_CLI_CORE" > "$BROWSERS_DIR/.links/genia-playwright-cli"
  fi
  [ -d "$GENIA_BASE_BROWSERS" ] || return 0
  for b in "$GENIA_BASE_BROWSERS"/*; do
    [ -e "$b" ] || continue
    target="$BROWSERS_DIR/${b##*/}"
    if [ -e "$target" ] && [ ! -L "$target" ]; then continue; fi
    ln -sfn "$b" "$target"
  done
}

# 가상 화면(WP-1404) — Pod 에는 화면이 없는데 화면 탐색 스킬은 playwright-cli --headed 로 브라우저를 띄운다(--headed 는 설정 파일의 headless 를 이긴다).
# Xvfb 로 $GENIA_DISPLAY 를 띄우고 DISPLAY 를 내보내 뒤에 띄우는 칸(tmux)이 물려받게 한다. 이미 화면이 있거나 Xvfb 가 없으면 건너뛴다.
start_display() {
  [ -n "${DISPLAY:-}" ] && return 0
  command -v "$GENIA_XVFB" >/dev/null 2>&1 || return 0
  "$GENIA_XVFB" "$GENIA_DISPLAY" -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 </dev/null &
  export DISPLAY="$GENIA_DISPLAY"
  log "가상 화면 $DISPLAY 를 띄웠습니다(Xvfb)"
}

# Works 의 origin(scheme://host[:port]) — GENIA_WORKS_API_URL(…/api/v1) 에서 뗀다. 마켓플레이스 주소를 만든다.
# 플러그인을 찾기 전(2번)에 쓰므로 gw_api_url 대신 기본값 상수(GENIA_DEFAULT_ORIGIN)를 쓴다.
api_origin() {
  case "${GENIA_WORKS_API_URL:-}" in
    http://* | https://*)
      rest=${GENIA_WORKS_API_URL#*://}
      printf '%s://%s' "${GENIA_WORKS_API_URL%%://*}" "${rest%%/*}"
      ;;
    *) printf '%s' "$GENIA_DEFAULT_ORIGIN" ;;
  esac
}

# 2. 플러그인 — genia-works 마켓플레이스를 이 Works 의 주소(origin + /claude/marketplace.json)로 맞추고, config.plugins 중 이미지에 없는 것
#    (템플릿에 새로 넣은 것)을 받는다. 그 주소에 닿으면 굳힌 주소와 같든 다르든 지우고 다시 더한 뒤 genia-works 를 받는다(멱등 — 늘 서버의
#    버전으로 맞춘다). 닿지 않으면 이미지에 굳힌 것을 그대로 쓴다. 그 결과 주소를 MARKETPLACE_URL 에 둔다(3번 settings 가 같은 주소를 쓴다).
#    실패는 경고만 — 굳힌 버전으로 계속한다. 지운 뒤 더하기가 실패해 플러그인을 못 찾으면 엔트리포인트가 끝나고,
#    컨테이너가 다시 뜨면 이미지의 홈(굳힌 플러그인)으로 돌아가 다시 해 본다.
update_plugins() {
  want="$(api_origin)/claude/marketplace.json"
  MARKETPLACE_URL=$want
  if curl -fsS --connect-timeout 5 --max-time 15 -o /dev/null "$want" 2>/dev/null; then
    claude plugin marketplace remove genia-works >&2 </dev/null
    if ! { claude plugin marketplace add "$want" >&2 && claude plugin install genia-works@genia-works >&2; } </dev/null; then
      log "경고: 마켓플레이스($want)에서 genia-works 를 받지 못했습니다"
    fi
  else
    have=$(jq -r '.["genia-works"].source.url // empty' "$HOME/.claude/plugins/known_marketplaces.json" 2>/dev/null)
    [ -n "$have" ] && MARKETPLACE_URL=$have
    log "경고: 마켓플레이스($want)에 닿지 못해 이미지에 굳힌 것(${have:-없음})으로 계속합니다"
  fi
  installed=$(claude plugin list --json 2>/dev/null | jq -r '.[].id' 2>/dev/null)
  for id in $(config_get '(.plugins // [])[] | "\(.name)@\(.marketplace)"'); do
    printf '%s\n' "$installed" | grep -qxF "$id" && continue
    claude plugin install "$id" >&2 </dev/null || log "경고: 플러그인 $id 를 받지 못했습니다"
  done
  return 0
}

# 2b. genia-works 플러그인 스크립트 폴더(GW_SCRIPTS)를 찾고 공용 함수(gw-lib.sh)를 읽는다 — 갱신 뒤 설치 경로가 바뀌므로 하드코딩하지 않고
#     claude 에게 묻는다. AI 폴더는 실제 경로로 바꿔 둔다(claude 신뢰·tmux 칸 폴더와 같은 모양). 아직 없으면(함수 하나만 부르는 테스트) 그대로 둔다.
resolve_plugin_scripts() {
  p=$(claude plugin list --json 2>/dev/null | jq -r '[.[] | select(.id == "genia-works@genia-works")][0].installPath // empty' 2>/dev/null)
  [ -n "$p" ] || return 1
  adopt_plugin_scripts "$p/scripts"
}

# 플러그인 스크립트 폴더 하나를 쓰기로 한다(Claude 의 resolve_plugin_scripts·다른 이미지의 플러그인 고르기 공용) — 칸을 띄우는 agent-project 와
# 공용 함수 gw-lib.sh 가 있어야 한다. GW_SCRIPTS 를 정하고 gw-lib 를 읽은 뒤, AI 폴더를 실제 경로로 바꾼다(tmux 칸 폴더와 같은 모양).
adopt_plugin_scripts() {
  [ -x "$1/agent-project" ] && [ -f "$1/gw-lib.sh" ] || return 1
  GW_SCRIPTS=$1
  # shellcheck source=/dev/null # 플러그인 경로는 실행 때 정해진다.
  . "$GW_SCRIPTS/gw-lib.sh"
  if real=$(gw_real_dir "$AI_HOME" 2>/dev/null); then
    AI_HOME=$real
    AI_DIR="$AI_HOME/$GENIA_AGENT_NAME"
  fi
  return 0
}

# 3. ~/.claude/settings.json — 매번 덮어쓴다(재생성된 Pod 에 옛 값이 남지 않게, Review Focus 5). 플러그인 MCP 주소는 플러그인 설정
#    server_url(기본은 운영) 이라 GENIA_WORKS_MCP_URL 로 채운다. claude-plugins-official 은 내장이 아니라 빌드 때 더한 것 — 빼면 LSP 플러그인이 사라진다.
#    genia-works 마켓플레이스 주소는 2번이 정한 MARKETPLACE_URL — 설정의 주소가 등록된 주소와 다르면 그 마켓플레이스가 목록에서 사라진다(실측).
#    플러그인 명령(install 등)도 이 파일을 고치므로 2번 뒤에 쓴다.
write_settings() {
  mkdir -p "$HOME/.claude" || return 1
  out=$(jq -n --slurpfile c "$CONFIG" --arg mk "$MARKETPLACE_URL" --arg mcp "${GENIA_WORKS_MCP_URL:-}" '
      $c[0] as $c
      | (if (($c.config.model // "") | tostring) != "" then { model: $c.config.model } else {} end)
      + { enabledPlugins: ((($c.plugins // []) | map({ key: "\(.name)@\(.marketplace)", value: true }) | from_entries)
                           + { "genia-works@genia-works": true }) }
      + { extraKnownMarketplaces: {
            "genia-works": { source: { source: "url", url: $mk } },
            "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } },
            "superpowers-marketplace": { source: { source: "github", repo: "obra/superpowers-marketplace" } } } }
      + { skipDangerousModePermissionPrompt: true }
      + (if $mcp != "" then { pluginConfigs: { "genia-works@genia-works": { options: { server_url: $mcp } } } } else {} end)
    ') && gw_write_atomic "$HOME/.claude/settings.json" "$out"
}

# 4. ~/.claude.json — 첫 실행 창(온보딩·bypass 확인·폴더 신뢰)이 사람 없는 칸을 막지 않게. 키 이름은 DH-VM 의 것 그대로.
#    claude 가 적은 다른 값은 둔다. 폴더 신뢰는 상위 폴더 신뢰가 하위에도 미친다(실측) — AI 폴더를 신뢰해 두면 work-loop 가 나중에 받는 저장소도 덮는다.
mark_trust() {
  f="$HOME/.claude.json"
  [ -s "$f" ] || printf '{}\n' > "$f"
  out=$(jq '.hasCompletedOnboarding = true | .bypassPermissionsModeAccepted = true
         | reduce $ARGS.positional[] as $p (.; .projects[$p].hasTrustDialogAccepted = true)' "$f" --args "$@") &&
    gw_write_atomic "$f" "$out"
}

# 7 의 폴더 신뢰 훅 — start_projects 가 칸을 띄우기 전에 AI 폴더·저장소 폴더를 넘겨 부른다. Claude Code 는 ~/.claude.json 에 적는다(mark_trust).
# 다른 실행기 이미지(Gen:iA Code — apps/workplace-agent-genia-code 의 lib-genia.sh)는 이 함수를 덮어써 자기 방식으로 한다(또는 아무것도 하지 않는다).
trust_folders() { mark_trust "$@"; }

# 5a. AI 키 — 플러그인의 키 저장(gw-keys add: 키 형식 검사·600·원자적 쓰기)으로 플러그인이 읽는 자리(GW_KEYS/<이름>)에 놓는다.
#     키는 표준 입력으로만 넘긴다. 홈은 휘발이라 매번 새로 놓는다(옛 키가 남지 않게).
install_key() {
  "$GW_SCRIPTS/gw-keys" add "$GENIA_AGENT_NAME" < "$GENIA_RUN_DIR/agent-key"
}

# 1b. 추가 CA(WP-1276) — runner 가 위치 값의 CA 를 $GENIA_RUN_DIR/ca/ca.crt 로 꽂으면 시스템 CA 와 합친 번들을 홈에 만들고
#     git·glab(Go)·curl·python 이 그 번들을, node 는 추가분만(NODE_EXTRA_CA_CERTS 는 더하는 방식) 쓰게 env 를 내보낸다.
#     SSL_CERT_FILE 등은 시스템 CA 를 「대신」하므로 추가분만 가리키면 github.com 이 깨진다 — 그래서 합친다.
#     uid 1001 이라 update-ca-certificates 를 쓸 수 없다. 이 뒤에 띄우는 칸(tmux)이 env 를 물려받는다. 실패는 경고만.
setup_ca() {
  extra="$GENIA_RUN_DIR/ca/ca.crt"
  [ -s "$extra" ] || return 0
  bundle="$HOME/.genia-ca-bundle.pem"
  if ! cat "${GENIA_SYSTEM_CA:-/etc/ssl/certs/ca-certificates.crt}" "$extra" > "$bundle.tmp" 2>/dev/null || ! mv "$bundle.tmp" "$bundle"; then
    rm -f "$bundle.tmp"
    log "경고: 추가 CA 를 시스템 CA 와 합치지 못했습니다 — 자체서명 인증서 저장소에 닿지 못할 수 있습니다"
    return 0
  fi
  export SSL_CERT_FILE="$bundle" GIT_SSL_CAINFO="$bundle" CURL_CA_BUNDLE="$bundle" REQUESTS_CA_BUNDLE="$bundle" NODE_EXTRA_CA_CERTS="$extra"
  log "추가 CA 를 시스템 CA 와 합쳤습니다($extra)"
}

# 5b. git 신원과 저장소 자격 증명(WP-1268·WP-1276) — runner 가 AI 별·호스트별 토큰을 $GENIA_RUN_DIR/repo-tokens/<github|gitlab>/<host> 파일로 꽂는다.
#     GitHub 는 호스트마다 gh 에 로그인(토큰은 표준 입력으로만 — 인자·로그에 남기지 않는다)하고 git 자격 증명 도우미를 건다.
#     GitLab 은 호스트마다 git 자격 증명 도우미가 그때그때 토큰 파일을 읽게 한다(설정·로그에 토큰을 두지 않는다). MR 은 플러그인의
#     gw-repo 가 같은 파일을 glab 에 넘긴다. 실패는 모두 경고만(저장소 받기가 clone-failed 로 알린다).
setup_git() {
  git config --global user.name "$GENIA_AGENT_NAME"
  git config --global user.email "$GENIA_AGENT_NAME@agents.genia-works.local"
  tokens="$GENIA_RUN_DIR/repo-tokens"
  found=0
  for token in "$tokens"/github/*; do
    [ -s "$token" ] || continue
    found=1
    host=$(basename "$token")
    if ! err=$(gh auth login --hostname "$host" --with-token < "$token" 2>&1 >/dev/null); then
      log "경고: GitHub 로그인 실패($host) — 토큰 권한(Contents·Pull requests)을 확인하세요: $(printf '%s' "$err" | head -n 1)"
      continue
    fi
    gh auth setup-git --hostname "$host" >/dev/null 2>&1 || log "경고: gh auth setup-git 실패($host) — git 이 GitHub 자격 증명을 쓰지 못할 수 있습니다"
  done
  for token in "$tokens"/gitlab/*; do
    [ -s "$token" ] || continue
    found=1
    host=$(basename "$token")
    # 빈 값으로 먼저 지워 다른 도우미(예: 시스템 기본)가 앞서 답하지 않게 한다. 사용자 이름은 GitLab 토큰 규칙대로 oauth2.
    git config --global "credential.https://$host.helper" "" &&
      git config --global --add "credential.https://$host.helper" \
        "!f() { test \"\$1\" = get && printf 'username=oauth2\\npassword=%s\\n' \"\$(cat '$token')\"; }; f" ||
      log "경고: GitLab 자격 증명 도우미를 걸지 못했습니다($host)"
  done
  if [ "$found" = 0 ]; then
    log "경고: 저장소 토큰($tokens)이 없습니다 — 저장소를 받지 못할 수 있습니다"
  fi
  return 0
}

# 6. dind 소켓 — 없으면 경고만(docker 없이도 칸은 띄운다).
wait_dind() {
  case "${DOCKER_HOST:-}" in unix://*) ;; *) return 0 ;; esac
  sock=${DOCKER_HOST#unix://}
  n=$GENIA_DIND_WAIT
  while [ ! -S "$sock" ] && [ "$n" -gt 0 ]; do
    sleep 1
    n=$((n - 1))
  done
  [ -S "$sock" ] || log "경고: docker 소켓($sock)이 없습니다 — docker 없이 띄웁니다"
  return 0
}

# 7a. 맡은 프로젝트 — 「키<탭>저장소<탭>브랜치」 한 줄씩. 고르는 기준(실제 멤버·연결된 저장소·키 형식)은
#     서버(GET /agent-runtime/me/projects — gw-agent-projects --assigned, WP-1275) 한 곳에 있다(start-agent 스킬도 같은 것을 부른다).
list_projects() {
  "$GW_SCRIPTS/gw-agent-projects" --assigned "$GENIA_AGENT_NAME" </dev/null
}

# 7b. 저장소의 Playwright 버전 — pnpm-lock.yaml 의 패키지 줄(정확한 버전)을 먼저, 없으면 package.json 의 고정 버전(^·~ 는 뗀다).
playwright_version() {
  v=""
  if [ -f "$1/pnpm-lock.yaml" ]; then
    v=$(grep -m 1 -oE "^  '?(@playwright/test|playwright)@[0-9]+\.[0-9]+\.[0-9]+" "$1/pnpm-lock.yaml" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+$')
  fi
  if [ -z "$v" ] && [ -f "$1/package.json" ]; then
    v=$(jq -r '((.devDependencies // {}) + (.dependencies // {})) | (.["@playwright/test"] // .playwright // empty)' "$1/package.json" 2>/dev/null |
      sed -E 's/^[~^=v]+//')
    case "$v" in *[!0-9.]* | '') v="" ;; esac
  fi
  [ -n "$v" ] || return 1
  printf '%s\n' "$v"
}

# 7c. 그 버전의 chromium — 저장소 Playwright 와 이미지 브라우저 버전이 달라 E2E 가 실패했다(PoC). 받은 버전은 표시를 남겨 다음엔 건너뛴다.
ensure_playwright() {
  [ -f "$BROWSERS_DIR/.genia-chromium-$1" ] && return 0
  mkdir -p "$BROWSERS_DIR"
  if (cd "$GENIA_WORK/tmp" && npx -y "playwright@$1" install chromium) >&2 </dev/null; then
    : > "$BROWSERS_DIR/.genia-chromium-$1"
  else
    log "경고: Playwright $1 의 chromium 을 받지 못했습니다 — E2E 가 실패할 수 있습니다"
  fi
}

# 칸을 띄운 결과를 기록 — 띄운 시각(6일 넘김 판정)과 로그 한 줄.
note_launch() {
  stamp="$AI_DIR/state/pane-started-$1"
  case "$2" in
    started* | revived* | restarted*)
      date +%s > "$stamp"
      log "$1: $2"
      ;;
    exists*) [ -f "$stamp" ] || date +%s > "$stamp" ;;
    *) log "경고: $1 칸을 띄우지 못했습니다 — ${2:-결과 없음}" ;;
  esac
}

# pid 들과 그 자손 전부를 끈다(WP-1267) — 뒤에서 도는 일(agent-project → git clone·npx)은 손자 프로세스가 실제 일을 하므로 서브셸만 끄면
# 정리 뒤에도 clone 이 영속 폴더에 쓰고 있다. ps 의 pid·ppid 표로 자손을 모은 뒤(끄기 전에 — 끄면 고아가 돼 부모를 잃는다) TERM, 3초 안에
# 안 끝난 것은 KILL. ps 가 없으면 받은 pid 만 끈다.
kill_tree() {
  [ $# -gt 0 ] || return 0
  tree=$(ps -A -o pid= -o ppid= 2>/dev/null | awk -v roots="$*" '
    BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) want[r[i]] = 1 }
    { p[NR] = $1; q[NR] = $2 }
    END { do { c = 0; for (i = 1; i <= NR; i++) if (!(p[i] in want) && (q[i] in want)) { want[p[i]] = 1; c = 1 } } while (c)
          for (k in want) print k }')
  [ -n "$tree" ] || tree="$*"
  # shellcheck disable=SC2086 # pid 들은 숫자 단어다.
  kill -TERM $tree 2>/dev/null
  n=30
  while [ "$n" -gt 0 ]; do
    alive=0
    for p in $tree; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && return 0
    sleep 0.1
    n=$((n - 1))
  done
  # shellcheck disable=SC2086
  kill -KILL $tree 2>/dev/null
  return 0
}

# 종료 신호 때 — 부팅 중이던 뒤의 일들을 자손까지 끄고 임시 폴더를 치운다(on_term 이 부른다).
abort_boot() {
  # shellcheck disable=SC2086
  [ -z "${BG_PIDS:-}" ] || kill_tree $BG_PIDS
  BG_PIDS=""
  [ -z "${BOOT_DIR:-}" ] || rm -rf "$BOOT_DIR"
  BOOT_DIR=""
}

# 뒤에서 명령 하나를 돌리고 기다린다 — 오래 걸리는 받기를 앞에서 돌리면 끝날 때까지 SIGTERM trap 이 미뤄져 grace(60초) 안에 정리하지 못하고
# kubelet 이 SIGKILL 한다. wait 중에는 trap 이 바로 돈다. 자기 pid 만 BG_PIDS 에 더했다가 끝나면 자기 것만 뺀다(abort_boot 가 BG_PIDS 의 일을
# 자손까지 끈다 — 다른 뒤의 일과 섞여도 서로 지우지 않게). 명령 치환($(…)) 안에서 부르면 이 효과가 없다(치환을 기다리는 동안 trap 이 미뤄진다).
bg_wait() {
  "$@" &
  bg_pid=$!
  BG_PIDS="${BG_PIDS:-} $bg_pid"
  wait "$bg_pid"
  bg_rc=$?
  # shellcheck disable=SC2086 # pid 들은 숫자 단어다 — 한 줄에 하나로 나눈다.
  BG_PIDS=$(printf '%s\n' ${BG_PIDS:-} | grep -vx "$bg_pid" | tr '\n' ' ')
  return $bg_rc
}

# 7. 프로젝트 — start-agent 4~6번을 사람 대신. 대기열 라벨·홈 기억 → 저장소마다 받기 → 신뢰 → Playwright → 칸.
#    저장소 받기·브라우저 받기는 프로젝트별로 동시에 돈다(WP-1267).
#    BOOT_KEYS 에 띄운 키를 모은다(감독이 살핀다). 프로젝트 목록을 못 읽으면 1(감독이 다음 회차에 다시 한다).
#    알림 감시 창은 부르는 쪽이 칸을 다 띄운 뒤 한 번 챙긴다(ensure_events).
start_projects() {
  list=$(list_projects) || {
    log "경고: 맡은 프로젝트를 읽지 못했습니다 — 잠시 뒤 다시 합니다"
    return 1
  }
  queue=$(config_get '.config.queue // ""')
  "$GW_SCRIPTS/agent-home" "$AI_DIR" set queue "$queue" || log "경고: 대기열 라벨을 저장하지 못했습니다: $queue"
  "$GW_SCRIPTS/agent-project" locate "$GENIA_AGENT_NAME" "$AI_HOME" --set >/dev/null || log "경고: AI 홈을 기억하지 못했습니다"
  if [ -z "$list" ]; then
    log "$GENIA_AGENT_NAME 이 멤버인 프로젝트 중 연결된 저장소가 있는 것이 없습니다 — 프로젝트 설정 › 연결된 저장소와 멤버를 확인하세요"
    return 0
  fi
  # 칸을 띄우기 전에 저장소 폴더 신뢰를 한 번에 적는다 — 칸의 claude 가 같은 파일을 쓰기 시작한 뒤에 고치면 서로 덮어쓸 수 있다.
  # 키는 list_projects 가 형식을 걸렀다(공백 없음) — 단어로 나눠도 된다.
  set --
  for key in $(printf '%s\n' "$list" | cut -f1); do set -- "$@" "$AI_DIR/repos/$key"; done
  trust_folders "$AI_DIR" "$@" || log "경고: 저장소 폴더 신뢰를 적지 못했습니다"
  tab=$(printf '\t')
  # 받기·브라우저는 프로젝트끼리 서로 기다릴 일이 없다 — 프로젝트가 늘수록 순서대로 하면 부팅이 그만큼 길어진다(WP-1267).
  # 1) 저장소를 모두 한꺼번에 받고 기다린다 → 2) 성공한 것들의 Playwright 버전(겹치면 한 번)을 한꺼번에 받고 기다린다 → 3) 칸은 차례로.
  #    칸은 같은 창을 나누고 ~/.claude.json 을 칸의 claude 가 쓰기 시작하므로 계속 하나씩 띄운다(mark_trust 는 위에서 끝냈다).
  #    각 일의 결과(출력·종료 코드)는 임시 폴더의 프로젝트별 파일에 두고, 로그는 기다린 뒤 목록 순서대로 남긴다.
  BOOT_DIR=$(mktemp -d "$GENIA_WORK/tmp/boot.XXXXXX") || {
    log "경고: 임시 폴더를 만들지 못했습니다 — 이번에는 띄우지 않고 다시 합니다"
    return 1
  }
  BG_PIDS=""
  while IFS="$tab" read -r key url branch; do
    # repo 가 낸 줄(cloned·fetched·no-project-md…)은 그대로 로그로. clone-failed·url-changed·busy 면 이번에는 띄우지 않는다.
    (
      out=$("$GW_SCRIPTS/agent-project" repo "$AI_DIR" "$key" "$url" ${branch:+"$branch"} </dev/null)
      rc=$?
      printf '%s' "$out" > "$BOOT_DIR/$key.out"
      printf '%s' "$rc" > "$BOOT_DIR/$key.rc" # 끝에 적는다 — 이 파일이 있으면 위 출력도 다 적힌 것
    ) &
    BG_PIDS="$BG_PIDS $!"
  done <<LIST_EOF
$list
LIST_EOF
  # shellcheck disable=SC2086 # pid 들은 숫자 단어다. SIGTERM 이 오면 on_term 이 BG_PIDS 를 끄므로 여기서 오래 붙잡히지 않는다.
  wait $BG_PIDS
  ok_list=""
  pw_versions=" "
  while IFS="$tab" read -r key url branch; do
    out=$(cat "$BOOT_DIR/$key.out" 2>/dev/null)
    [ -n "$out" ] && log "$key: $(printf '%s' "$out" | tr '\n' ' ')"
    [ "$(cat "$BOOT_DIR/$key.rc" 2>/dev/null)" = 0 ] || continue
    ok_list="$ok_list $key"
    if v=$(playwright_version "$AI_DIR/repos/$key"); then
      case "$pw_versions" in *" $v "*) ;; *) pw_versions="$pw_versions$v " ;; esac
    fi
  done <<LIST_EOF
$list
LIST_EOF
  BG_PIDS=""
  for v in $pw_versions; do
    ensure_playwright "$v" &
    BG_PIDS="$BG_PIDS $!"
  done
  # shellcheck disable=SC2086
  [ -z "$BG_PIDS" ] || wait $BG_PIDS
  BG_PIDS=""
  rm -rf "$BOOT_DIR"
  BOOT_DIR=""
  for key in $ok_list; do
    note_launch "$key" "$(GW_SKIP_EVENTS_ENSURE=1 "$GW_SCRIPTS/agent-project" start "$AI_DIR" "$key" </dev/null)"
    BOOT_KEYS="${BOOT_KEYS:-} $key"
  done
  return 0
}

# 알림 감시 창 — 회차마다 한 번 챙긴다(모든 칸이 쉬는 동안 감시가 죽어도 「연결 끊김」이 길게 가지 않게).
# 칸을 띄우는 agent-project 는 칸마다 챙기지 않게 꺼 두고(GW_SKIP_EVENTS_ENSURE) 여기서만 부른다.
ensure_events() {
  if [ -x "$GW_SCRIPTS/agent-events" ]; then
    "$GW_SCRIPTS/agent-events" ensure "$AI_DIR" >/dev/null 2>&1 </dev/null || log "경고: 알림 감시 창을 띄우지 못했습니다"
  elif [ -z "${EVENTS_WARNED:-}" ]; then
    # 0.1.30 이하 플러그인에는 상시 감시가 없다 — 갱신에 실패했거나 서버가 아직 옛 버전이다. 한 번만 알린다.
    log "경고: 이 플러그인 버전에는 agent-events 가 없습니다 — 알림 감시를 상시로 띄우지 못합니다"
    EVENTS_WARNED=1
  fi
  return 0
}

# 8. 감독 한 번 — 칸 상태를 tmux 에서 한 번만 읽어(agent-window --states) 죽었거나 빠진 칸만 띄우고(agent-project start 는 죽은 칸을
#    그 자리에서 되살린다), 6일 넘은 칸은 다시 띄우고, 끝에 알림 감시 창을 한 번 챙긴다.
#    살피는 칸은 처음 띄운 키 + 지금 tmux 에 있는 칸(work-loop 가 새로 맡아 띄운 것 포함).
supervise_once() {
  if [ "${PROJECTS_READY:-0}" != 1 ]; then
    start_projects && PROJECTS_READY=1
  fi
  now=$(date +%s)
  # 「키 0|1(죽음)」 한 줄씩. --states 가 없는 옛 플러그인이면 키만 읽는다 — 상태를 모르니 모두 띄워 본다(도는 칸은 exists 로 그대로 둔다).
  states=$("$GW_SCRIPTS/agent-window" --states "$GENIA_AGENT_NAME" 2>/dev/null) ||
    states=$("$GW_SCRIPTS/agent-window" --keys "$GENIA_AGENT_NAME" 2>/dev/null)
  keys=$({
    for k in ${BOOT_KEYS:-}; do printf '%s\n' "$k"; done
    printf '%s\n' "$states" | awk 'NF { print $1 }'
  } | sort -u)
  for k in $keys; do
    gw_valid_project_key "$k" && [ -d "$AI_DIR/repos/$k" ] || continue
    started=$(cat "$AI_DIR/state/pane-started-$k" 2>/dev/null)
    restart=""
    [ -n "$started" ] && [ $((now - started)) -ge "$GENIA_RESTART_AFTER" ] && restart=--restart
    if [ -z "$restart" ] && printf '%s\n' "$states" | grep -qxF "$k 0"; then
      # 도는 칸은 건드리지 않고 띄운 시각만 남긴다 — work-loop 가 스스로 띄운 칸도 6일 뒤 다시 띄우게.
      note_launch "$k" exists
      continue
    fi
    # shellcheck disable=SC2086 # restart 는 비었거나 --restart 한 단어다.
    note_launch "$k" "$(GW_SKIP_EVENTS_ENSURE=1 "$GW_SCRIPTS/agent-project" start $restart "$AI_DIR" "$k" </dev/null)"
  done
  ensure_events
}

# 9. 정리 — 칸마다 SIGTERM(claude 가 스스로 끝내게) → 최대 GENIA_STOP_WAIT 초 기다림 → tmux 서버 끄기.
#    tmux 는 늘 TMUX_BIN 으로 — 테스트가 사람의 tmux 서버를 끄지 않게.
stop_all() {
  pids=$("$TMUX_BIN" list-panes -a -F '#{pane_dead} #{pane_pid}' 2>/dev/null | awk '$1 == 0 { print $2 }')
  for p in $pids; do kill -TERM "$p" 2>/dev/null; done
  n=$GENIA_STOP_WAIT
  while [ "$n" -gt 0 ]; do
    alive=0
    for p in $pids; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && break
    sleep 1
    n=$((n - 1))
  done
  "$TMUX_BIN" kill-server >/dev/null 2>&1
  return 0
}

# 빌드 때 — plugins.lock 의 플러그인을 받는다. 마켓플레이스가 버전 지정을 받지 않아 받은 뒤 버전을 lock 과 맞춰 본다.
# anthropic-plugin-directory 는 내장이라 그대로, claude-plugins-official·superpowers-marketplace·genia-works 는 먼저 더한다(실측).
# 셋째 인자는 받지 않을 플러그인 id — Gen:iA Code 이미지는 genia-works 를 genia 확장으로 따로 싣으므로 빼고, 그때는 Works 마켓플레이스도 더하지 않는다.
# genia-works 마켓플레이스는 Works 서버라 빌더에서 닿지 않을 수 있다(DH-VM 은 내부 주소를 줘야 닿았다) — 그때는 굳히지 않고 넘어간다.
# Pod 가 뜰 때 update_plugins 가 자기 Works 에서 받는다(어차피 서버 버전으로 맞춘다). 나머지 플러그인은 받지 못하면 빌드 실패다.
install_plugins() {
  lock=$1
  origin=${2:-$GENIA_DEFAULT_ORIGIN}
  skip=${3:-}
  claude plugin marketplace add anthropics/claude-plugins-official >&2 </dev/null || return 1
  claude plugin marketplace add obra/superpowers-marketplace >&2 </dev/null || return 1
  if [ "$skip" != genia-works@genia-works ] &&
    ! claude plugin marketplace add "$origin/claude/marketplace.json" >&2 </dev/null; then
    echo "경고: genia-works 마켓플레이스($origin)에 닿지 못해 이미지에 굳히지 않습니다 — Pod 가 뜰 때 받습니다" >&2
    skip=genia-works@genia-works
  fi
  while read -r id ver; do
    case "$id" in '' | '#'*) continue ;; esac
    [ "$id" = "$skip" ] && continue
    claude plugin install "$id" >&2 </dev/null || return 1
  done < "$lock"
  verify_plugin_lock "$lock" "$skip"
}

# verify_plugin_lock <lock> [<건너뛸 id>] — 받은 플러그인 버전이 lock 과 같은지. latest 는 맞춰 보지 않는다(설치만 확인). 다르면 무엇이 다른지 한 줄씩 내고 1.
# 버전 끝의 「-<12자리 16진수>」는 맞춰 보지 않는다 — 공식 디렉터리는 그 자리에 마켓플레이스 저장소의 최신 커밋을 붙이는데, 그 저장소는
# 다른 플러그인 판 올림 커밋이 분 단위로 들어와 플러그인 판이 그대로여도 값이 바뀐다(11-04 하루에 a7ba5b93db0c → a2e251d9b97b → fa4eb54397ee,
# v0.9.40·v0.9.42 이미지 빌드 실패). 플러그인 판(1.0.1 등)이 바뀌면 그대로 실패시킨다.
plugin_semver() { printf '%s' "$1" | sed -E 's/-[0-9a-f]{12}$//'; }
verify_plugin_lock() {
  list=$(claude plugin list --json) || return 1
  bad=0
  while read -r id ver; do
    case "$id" in '' | '#'*) continue ;; esac
    [ "$id" = "${2:-}" ] && continue # 빌드에서 굳히지 않기로 한 것(install_plugins)
    got=$(printf '%s' "$list" | jq -r --arg id "$id" '[.[] | select(.id == $id)][0].version // empty')
    if [ -z "$got" ]; then
      echo "plugins.lock: $id 가 설치되지 않았습니다" >&2
      bad=1
    elif [ "$ver" != latest ] && [ "$(plugin_semver "$got")" != "$(plugin_semver "$ver")" ]; then
      echo "plugins.lock: $id 버전이 다릅니다 — lock $ver, 받은 것 $got (lock 과 agent-templates/claude-code.yaml 을 함께 고치세요)" >&2
      bad=1
    fi
  done < "$1"
  return $bad
}
