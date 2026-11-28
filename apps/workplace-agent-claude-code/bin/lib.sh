# 작업 공간 엔트리포인트의 함수들(WP-1252) — bin/entrypoint 와 Dockerfile(빌드 때 플러그인 설치)이 source 한다.
# Pod 가 주는 것(마운트·env·디스크 배치)은 docs/integrations/agent-pod-contract.md 가 기준이다. 사람이 start-agent 4~6번으로 하던
# 절차(프로젝트 읽기 → 저장소 받기 → 칸 띄우기)를 같은 플러그인 스크립트로 사람 손 없이 돈다.
# 테스트가 함수 하나씩 부를 수 있게 나눴고, 경로·시간은 아래 env 로 바꿀 수 있다(운영은 기본값). 맥(bash 3.2)에서도 돌게 쓴다.
# 키·토큰 원문은 명령줄 인자·로그에 남기지 않는다 — 파일·표준 입력으로만 넘긴다.
# 플러그인을 찾은 뒤(resolve_plugin_scripts)에는 플러그인의 공용 함수(gw-lib.sh)를 읽어 키 저장·키 검사·경로·파일 쓰기를 플러그인과 같은 규칙으로 한다.
# 그 앞(필수 확인·마켓플레이스)은 이미지에 genia-works 가 없을 수도 있어(빌더에서 Works 에 닿지 않음) gw-lib 없이 돈다.
# Gen:iA Code 이미지(apps/workplace-agent-genia-code, WP-1296)도 이 파일을 그대로 COPY 해 쓰고, 그 이미지 전용 함수(lib-genia.sh)를 뒤에 읽어 덮어쓴다 —
# 함수 이름·인자를 바꾸면 그 이미지의 엔트리포인트·테스트도 함께 본다.
#   다른 이미지가 덮어쓰는 지점: trust_folders(7 의 폴더 신뢰)·before_supervise·can_launch(감독 회차 tick). 함께 쓰는 것: adopt_plugin_scripts·
#   use_baked_plugin·write_superpowers_agents_md·bg_wait·bg_wait_timeout·seed_login_file·login_file_ready·tick 과 필수 확인·CA·키·git·dind·프로젝트·
#   감독·정리, 그리고 종료 신호 trap(install_term_trap)·감독 루프(run_supervisor) — 엔트리포인트는 부팅 단계만 적고 이 둘을 부른다.
#   디스크 정리(WP-1683)도 함께 쓴다: clean_tmp(prepare_dirs — 부팅 때 /work/tmp 비우기)·sweep_tmp_due(감독 루프 회차마다 — 3일 지난 tmp)·
#   sweep_worktrees·prune_browsers(start_projects — 끝난 이슈 워크트리·안 쓰는 Playwright 브라우저). 정리 규칙은 플러그인의
#   agent-sweep·browser-prune 에 있고 여기서는 부르기만 한다.
#   Claude Code 엔트리포인트는 tick 을 쓰지 않는다(run_supervisor boot — 부팅 때 start_projects 를 한 번 부르고 회차마다 supervise_once 를 부른다).
#   Claude Code 전용(다른 이미지는 부르지 않는다): update_plugins·resolve_plugin_scripts·write_settings·mark_trust·install_plugins·verify_plugin_lock.

GENIA_RUN_DIR=${GENIA_RUN_DIR:-/run/genia}          # runner 가 파일 하나씩(subPath) 꽂는 곳 — 읽기만 한다
GENIA_WORK=${GENIA_WORK:-/work}                     # PVC — 다시 받기 비싼 것만(AI 폴더·저장소·캐시)
TMUX_BIN=${GW_TMUX:-tmux}                           # 플러그인 스크립트와 같은 테스트 훅(격리 tmux 서버)
GENIA_GH_LOGIN_TRIES=${GENIA_GH_LOGIN_TRIES:-3}            # gh 로그인 최대 시도 수(일시적 네트워크 실패 대비)
GENIA_GH_LOGIN_WAIT=${GENIA_GH_LOGIN_WAIT:-5}              # 시도 사이 대기 초
# 잘못된 값(빈 값·문자·0 으로 시작 — 0·00 포함)이면 기본값으로 — 시도 수가 0 이면 로그인을 한 번도 안 하고, 숫자가 아니면 셸 산술이 깨진다.
case "$GENIA_GH_LOGIN_TRIES" in '' | *[!0-9]* | 0*) GENIA_GH_LOGIN_TRIES=3 ;; esac
case "$GENIA_GH_LOGIN_WAIT" in '' | *[!0-9]*) GENIA_GH_LOGIN_WAIT=5 ;; esac
GENIA_GH_LOGIN_TIMEOUT=${GENIA_GH_LOGIN_TIMEOUT:-30}       # gh 로그인·상태 확인 한 번의 제한 초 — 응답 없는 네트워크에 부팅이 멈추지 않게
case "$GENIA_GH_LOGIN_TIMEOUT" in '' | *[!0-9]* | 0*) GENIA_GH_LOGIN_TIMEOUT=30 ;; esac
# 상태 파일·경고에 남기는 gh 오류에서 토큰 모양을 가리는 sed 식 — 새 접두사 토큰(gh?_·github_pat_)과 옛 40자 16진 토큰.
GH_TOKEN_MASK='s/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/***/g; s/[0-9a-fA-F]{40}/***/g'
GENIA_DIND_WAIT=${GENIA_DIND_WAIT:-60}              # docker 소켓을 기다리는 초
GENIA_SUPERVISE_INTERVAL=${GENIA_SUPERVISE_INTERVAL:-60}
GENIA_RESTART_AFTER=${GENIA_RESTART_AFTER:-518400}  # 6일 — /loop 반복이 7일 뒤 끝나기 전에 칸을 다시 띄운다
GENIA_STOP_WAIT=${GENIA_STOP_WAIT:-40}              # SIGTERM 뒤 칸이 끝나기를 기다리는 초(grace 60초 안)
GENIA_BASE_BROWSERS=${GENIA_BASE_BROWSERS:-/ms-playwright}
BROWSERS_DIR=${PLAYWRIGHT_BROWSERS_PATH:-$GENIA_WORK/.cache/ms-playwright} # PVC 의 Playwright 브라우저 폴더
GENIA_PLAYWRIGHT_CLI_CORE=${GENIA_PLAYWRIGHT_CLI_CORE:-/opt/genia/playwright-cli-core} # playwright-cli 가 품은 playwright-core(이미지 빌드가 링크, WP-1404)
GENIA_XVFB=${GENIA_XVFB:-Xvfb}                      # 가상 화면 서버(베이스 이미지에 있다)
GENIA_DISPLAY=${GENIA_DISPLAY:-:99}
GENIA_TMP_MAX_AGE_MIN=${GENIA_TMP_MAX_AGE_MIN:-4320} # 3일 — 도는 동안 /work/tmp 에서 이보다 오래 안 바뀐 파일을 지운다(WP-1683)
GENIA_TMP_SWEEP_EVERY=${GENIA_TMP_SWEEP_EVERY:-3600} # 1시간 — 감독 회차 중 위 tmp 정리를 도는 간격(초)
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
# 만든 바로 뒤 /work/tmp 를 비운다(clean_tmp) — 이 뒤로는 플러그인 명령·브라우저 받기·칸이 tmp 를 쓰기 시작한다.
prepare_dirs() {
  mkdir -p "$GENIA_WORK/tmp" "$GENIA_WORK/.cache" "$GENIA_WORK/.gradle" "$GENIA_WORK/.pnpm-store" "$AI_DIR/state" ||
    die "$GENIA_WORK 에 폴더를 만들지 못했습니다 — PVC 와 fsGroup 1001 을 확인하세요"
  clean_tmp
  seed_browsers
}

# /work/tmp(TMPDIR) 정리(WP-1683) — tmp 는 PVC 라 Pod 가 바뀌어도 남는데, 그 안에 Playwright transform 캐시·node compile 캐시,
# Claude 세션 scratchpad(claude-<uid>/…), 스크립트·subagent 임시 폴더(gw*·subagent* 등)가 끝없이 쌓여 /work 를 채웠다.
#
# 부팅 때(prepare_dirs) 바로 아래를 모두 지운다 — 이 컨테이너의 어느 프로세스도 아직 tmp 를 쓰지 않으므로(칸·플러그인 명령은 이 뒤에 뜬다)
# 지난 Pod 가 남긴 것뿐이다. 지우지 못한 것(dind 가 bind mount 로 만든 root 소유 파일 등)이 있으면 경고 한 줄만 — 부팅은 계속한다. 늘 0.
# 큰 폴더를 지우는 동안에도 SIGTERM 을 바로 받게 bg_wait 로 돌린다.
clean_tmp() {
  local t="$GENIA_WORK/tmp" left
  [ -d "$t" ] || return 0
  bg_wait find "$t" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null
  left=$(find "$t" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
  [ "$left" = 0 ] || log "경고: /work/tmp 를 다 비우지 못했습니다 — ${left}개 남음"
  return 0
}

# 도는 동안의 tmp 정리 — GENIA_TMP_MAX_AGE_MIN(3일)보다 오래된 일반 파일·심볼릭 링크를 지우고, 바로 아래(깊이 1)의 빈 폴더 중
# 3일 넘은 것을 지운다. 「오래됨」은 수정 시각(mtime)과 상태 변경 시각(ctime)이 둘 다 기준을 넘은 것이다 — tar·npm 은 받은 파일의 mtime 을
# 원래 값(1985 등)으로 되살리므로 mtime 만 보면 방금 푼 파일을 지운다. ctime 은 만들거나 바꾼 때로 정해지고 되돌릴 수 없다.
# 지우지 않는 것: 소켓·FIFO(돌고 있는 프로세스가 열어 둔 통로일 수 있다 — 오래 안 바뀌어도 쓰는 중), 이름이 Singleton* 인 심볼릭 링크
# (Chrome 프로필 잠금 SingletonLock·SingletonSocket·SingletonCookie — 며칠 도는 브라우저의 것을 지우면 다른 Chrome 이 같은 프로필을 열어 깨진다),
# claude-* 아래 폴더(돌고 있는 Claude 세션의 scratchpad — 비어 있어도 세션이 다시 쓴다). 캐시(transform·compile)는 다른 곳으로 옮기지 않고
# 이 나이 규칙으로 상한을 둔다 — 옮겨도 같은 크기가 PVC 에 쌓인다. 지우기 오류(권한 등)는 버린다. 늘 0.
sweep_tmp() {
  local t="$GENIA_WORK/tmp" n="$GENIA_TMP_MAX_AGE_MIN"
  [ -d "$t" ] || return 0
  find "$t" -mindepth 1 -type f -mmin +"$n" -cmin +"$n" -exec rm -f {} + 2>/dev/null
  find "$t" -mindepth 1 -type l ! -name 'Singleton*' -mmin +"$n" -cmin +"$n" -exec rm -f {} + 2>/dev/null
  find "$t" -mindepth 1 -maxdepth 1 -type d -empty -mmin +"$n" -cmin +"$n" ! -name 'claude-*' -exec rmdir {} + 2>/dev/null
  return 0
}

# 감독 회차의 tmp 정리 — 마지막으로 돈 시각($AI_DIR/state/tmp-swept, 에포크 초)에서 GENIA_TMP_SWEEP_EVERY(1시간)가 지났거나 기록이 없으면
# sweep_tmp 를 돌리고(5분에 끊는다 — 감독 회차가 큰 tmp 에 멈추지 않게) 지금 시각을 적는다. 회차마다 find 로 tmp 전체를 훑지 않으려는 것이다.
# 감독 루프가 회차마다 부른다 — tick 모드는 tick 이(can_launch 와 상관없이), boot 모드는 run_supervisor 의 루프가 supervise_once 뒤에.
# 모든 실행기 이미지가 둘 중 하나를 지난다. gw-lib 의 gw_stamp_age 를 쓰므로 플러그인을 찾은 뒤(감독 루프는 그 뒤에 돈다). 늘 0.
sweep_tmp_due() {
  local stamp="$AI_DIR/state/tmp-swept" age
  if age=$(gw_stamp_age "$stamp") && [ "$age" -lt "$GENIA_TMP_SWEEP_EVERY" ]; then
    return 0
  fi
  bg_wait_timeout 300 sweep_tmp
  date +%s > "$stamp" 2>/dev/null
  return 0
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

# 빌드 때 굳힌 플러그인을 쓰기로 한다(Codex 등 마켓플레이스에서 따로 받지 않는 이미지의 use_plugin 공용) — use_baked_plugin <플러그인 폴더> <구동기 하위 폴더>.
# 이미지와 플러그인이 같은 릴리스로 함께 빌드되므로 칸 명령(agent-project 의 실행기 분기)이 부르는 구동기(<하위 폴더>/driver.mjs)가 있어야
# 쓸 수 있다 — 없으면 1(엔트리포인트가 멈춘다). 있으면 그 플러그인의 scripts 를 adopt_plugin_scripts 로 고른다.
use_baked_plugin() {
  local dir=$1 driver=$2
  [ -f "$dir/$driver/driver.mjs" ] || return 1
  adopt_plugin_scripts "$dir/scripts"
}

# 전역 지시 파일(AGENTS.md 등)에 superpowers 세션 시작 안내를 쓴다(세션 시작 hook 을 돌리지 않는 실행기 공용 — Codex 의 write_codex_agents_md,
# OpenCode 의 write_opencode_agents_md).
#   write_superpowers_agents_md <출력 경로> <using-superpowers SKILL.md 경로> <실행기 항목>
#   셋째 인자는 「스킬 파일을 읽고 따른다」 항목 뒤에 붙는 본문 줄 그대로다 — 스킬을 부르는 방법과 Claude Code 전용 도구 이름을 무엇으로
#   바꾸는지가 실행기마다 다르다(여러 줄이어도 된다).
# 매번 새로 쓴다(gw_write_atomic — gw-lib 를 읽은 뒤에 부른다). 스킬이 이미지에 없으면(빌드가 바뀜) 경고하고 옛 파일을 지운 뒤 0 —
# 없는 경로를 가리키지 않게, 그리고 안내가 없어도 칸은 띄울 수 있게.
write_superpowers_agents_md() {
  local out=$1 skill=$2 runner_items=$3
  if [ ! -f "$skill" ]; then
    rm -f "$out"
    log "경고: superpowers 의 using-superpowers 스킬($skill)이 없습니다 — 세션 시작 안내 없이 띄워 계획·SDD 단계를 건너뛸 수 있습니다"
    return 0
  fi
  mkdir -p "$(dirname "$out")" && gw_write_atomic "$out" "# 작업 공간 공통 지시 (Works 엔트리포인트가 Pod 를 띄울 때마다 새로 쓴다)

이 작업 공간에는 superpowers 개발 절차 스킬이 설치되어 있다(~/.agents/skills/superpowers).

- 세션을 시작하면 다른 무엇보다 먼저 using-superpowers 스킬 파일 $skill 을 읽고 그대로 따른다.
$runner_items"
}

# 3. ~/.claude/settings.json — 매번 덮어쓴다(재생성된 Pod 에 옛 값이 남지 않게, Review Focus 5). 플러그인 MCP 주소는 플러그인 설정
#    server_url(기본은 운영) 이라 GENIA_WORKS_MCP_URL 로 채운다. claude-plugins-official 은 내장이 아니라 빌드 때 더한 것 — 빼면 LSP 플러그인이 사라진다.
#    genia-works 마켓플레이스 주소는 2번이 정한 MARKETPLACE_URL — 설정의 주소가 등록된 주소와 다르면 그 마켓플레이스가 목록에서 사라진다(실측).
#    플러그인 명령(install 등)도 이 파일을 고치므로 2번 뒤에 쓴다.
#    추론 강도(WP-1542)는 설정 칸 effort 를 effortLevel 로 적는다. Claude Code 는 low·medium·high·xhigh·max 다섯 값만 받고 그 밖은 거부하므로 그 값만 통과시킨다.
#    effort 키가 아예 없는 옛 에이전트는 설정 화면이 보여 주는 기본(high)과 동작을 맞추려 high. 키는 있는데 비었거나 다섯 값이 아니면 effortLevel 을 빼고
#    경고 한 줄만 남긴다(값 원문은 로그에 싣지 않는다). 모델별 맞춤은 하지 않는다 — 지원 안 하는 강도는 Claude Code 가 알아서 낮춘다.
#    Code Mode(실험, WP-1960)는 env 블록의 CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 로 켠다 — 모델이 REPL 코드로 여러 도구를 한 턴에 묶어 불러
#    같은 과제에서 API 시간·비용이 줄었다(WP-1879 벤치). 대화형 칸은 이 파일의 env 만으로 켜져 셸에는 내보내지 않는다(실측) — 셸 env 만 있는
#    헤드리스 `claude -p` 는 Code Mode 를 거부하고 경고를 내므로 칸 밖 호출에 새지 않게. 모델(Opus 5.5 미만)·계정 게이트 등 조건이 안 맞으면
#    Claude Code 가 스스로 일반 모드로 뜬다. 확인 창은 mark_trust 의 플래그가 막는다.
write_settings() {
  local effort out
  mkdir -p "$HOME/.claude" || return 1
  # 한 번에 읽는다 — config 가 객체가 아니거나 effort 키가 없으면 @missing(옛 에이전트 → high), 있으면 그 값을 문자열로(null 은 빈 값).
  effort=$(config_get '(.config // {}) | if type == "object" and has("effort") then (.effort // "" | tostring) else "@missing" end') || return 1
  case "$effort" in
    @missing) effort=high ;;
    low|medium|high|xhigh|max) ;;
    *)
      log "경고: 추론 강도 설정이 비었거나 올바르지 않아 적지 않았습니다 — Claude Code 기본 강도로 시작합니다(허용: low·medium·high·xhigh·max)"
      effort=
      ;;
  esac
  # settings.json 의 effortLevel 은 「새 세션 기본값」이라 Claude Code 가 max 는 저장하지 않는 값으로 다룬다(2.1.316 — 'max' is session-only).
  # 그래서 세션 강도를 정하는 CLAUDE_CODE_EFFORT_LEVEL 도 내보낸다 — 이 함수는 엔트리포인트 셸에서 돌고 칸(tmux)은 그 뒤 감독이 띄워 env 를
  # 물려받는다(setup_ca 와 같은 길). 값이 없으면 지워 이미지·부모의 옛 값이 남지 않게 한다.
  if [ -n "$effort" ]; then
    export CLAUDE_CODE_EFFORT_LEVEL="$effort"
  else
    unset CLAUDE_CODE_EFFORT_LEVEL
  fi
  out=$(jq -n --slurpfile c "$CONFIG" --arg mk "$MARKETPLACE_URL" --arg mcp "${GENIA_WORKS_MCP_URL:-}" --arg effort "$effort" '
      $c[0] as $c
      | (if (($c.config.model // "") | tostring) != "" then { model: $c.config.model } else {} end)
      + (if $effort != "" then { effortLevel: $effort } else {} end)
      + { enabledPlugins: ((($c.plugins // []) | map({ key: "\(.name)@\(.marketplace)", value: true }) | from_entries)
                           + { "genia-works@genia-works": true }) }
      + { extraKnownMarketplaces: {
            "genia-works": { source: { source: "url", url: $mk } },
            "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } },
            "superpowers-marketplace": { source: { source: "github", repo: "obra/superpowers-marketplace" } } } }
      + { skipDangerousModePermissionPrompt: true }
      + { env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1" } }
      + (if $mcp != "" then { pluginConfigs: { "genia-works@genia-works": { options: { server_url: $mcp } } } } else {} end)
    ') && gw_write_atomic "$HOME/.claude/settings.json" "$out"
}

# 4. ~/.claude.json — 첫 실행 창(온보딩·bypass 확인·폴더 신뢰)이 사람 없는 칸을 막지 않게. 키 이름은 DH-VM 의 것 그대로.
#    claude 가 적은 다른 값은 둔다. 폴더 신뢰는 상위 폴더 신뢰가 하위에도 미친다(실측) — AI 폴더를 신뢰해 두면 work-loop 가 나중에 받는 저장소도 덮는다.
#    Code Mode 확인 창(WP-1960): 두 플래그가 없으면 대화형 칸이 「Code Mode (experimental)」 opt-in 창에서 멈춘다(2.1.330 실측). 키 이름 끝의
#    V1 은 Claude Code 가 안내문을 바꾸면 올라갈 수 있다 — CLAUDE_CODE_VERSION 을 올릴 때 tmux 로 칸이 창 없이 뜨는지 다시 본다(README).
mark_trust() {
  f="$HOME/.claude.json"
  [ -s "$f" ] || printf '{}\n' > "$f"
  out=$(jq '.hasCompletedOnboarding = true | .bypassPermissionsModeAccepted = true
         | .codeModeCaveatsAcceptedV1 = true | .codeModeAutoModeCaveatAcceptedV1 = true
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

# 1c. node 인증서 묶음 — node_ca_bundle <루트 CA 파일>: 루트 + (있으면) 위치 추가 CA 를 이은 $HOME/.genia-node-ca.pem 을 만들고 그 경로를 출력한다.
#     node·Bun 은 이미지 시스템 CA 에 넣어 둔 사설 루트를 읽지 않아 NODE_EXTRA_CA_CERTS 로 따로 줘야 하는데, 그 값은 파일 하나라 위치 추가 CA 와
#     이어 붙인다. 사설 루트를 싣는 실행기 이미지가 함께 쓴다. 못 만들면 출력 없이 1.
node_ca_bundle() {
  local out="$HOME/.genia-node-ca.pem" extra="$GENIA_RUN_DIR/ca/ca.crt"
  set -- "$1"
  [ -s "$extra" ] && set -- "$@" "$extra"
  if cat "$@" > "$out.tmp" 2>/dev/null && mv -f "$out.tmp" "$out"; then
    printf '%s\n' "$out"
    return 0
  fi
  rm -f "$out.tmp"
  return 1
}

# 5b. git 신원과 저장소 자격 증명(WP-1268·WP-1276) — runner 가 AI 별·호스트별 토큰을 $GENIA_RUN_DIR/repo-tokens/<github|gitlab>/<host> 파일로 꽂는다.
#     GitHub 는 호스트마다 gh 에 로그인(토큰은 표준 입력으로만 — 인자·로그에 남기지 않는다)하고 git 자격 증명 도우미를 건다.
#     로그인은 일시적 네트워크 실패에 대비해 최대 GENIA_GH_LOGIN_TRIES 회 다시 시도하고, 결과(성공·실패와 gh 마지막 오류 전문, 토큰 모양은 ***)를
#     $AI_DIR/state/git-auth.log 에 부팅마다 덮어써 남긴다(WP-2167) — 세션이 로그인이 왜 안 됐는지 읽을 수 있게.
#     GitLab 은 호스트마다 git 자격 증명 도우미가 그때그때 토큰 파일을 읽게 한다(설정·로그에 토큰을 두지 않는다). MR 은 플러그인의
#     gw-repo 가 같은 파일을 glab 에 넘긴다. 실패는 모두 경고만(저장소 받기가 clone-failed 로 알린다).
# 호스트별 git 자격 증명 도우미 — token_file_helper <호스트> <토큰 파일> <사용자 이름>. git 이 물을 때 그때 토큰 파일을 읽어 답하므로
# 설정에 토큰을 두지 않는다. 빈 값으로 먼저 지워 다른 도우미(예: 시스템 기본)가 앞서 답하지 않게 한다. GitLab 과 로그인 실패한 GitHub 호스트가 쓴다.
token_file_helper() {
  git config --global "credential.https://$1.helper" "" &&
    git config --global --add "credential.https://$1.helper" \
      "!f() { test \"\$1\" = get && printf 'username=$3\\npassword=%s\\n' \"\$(tr -d '\\r\\n ' < '$2')\"; }; f"
}

# 저장된 gh 로그인으로 부르는 gh — 환경의 GH_TOKEN·GITHUB_TOKEN 은 이 호출에서만 뺀다. 있으면 gh 2.106.0 이 「환경변수 토큰을 쓰는 중」이라며
# 저장 로그인을 거절하고(격리 HOME 에서 확인), auth status 도 환경 토큰을 검사한다.
gh_stored() {
  env -u GH_TOKEN -u GITHUB_TOKEN gh "$@"
}

# gh 로그인 한 번 — gh_login_once <호스트> <토큰 파일> <오류 파일>. 토큰은 표준 입력으로만, 오류는 파일로(뒤에서 돌아 $(…) 로 받지 않는다).
gh_login_once() {
  # 오류 파일은 먼저 비운다 — 토큰 파일 열기가 실패하면 2> 가 열리기 전에 멈춰 앞 시도·앞 호스트의 오류가 남는다.
  : > "$3"
  gh_stored auth login --hostname "$1" --with-token < "$2" > /dev/null 2> "$3"
}

setup_git() {
  git config --global user.name "$GENIA_AGENT_NAME"
  git config --global user.email "$GENIA_AGENT_NAME@agents.genia-works.local"
  tokens="$GENIA_RUN_DIR/repo-tokens"
  found=0
  gh_found=0
  # 토큰 값을 담는 변수는 함수 안에만 둔다 — 같은 셸에서 이어 도는 감독 회차·종료 신호 처리로 새지 않게(중간에 끊겨도).
  local tokval mask err rc
  gitauth="$AI_DIR/state/git-auth.log"
  errf="$AI_DIR/state/.gh-login.err"
  mkdir -p "$AI_DIR/state" 2>/dev/null
  : > "$gitauth" 2>/dev/null || log "경고: gh 로그인 상태 파일($gitauth)을 비우지 못했습니다"
  for token in "$tokens"/github/*; do
    [ -s "$token" ] || continue
    found=1
    gh_found=1
    host=$(basename "$token")
    ok=0
    try=0
    err=""
    while [ "$try" -lt "$GENIA_GH_LOGIN_TRIES" ]; do
      try=$((try + 1))
      # 제한 시간 안에서 뒤로 돌려 기다린다 — 응답 없는 네트워크에 멈추지 않고, 기다리는 동안에도 종료 신호를 바로 받는다(bg_wait_timeout).
      rc=0
      bg_wait_timeout "$GENIA_GH_LOGIN_TIMEOUT" gh_login_once "$host" "$token" "$errf" || rc=$?
      if [ "$rc" = 0 ]; then
        ok=1
        break
      fi
      err=$(cat "$errf" 2>/dev/null)
      # 제한 시간에 끊긴 것(bg_wait_timeout 이 128 이상)은 앞서 나온 출력이 있어도 시간 제한을 덧붙이고, 출력 없이 끝난 것은 종료 코드로 남긴다.
      if [ "$rc" -ge 128 ]; then
        err="${err:+$err
}gh auth login 이 ${GENIA_GH_LOGIN_TIMEOUT}초 안에 끝나지 않았습니다(시간 제한)"
      elif [ -z "$err" ]; then
        err="gh auth login 종료 $rc, 오류 출력 없음"
      fi
      # bg_wait 로 기다려 종료 신호(SIGTERM)를 대기 중에도 바로 받는다(앞에서 sleep 하면 끝날 때까지 trap 이 밀린다).
      [ "$try" -lt "$GENIA_GH_LOGIN_TRIES" ] && bg_wait sleep "$GENIA_GH_LOGIN_WAIT"
    done
    # 결과 한 줄(+ 실패면 gh 마지막 오류 전문)을 상태 파일에 남긴다 — 세션이 읽고 원인을 알 수 있게. 토큰 모양은 가린다.
    # gh 설정 폴더 — GH_CONFIG_DIR > XDG_CONFIG_HOME/gh > ~/.config/gh (gh 가 고르는 순서). 줄 이름은 늘 ~/.config/gh 로 쓴다.
    ghcfg="$HOME/.config/gh"
    [ -n "${XDG_CONFIG_HOME:-}" ] && ghcfg="$XDG_CONFIG_HOME/gh"
    [ -n "${GH_CONFIG_DIR:-}" ] && ghcfg="$GH_CONFIG_DIR"
    cfg=없음
    [ -d "$ghcfg" ] && cfg=있음
    # 로그인 상태 확인은 로그인이 된 때만 — 실패했으면(네트워크 장애일 수 있다) 부팅·종료 신호를 더 밀지 않는다.
    # 가리기는 실패 때만 쓴다 — 토큰 모양에 더해 그 토큰 파일의 값 자체도(영문·숫자·_ 일 때만 sed 식에 넣는다 — 다른 글자는 식을 깨뜨릴 수 있다).
    st=생략
    if [ "$ok" = 1 ]; then
      res="login ok"
      bg_wait_timeout "$GENIA_GH_LOGIN_TIMEOUT" gh_stored auth status --hostname "$host" >/dev/null 2>&1 </dev/null
      st=$?
    else
      res="login failed($try회) · git 도우미 토큰 파일"
      mask=$GH_TOKEN_MASK
      tokval=$(tr -d '\r\n ' < "$token")
      case "$tokval" in '' | *[!A-Za-z0-9_]*) ;; *) mask="$mask; s/$tokval/***/g" ;; esac
    fi
    {
      printf '%s github %s %s · ~/.config/gh %s · gh auth status %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$host" "$res" "$cfg" "$st"
      [ "$ok" = 1 ] || printf '%s\n' "$err" | sed -E "$mask; s/^/  /"
    } >> "$gitauth" 2>/dev/null || log "경고: gh 로그인 상태 파일($gitauth)에 쓰지 못했습니다"
    if [ "$ok" = 0 ]; then
      log "경고: GitHub 로그인 실패($host) — 토큰 권한(Contents·Pull requests)을 확인하세요: $(printf '%s' "$err" | head -n 1 | sed -E "$mask") — 전체: $gitauth"
      # 로그인 기록이 없어도 git push 가 되게 이 호스트에 GitLab 분기와 같은 호스트별 도우미를 건다 — git 이 물을 때 그때 토큰 파일을 읽어
      # 답하므로 설정에 토큰을 두지 않는다. 사용자 이름은 GitHub 토큰 규칙대로 x-access-token. 빈 값으로 먼저 지워 다른 도우미가 앞서 답하지 않게 한다.
      token_file_helper "$host" "$token" x-access-token || log "경고: GitHub 자격 증명 도우미를 걸지 못했습니다($host)"
      continue
    fi
    gh auth setup-git --hostname "$host" >/dev/null 2>&1 || log "경고: gh auth setup-git 실패($host) — git 이 GitHub 자격 증명을 쓰지 못할 수 있습니다"
  done
  for token in "$tokens"/gitlab/*; do
    [ -s "$token" ] || continue
    found=1
    host=$(basename "$token")
    # 사용자 이름은 GitLab 토큰 규칙대로 oauth2.
    token_file_helper "$host" "$token" oauth2 || log "경고: GitLab 자격 증명 도우미를 걸지 못했습니다($host)"
  done
  if [ "$gh_found" = 0 ]; then
    printf '%s github 토큰 없음\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$gitauth" 2>/dev/null
  fi
  rm -f "$errf"
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

# 7b. 저장소의 Playwright 버전 — 규칙(pnpm-lock.yaml 먼저, 없으면 package.json 고정 버전)은 플러그인의 gw_playwright_version 한 곳에 둔다(WP-1683):
#     브라우저 정리(browser-prune)가 「지키는 버전」을 같은 규칙으로 읽어야 받은 버전과 지키는 버전이 어긋나지 않는다. gw-lib 를 읽은 뒤 부른다.
playwright_version() {
  gw_playwright_version "$1"
}

# 7c. 그 버전의 브라우저가 다 받아져 있는지 — browsers_ready <playwright-core 폴더>. 그 core 의 browsers.json 이 있고, 그 chromium 과
#     chromium-headless-shell 의 브라우저 폴더(<이름의 - 를 _ 로>-<revision> — Playwright 의 폴더 이름 규칙)에 INSTALLATION_COMPLETE 가 있으면 0.
#     폴더가 베이스 이미지(/ms-playwright)로 건 심볼릭 링크여도 따라가 본다(seed_browsers). headless shell 도 보는 이유: 저장소 E2E 의 headless
#     실행(channel 지정 없음)은 chromium_headless_shell-<rev> 를 쓴다. Playwright 가 다 받은 폴더에만 INSTALLATION_COMPLETE 를 남기므로
#     반쯤 받다 끊긴 폴더는 「안 받음」으로 보고 다시 받는다.
#     chromium 은 늘 있어야 한다. chromium-headless-shell 은 Playwright 1.49 부터 browsers.json 에 있다 — 항목이 없는(1.48 이하) core 는
#     chromium 만 보고 「받음」으로 본다(아니면 받기 뒤에도 늘 실패로 보여 부팅마다 다시 받고 브라우저 정리도 건너뛴다).
browsers_ready() {
  local core=$1 n r
  [ -f "$core/browsers.json" ] || return 1
  for n in chromium chromium-headless-shell; do
    r=$(jq -r --arg n "$n" '.browsers[] | select(.name == $n) | .revision' "$core/browsers.json" 2>/dev/null)
    if [ -z "$r" ]; then
      [ "$n" = chromium ] && return 1
      continue
    fi
    [ -f "$BROWSERS_DIR/$(printf '%s' "$n" | tr - _)-$r/INSTALLATION_COMPLETE" ] || return 1
  done
  return 0
}

# 7d. 그 버전의 chromium — 저장소 Playwright 와 이미지 브라우저 버전이 달라 E2E 가 실패했다(PoC). 받았으면 0, 못 받았으면 경고 후 1.
#     예전에는 npx 로 받았는데, npx 캐시가 휘발 홈(~/.npm/_npx)에 있어 Pod 가 다시 뜰 때마다 Playwright 의 설치 기록(.links)이 가리키는 core 가
#     사라졌다(STALE) — Playwright GC 가 그 브라우저를 「안 쓰는 것」으로 보고, 옛 버전 브라우저가 PVC 에 그대로 쌓였다(WP-1683).
#     그래서 playwright-core 를 PVC 의 고정 폴더(<브라우저 폴더>/.genia-installs/<버전>)에 npm 으로 받고 그 cli.js 로 브라우저를 받는다 — 기록이
#     PVC 경로를 가리켜 재시작해도 살아 있다. 받을 때는 Playwright 의 GC 를 끈다(PLAYWRIGHT_SKIP_BROWSER_GC) — 지우기는 모든 버전을 다 받은 뒤
#     browser-prune 하나가 한다(받는 도중 다른 버전의 GC 가 서로의 브라우저를 지우지 않게). 옛 받기 표시(.genia-chromium-*)는 쓰지 않는다.
ensure_playwright() {
  local v=$1 prefix core
  prefix="$BROWSERS_DIR/.genia-installs/$v"
  core="$prefix/node_modules/playwright-core"
  browsers_ready "$core" && return 0
  mkdir -p "$prefix"
  if (cd "$GENIA_WORK/tmp" && npm install --prefix "$prefix" --no-audit --no-fund --loglevel=error "playwright-core@$v") >&2 </dev/null; then
    PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_DIR" PLAYWRIGHT_SKIP_BROWSER_GC=1 node "$core/cli.js" install chromium >&2 </dev/null
  fi
  browsers_ready "$core" && return 0
  log "경고: Playwright $v 의 chromium 을 받지 못했습니다 — E2E 가 실패할 수 있습니다"
  return 1
}

# 7e. 안 쓰는 브라우저 정리(WP-1683) — 플러그인의 browser-prune(Pod 모드)을 브라우저 폴더와 AI 홈(/work/agents — 그 아래 모든 저장소의 버전을
#     지킨다)으로 부른다. 결과·경고 줄은 「브라우저 정리: …」 로그로 남긴다. 옛 플러그인에 browser-prune 이 없거나 정리가 실패·건너뛰어도
#     경고만 남기고 0 — 정리가 칸 띄우기를 막지 않는다. 오래 걸리면(큰 폴더 rm) 5분에 끊고, SIGTERM 은 bg_wait_timeout 으로 바로 받는다.
#     start_projects 가 부팅 임시 폴더(BOOT_DIR)를 지우기 전에 부른다(출력을 거기 받는다).
prune_browsers() {
  local out="$BOOT_DIR/prune.out" line
  if [ ! -x "${GW_SCRIPTS:-}/browser-prune" ]; then
    log "경고: 이 플러그인 버전에는 browser-prune 이 없습니다 — 안 쓰는 브라우저를 지우지 않습니다"
    return 0
  fi
  bg_wait_timeout 300 "$GW_SCRIPTS/browser-prune" --dir "$BROWSERS_DIR" "$AI_HOME" > "$out" 2>&1 </dev/null
  while IFS= read -r line; do
    [ -n "$line" ] && log "브라우저 정리: $line"
  done < "$out"
  return 0
}

# 7a. 끝난 이슈의 워크트리 정리(WP-1683) — 플러그인의 agent-sweep 을 AI 폴더로 한 번 부른다. 그 AI 의 모든 저장소(repos/*)를 보고
#     서버에 이슈 상태를 물어 DONE·CANCELED 인 것의 워크트리·브랜치·실행 상태 파일만 지운다. 칸 없는 프로젝트(소속에서 빠진 것 포함)의
#     워크트리는 칸의 work-loop(2-1)가 보지 않아 여기서만 정리된다.
#     칸을 띄우기 전(start_projects 맨 앞)에 한다 — 같은 MAIN 에서 work-loop·agent-project repo 의 fetch 와 겹치지 않게.
#     한 Pod 에 한 번(WORKTREES_SWEPT — run_supervisor 가 비우지 않는다): start_projects 가 실패해 다음 회차에 다시 불려도 다시 돌지 않는다.
#     서버에 닿지 못해 남긴 것은 칸의 work-loop 2-1 이 맡는다. 결과 줄은 $AI_DIR/state/boot-sweep.log 에 두고 「워크트리 정리: …」 로그로 남긴다.
#     옛 플러그인에 agent-sweep 이 없거나 실패·시간 초과(GENIA_SWEEP_TIMEOUT, 기본 600초)여도 경고·로그만 남기고 0 — 칸 띄우기를 막지 않는다.
#     오래 걸릴 수 있어(fetch·워크트리 지우기) bg_wait_timeout 으로 돌려 SIGTERM 을 바로 받는다.
sweep_worktrees() {
  local out="$AI_DIR/state/boot-sweep.log" line
  [ "${WORKTREES_SWEPT:-0}" = 1 ] && return 0
  WORKTREES_SWEPT=1
  if [ ! -x "${GW_SCRIPTS:-}/agent-sweep" ]; then
    log "경고: 이 플러그인 버전에는 agent-sweep 이 없습니다 — 끝난 이슈의 워크트리를 부팅 때 지우지 않습니다"
    return 0
  fi
  mkdir -p "$AI_DIR/state"
  bg_wait_timeout "${GENIA_SWEEP_TIMEOUT:-600}" "$GW_SCRIPTS/agent-sweep" "$AI_DIR" > "$out" 2>&1 </dev/null ||
    log "경고: 워크트리 정리가 끝까지 돌지 못했습니다 — 남은 것은 칸의 work-loop 가 정리합니다"
  while IFS= read -r line; do
    [ -n "$line" ] && log "워크트리 정리: $line"
  done < "$out"
  return 0
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

# pid 들과 그 자손 전부를 끈다(WP-1267) — 뒤에서 도는 일(agent-project → git clone·npm)은 손자 프로세스가 실제 일을 하므로 서브셸만 끄면
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

# 뒤에서 명령 하나를 돌리되 <초> 안에 끝나지 않으면 자손까지 끈다 — bg_wait_timeout <초> <명령…>. 명령의 종료 코드를 돌려준다(제한을 넘겨 끈 것은
# 128 이상). 감독 회차가 밖으로 못 나가는 명령에 멈추지 않게 한다. 맥(테스트)에는 timeout 이 없어 지킴이(sleep 뒤 kill_tree)로 끊는다.
# bg_wait 처럼 wait 로 기다려 SIGTERM 을 바로 받고, 명령과 지킴이 pid 를 둘 다 BG_PIDS 에 넣어 종료 신호 때 abort_boot 가 함께 끈다(지킴이가
# 남으면 나중에 다른 프로세스가 물려받은 pid 를 끌 수 있다). 끝나면 지킴이를 거두고 둘 다 BG_PIDS 에서 뺀다.
# 리다이렉트는 부르는 쪽이 이 함수에 건다(명령이 물려받는다). 명령 치환($(…)) 안에서 부르면 SIGTERM 즉시 처리 효과가 없다(bg_wait 와 같다).
bg_wait_timeout() {
  local secs=$1 pid dog rc
  shift
  "$@" &
  pid=$!
  BG_PIDS="${BG_PIDS:-} $pid"
  (sleep "$secs" && kill_tree "$pid") >/dev/null 2>&1 </dev/null &
  dog=$!
  BG_PIDS="$BG_PIDS $dog"
  wait "$pid"
  rc=$?
  kill_tree "$dog"
  # shellcheck disable=SC2086 # pid 들은 숫자 단어다 — 한 줄에 하나로 나눠 자기 것만 뺀다.
  BG_PIDS=$(printf '%s\n' ${BG_PIDS:-} | grep -vx -e "$pid" -e "$dog" | tr '\n' ' ')
  return $rc
}

# 설정 파일(config.toml·opencode.json)에 넣어도 되는 모델 id 인지 — 서버의 모델 id 꼴(ModelIds·AgentTemplateRegistry MODEL_ID)과 같은
# 글자만, 128자까지. 따옴표·역슬래시·개행이 들어오면 TOML 이 깨지거나 다른 키가 끼어들 수 있고, 엉뚱한 값이 도구·명령줄로 흘러가지 않게 막는다.
# Codex·OpenCode 이미지가 함께 쓴다.
safe_model_id() {
  case "$1" in '' | *[!A-Za-z0-9._:/@\[\]-]*) return 1 ;; esac
  [ ${#1} -le 128 ]
}

# 로그인 정보 시딩(계약 「로그인 정보」 — Gen:iA Code·Codex 이미지가 쓴다) — seed_login_file <보관본 경로> <이름(로그용)>.
#   마운트 파일($GENIA_RUN_DIR/login-info)이 없거나 비었으면 보관본·표식($AI_DIR/state/login-version)을 지운다(연결 끊기가 실제로 끊기게).
#   표식이 GENIA_LOGIN_VERSION 과 다르면(없음 포함) 600 으로 원자적으로 복사하고 표식을 적는다. 같으면 그대로 — 프로그램이 스스로 갱신해(토큰
#   새로고침) 다시 쓴 로그인을 옛 Secret 값으로 덮지 않는다. 쓰기는 gw-lib 의 gw_write_atomic(임시 파일 → 600 → mv) — 내용은 셸 내장 printf
#   로만 쓰여 외부 명령 인자·로그에 실리지 않는다. 결과로 로그인이 없으면 경고 한 줄(칸은 띄우지 않는다 — 각 이미지의 can_launch)이며,
#   그 메시지는 pane_blocked 로 남아 감독 회차(tick)가 서버에 차단 사유를 보고한다(WP-1913). 늘 0.
seed_login_file() {
  local src="$GENIA_RUN_DIR/login-info" dst=$1 label=$2 mark="$AI_DIR/state/login-version"
  if [ ! -s "$src" ]; then
    rm -f "$dst" "$mark"
  elif [ "$(cat "$mark" 2>/dev/null)" != "${GENIA_LOGIN_VERSION:-}" ] || [ ! -s "$dst" ] || [ ! -f "$mark" ]; then
    gw_write_atomic "$dst" "$(cat "$src")" && gw_write_atomic "$mark" "${GENIA_LOGIN_VERSION:-}" ||
      log "경고: $label 로그인 정보를 $(dirname "$dst") 에 두지 못했습니다"
  fi
  login_file_ready "$dst" || pane_blocked "경고: $label 로그인 정보가 연결되지 않았습니다 — 관리 화면에서 연결하세요(연결 전에는 칸을 띄우지 않습니다)"
  return 0
}

# 로그인 보관본이 심겼는지 — login_file_ready <보관본 경로>.
login_file_ready() { [ -s "$1" ]; }

# 7. 프로젝트 — start-agent 4~6번을 사람 대신. 대기열 라벨·홈 기억 → 저장소마다 받기 → 신뢰 → Playwright → 칸.
#    저장소 받기·브라우저 받기는 프로젝트별로 동시에 돈다(WP-1267).
#    BOOT_KEYS 에 띄운 키를 모은다(감독이 살핀다). 프로젝트 목록을 못 읽으면 1(감독이 다음 회차에 다시 한다).
#    알림 감시 창은 부르는 쪽이 칸을 다 띄운 뒤 한 번 챙긴다(ensure_events).
start_projects() {
  # 끝난 이슈의 워크트리를 칸을 띄우기 전에 한 번 지운다(WP-1683 — 한 Pod 에 한 번, 실패해도 계속).
  sweep_worktrees
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
    [ "$(cat "$BOOT_DIR/$key.rc" 2>/dev/null)" = 0 ] && ok_list="$ok_list $key"
    # 브라우저 버전은 칸을 띄울 저장소만이 아니라 폴더가 있는 모든 저장소에서 모은다(WP-1683) — 이번에 받기가 실패(fetch·url-changed·busy)한
    # 저장소도 work-loop 가 그 폴더로 E2E 를 돌릴 수 있어, 그 버전을 빼면 아래 정리가 쓰는 브라우저를 지운다.
    if [ -d "$AI_DIR/repos/$key" ] && v=$(playwright_version "$AI_DIR/repos/$key"); then
      case "$pw_versions" in *" $v "*) ;; *) pw_versions="$pw_versions$v " ;; esac
    fi
  done <<LIST_EOF
$list
LIST_EOF
  # 버전마다 받기를 함께 돌리고, 각 결과(종료 코드)를 BOOT_DIR 의 pw-<버전>.rc 에 남긴다(백그라운드 일의 종료 코드를 모으려고).
  BG_PIDS=""
  for v in $pw_versions; do
    (
      ensure_playwright "$v"
      printf '%s' $? > "$BOOT_DIR/pw-$v.rc"
    ) &
    BG_PIDS="$BG_PIDS $!"
  done
  # shellcheck disable=SC2086
  [ -z "$BG_PIDS" ] || wait $BG_PIDS
  BG_PIDS=""
  # 모든 버전을 받았을 때만 안 쓰는 브라우저를 지운다 — 하나라도 실패하면 그 버전 대신 E2E 가 쓸 수 있는 옛 브라우저를 남긴다
  # (다음 부팅에서 다시 받고 그때 정리한다). rc 파일이 없으면(받기가 끊김) 실패로 본다.
  pw_ok=1
  for v in $pw_versions; do
    [ "$(cat "$BOOT_DIR/pw-$v.rc" 2>/dev/null)" = 0 ] || pw_ok=0
  done
  if [ "$pw_ok" = 1 ]; then
    prune_browsers
  else
    log "경고: 브라우저 받기에 실패한 버전이 있어 이번에는 브라우저를 정리하지 않습니다"
  fi
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

# 감독 한 회차(Gen:iA Code·Codex·OpenCode 엔트리포인트 — 부팅 첫 회차 포함) — 이미지 훅 before_supervise(Gen:iA: 프로그램 받기, Codex: 모델 목록 보고)를
# 돈 뒤, 칸을 띄울 수 있으면(이미지의 can_launch — 로그인 등) supervise_once(처음이면 start_projects, 그 뒤 칸 살피기·알림 감시 창). 못 띄우면
# 칸 일은 하지 않고 차단 사유(pane_blocked 가 남긴 상태 파일)만 서버에 보고한다(pane_report_blocked). 띄울 수 있든 없든 tmp 정리(sweep_tmp_due —
# 한 시간에 한 번)는 부른다(WP-1683) — 로그인을 오래 기다리는 Pod 도 tmp 가 찬다. 회차 번호를 $AI_DIR/state/supervise-ticks 에 적는다 —
# 감독이 도는지 밖에서(테스트·kubectl exec) 볼 수 있게.
# 두 훅의 기본은 「할 일 없음」·「띄울 수 있음」이고 이미지가 trust_folders 처럼 덮어쓴다. 늘 0.
before_supervise() { return 0; }
can_launch() { return 0; }

# 칸을 띄우지 못한 이유(WP-1913) — 로그 한 줄을 남기고 같은 메시지를 상태 파일에 덮어쓴다.
# 감독 회차(tick)가 이 파일을 읽어 서버에 보고한다 — 파일이 없으면 보고도 없다(일시 차단은 오류로 뜨지 않는다).
pane_blocked() {
  log "$1"
  mkdir -p "$AI_DIR/state" && printf '%s\n' "$1" > "$AI_DIR/state/pane-blocked"
}

# can_launch 를 막힌 회차의 차단 사유를 이번 회차의 까닭으로 다시 판정한다(WP-1913 리뷰 반려 ②) — tick 이 막힌 자리에서만 부른다.
# 지난 사유 파일이 그대로 보내지면, can_launch 를 막는 까닭이 바뀐 뒤(로그인을 고치는 사이 genia 를 받지 못하는 등) 화면에 틀린 사유가 남고,
# 사유를 새로 만들지 못하는 이미지는 오류가 아예 안 뜬다. 기본은 할 일 없음이고(claude-code 는 can_launch 가 늘 참이라 이 자리에 오지 않는다)
# 이미지가 덮어써 이번 회차의 실패 경로가 다시 쓰게 한다. 늘 0.
pane_blocked_reason() { return 0; }

# gw-boot ok 보고 — (a) 차단 없이 띄우는 부팅의 첫 회차에 한 번(표식 $AI_DIR/state/pane-boot-ok-sent), 그리고 (b) 차단 사유 파일이 아직 남아 있는
# 성공 회차에는 표식과 무관하게 또 보고해 서버의 FAILED 표시를 지운다(막혔다 다시 띄우는 경우 — 표식만으로 짧으면 서버가 차단 사유에 갇힌다).
# 신원은 GENIA_WORKS_AS 로 넘긴다 — 엔트리포인트 셸에는 칸처럼 신원이 없다(lib-codex.sh 의 gw-models 보고와 같은 방식).
# 성공 판정은 gw-boot 의 종료 코드다(0 성공·1 실패 — WP-1913 리뷰 반려 ③). 「출력 없음 = 성공」으로는 표준 오류에 실린 무해한 경고까지 실패로
# 봐서, 서버가 204 로 받아도 회차가 헛나가 서버의 오류 표시가 계속 남았다. 실패면 표식도 차단 파일도 건드리지 않고 뒤로 미룬다 — 다음 회차가
# 다시 보고한다(pane_report_blocked 와 같은 재시도). gw-boot 없음·보고 실패에도 tick 은 늘 0 이라 감독은 멈추지 않는다 — 진입점은 끝내지 않는다).
pane_report_ok_once() {
  local gw="$GW_SCRIPTS/gw-boot" mark="$AI_DIR/state/pane-boot-ok-sent" blocked="$AI_DIR/state/pane-blocked" out rc=0
  [ -x "$gw" ] || return 0
  # 차단 파일도 표식도 없으면 이미 보고한 정상 상태 — 매 회차 중복 ok 를 보내지 않는다(표식의 본래 뜻).
  if [ ! -f "$blocked" ] && [ -e "$mark" ]; then
    return 0
  fi
  out=$(GENIA_WORKS_AS="$GENIA_AGENT_NAME" "$gw" ok 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    # 실패 한 줄을 진입점 로그로 남긴다 — 표식·차단 파일은 그대로 두어 다음 회차에 다시 보게 한다.
    [ -n "$out" ] && log "$out"
    return 0
  fi
  # 보고 성공 — 정상으로 띄웠으니 지난 차단 사유는 남기지 않는다(서버 표시와 로컬 상태를 함께 지운다). 표준 오류에 무해한 경고가 실려도
  # 성공은 성공이다(판정은 종료 코드 — gw-boot 가 서버 응답으로 이미 정한 값). 그 경고 한 줄은 로그로만 남긴다.
  [ -n "$out" ] && log "$out"
  rm -f "$blocked"
  mkdir -p "$AI_DIR/state" && printf '%s\n' "$(date +%s)" > "$mark" 2>/dev/null
  return 0
}

# 차단 사유(pane_blocked 가 남긴 상태 파일)가 있으면 매 감독 회차 gw-boot blocked 로 서버에 보고한다 — 파일이 없으면 조용히 건너뛴다.
# 보고는 최선 노력: gw-boot 없음·실패에도 늘 0 이라 감독은 멈추지 않는다. 같은 사유라도 매 회차 다시 보고한다(서버 표시가 오래돼도 최신 상태로 맞춘다).
pane_report_blocked() {
  local gw="$GW_SCRIPTS/gw-boot" blocked="$AI_DIR/state/pane-blocked" msg
  [ -x "$gw" ] || return 0
  [ -f "$blocked" ] || return 0
  msg=$(cat "$blocked")
  GENIA_WORKS_AS="$GENIA_AGENT_NAME" "$gw" blocked "$msg" >/dev/null || true
  return 0
}

SUPERVISE_TICKS=0
tick() {
  SUPERVISE_TICKS=$((SUPERVISE_TICKS + 1))
  before_supervise
  if can_launch; then
    supervise_once
    pane_report_ok_once # 첫 정상 회차·차단 해제 회차에 gw-boot ok — 서버의 차단 표시를 지운다(실패하면 다음 회차 재시도)
  else
    pane_blocked_reason # 이번 회차의 까닭으로 다시 판정하고(WP-1913 리뷰 반려 ②) 그 상태 파일을 서버에 보고한다
    pane_report_blocked # 상태 파일이 있을 때만 매 회차 gw-boot blocked
  fi
  sweep_tmp_due
  printf '%s\n' "$SUPERVISE_TICKS" > "$AI_DIR/state/supervise-ticks" 2>/dev/null
  return 0
}

# SIGTERM·SIGINT 처리(모든 엔트리포인트 공용) — 칸들을 정리하고 0 으로 끝낸다. 0 이 아니면 kubelet 이 실패로 본다.
# 감독의 sleep 을 먼저 끄고(SLEEP_PID — supervise_nap 이 적는다), start_projects 가 저장소·브라우저를 받는 중이었거나(Codex: 모델 목록을
# 묻는 중이었거나) 하면 그 일들을 자손(git·npm 등)까지 끄고 임시 폴더를 치운다(abort_boot) — 남기면 정리 뒤에도 clone 이 이어진다.
# 끝에서 exit 하므로 trap 이 끊은 wait 로 감독 루프가 돌아가지 않는다.
SLEEP_PID=""
on_term() {
  trap - TERM INT
  [ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null
  abort_boot
  log "종료 신호 — 칸들을 정리합니다"
  stop_all
  exit 0
}

# 종료 신호 trap 을 건다 — 엔트리포인트가 lib 를 읽은 바로 뒤(부팅 단계 앞)에서 부른다. 부팅 도중(start_projects 전·중)에 온 신호도
# 같은 on_term 으로 정리하고 0 으로 끝내게 하려는 것이다(감독 루프 안에서 걸면 부팅 동안은 기본 동작으로 죽는다).
install_term_trap() {
  trap on_term TERM INT
}

# 감독 한 회차 쉬기 — sleep 을 뒤에서 돌리고 wait 로 기다린다. 앞쪽 sleep 동안에는 trap 이 돌지 않아 SIGTERM 을 바로 받지 못하기 때문이다.
# 쉬는 sleep 의 pid 를 SLEEP_PID 에 적어 on_term 이 끄게 한다.
supervise_nap() {
  sleep "$GENIA_SUPERVISE_INTERVAL" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
  SLEEP_PID=""
}

# 감독 루프(모든 엔트리포인트 공용) — run_supervisor <tick|boot>. 돌아오지 않는다(끝은 on_term 의 exit).
#   tick(Gen:iA Code·Codex·OpenCode): 부팅 첫 회차부터 tick 하나로 — 회차마다 tick(이미지 훅 → 띄울 수 있으면 supervise_once) 뒤 쉰다.
#   boot(Claude Code): 부팅 때 start_projects 를 한 번 부르고 알림 감시 창을 챙긴 뒤, 쉬고 나서 supervise_once 와 tmp 정리(sweep_tmp_due)를
#     회차마다 부른다.
#     첫 supervise_once 전에 쉬는 것이 tick 과 다르다 — 부팅 직후 agent-window 를 한 번 더 부르지 않게(옛 동작 그대로).
# PROJECTS_READY·BOOT_KEYS 는 start_projects·supervise_once 가 읽고 쓰는 전역이라 local 로 두지 않는다.
run_supervisor() {
  PROJECTS_READY=0
  BOOT_KEYS=""
  case "$1" in
    tick)
      while :; do
        tick
        supervise_nap
      done
      ;;
    boot)
      start_projects && PROJECTS_READY=1
      ensure_events
      while :; do
        supervise_nap
        supervise_once
        sweep_tmp_due
      done
      ;;
    *) die "run_supervisor: 알 수 없는 감독 모드입니다 — $1" ;;
  esac
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
