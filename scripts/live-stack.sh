#!/usr/bin/env sh
# 격리 라이브 스택(DB·API·웹) 띄우기/내리기 — work-loop 의 브랜치 라이브 검증용 (WP-376).
#
#   scripts/live-stack.sh up [<워크트리 경로>]   # 기본: 지금 git 작업 폴더
#   scripts/live-stack.sh down
#   scripts/live-stack.sh status
#   LIVE_STACK_NAME=work-loop scripts/live-stack.sh up …   # 스택 이름(기본 default). work-loop 는 늘 work-loop 를 쓴다
#
# 왜 따로 두나:
# - 6060(API)/6173(웹)/5434(DB)/6090(MCP) 등은 같은 머신의 다른 세션이 쓰는 포트다. 거기 붙거나
#   그 프로세스를 죽이면 남의 작업이 깨진다. 그래서 빈 포트를 새로 고르고(pick_port), 새 DB 컨테이너를 띄운다.
# - 내린 때 남의 프로세스를 건드리지 않도록, 띄운 것(pid·컨테이너·포트·계정)을 상태 파일에 적고
#   down 은 그 파일에 적힌 것만 내린다.
# - 상태 파일은 MAIN(main 작업 폴더)/.work-loop/state/live-stack-<이름>.env — 어느 워크트리에서 불러도 같은 파일이다.
#   (MAIN = git rev-parse --git-common-dir 의 부모. work-loop 스킬과 같은 기준)
# - 이름(LIVE_STACK_NAME)마다 상태 파일·로그가 따로라, 사람이 띄운 스택(default)과 work-loop 의 스택(work-loop)이
#   서로 겹쳐 띄우기를 막거나 서로를 내리지 않는다. up·status·down 은 그 이름의 스택만 다룬다.
# - 모든 포트는 127.0.0.1 에만 연다 — DB 계정이 app/app 이고 API 는 개발 프로필이라 다른 기기에서 닿으면 안 된다.
#
# 시험: scripts/live-stack.test.sh 가 LIVE_STACK_LIB=1 로 이 파일을 읽어 pick_port·valid_stack_name·state_put/state_get 을 확인한다.

# ---------------------------------------------------------------------------
# 포트 고르기
# ---------------------------------------------------------------------------

# 다른 세션(사람의 pnpm dev 스택)이 쓰는 포트 — 비어 있어도 절대 고르지 않는다.
# API 6060 · ai-agent 6070 · worker 6080 · MCP 6090 · collab 6095 · 웹 6173 · admin 6174 · dev DB 5434
LIVE_STACK_FORBIDDEN_PORTS="6060 6070 6080 6090 6095 6173 6174 5434"

# 포트를 누가 듣고 있는지 lsof 로만 본다.
# nc -z 같은 접속 확인은 듣는 쪽(예: 시험의 nc -l)을 끊어 버리므로 쓰지 않는다.
# Podman/Colima 가 공개한 컨테이너 포트도 호스트의 gvproxy 등이 듣고 있어 lsof 에 잡힌다.
port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# 금지 포트인지
port_forbidden() {
  case " $LIVE_STACK_FORBIDDEN_PORTS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

# 후보부터 1씩 올리며 쓰는 중도 아니고 금지 포트도 아닌 첫 포트를 출력한다.
# 금지 포트는 시작 후보든 올려 가다 만난 것이든 모두 건너뛴다. 100개 안에서 못 찾으면 실패.
pick_port() {
  _p=$1
  _n=0
  while [ "$_n" -lt 100 ]; do
    if ! port_forbidden "$_p" && ! port_in_use "$_p"; then
      echo "$_p"
      return 0
    fi
    _p=$((_p + 1))
    _n=$((_n + 1))
  done
  echo "빈 포트를 찾지 못했다(후보 $1 부터 100개)" >&2
  return 1
}

# ---------------------------------------------------------------------------
# 공통
# ---------------------------------------------------------------------------

log() { echo "[live-stack] $*"; }
die() {
  echo "[live-stack] 오류: $*" >&2
  exit 1
}

# MAIN(main 작업 폴더) — 워크트리 안에서도 같은 값. 상태 파일·.env 는 여기 있다.
main_dir() {
  _common=$(git -C "${1:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  dirname "$_common"
}

# 스택 이름 확인 — 상태·로그 파일 이름에 그대로 들어가므로 영문·숫자·_·- 만 받는다(경로 조각·셸 글자 차단).
valid_stack_name() {
  case "$1" in
    "" | *[!A-Za-z0-9_-]*) return 1 ;;
  esac
  return 0
}

# 셸 작은따옴표로 감싼다(값 안의 ' 는 '\'' 로). 상태 파일을 사람이 `. ` 로 읽어도 경로의 공백·$·` 가 펼쳐지거나 실행되지 않게.
sh_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# 상태 파일에 한 줄 더한다 — 띄우는 즉시 적어 두어, 중간에 실패해도 down 이 그만큼 내릴 수 있게 한다.
state_put() {
  # echo 는 macOS /bin/sh 에서 값 안의 \ 를 풀어 버리므로 printf 로 쓴다.
  printf '%s=%s\n' "$1" "$(sh_quote "$2")" >>"$STATE_FILE"
}

# 상태 파일에서 KEY 의 값을 읽는다 — 파일을 source 하지 않고 그 줄만 골라 따옴표를 벗긴다(sh_quote 의 역).
state_get() {
  sed -n "s/^$1=//p" "$STATE_FILE" | tail -n 1 | sed "s/^'//; s/'\$//; s/'\\\\''/'/g"
}

# 조건이 맞을 때까지 기다린다. $1 = 최대 초, 나머지 = 확인 명령. (GNU timeout 이 없어 직접 센다)
wait_until() {
  _max=$1
  shift
  _t=0
  while ! "$@" >/dev/null 2>&1; do
    _t=$((_t + 1))
    [ "$_t" -ge "$_max" ] && return 1
    sleep 1
  done
  return 0
}

# pid 가 살아 있고 명령줄에 기대한 글자가 들어 있는지 — pid 가 다른 프로세스에 재사용됐으면 건드리지 않기 위함.
pid_matches() {
  _cmd=$(ps -p "$1" -o command= 2>/dev/null) || return 1
  case "$_cmd" in
    *"$2"*) return 0 ;;
  esac
  return 1
}

# pid 와 그 자손을 끝낸다(pnpm·sh 래퍼가 자식 node 를 띄우는 경우 대비).
kill_tree() {
  for _c in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "$_c"
  done
  kill "$1" 2>/dev/null || true
}

# stop_pid <이름> <pid> <명령줄 글자> — 명령줄이 이 스택의 것일 때만 끝낸다(pid 재사용으로 남의 java/vite 를 죽이지 않게).
# pid 가 비었으면 아무것도 하지 않는다. 살아 있지만 남의 것이면 알리기만 한다.
stop_pid() {
  [ -n "$2" ] || return 0
  if pid_matches "$2" "$3"; then
    log "$1 종료(pid $2)"
    kill_tree "$2"
  elif ps -p "$2" >/dev/null 2>&1; then
    echo "[live-stack] 경고: pid $2 는 이 스택의 $1 프로세스가 아니라 종료하지 않는다" >&2
  fi
}

# ---------------------------------------------------------------------------
# 확인 명령(wait_until 용)
# ---------------------------------------------------------------------------

# 컨테이너 안에서 TCP(-h 127.0.0.1)로 물어본다. -h 없이 유닉스 소켓으로 물으면 이미지 초기화 중의
# 임시 서버에도 준비됨으로 답해, 그 직후 재시작 사이에 Flyway 가 실패할 수 있다.
db_ready() {
  docker exec "$DB_CONTAINER" pg_isready -h 127.0.0.1 -U app -d workplace
}

api_up() {
  curl -fsS "http://localhost:$API_PORT/actuator/health" | grep -q '"status":"UP"'
}

web_200() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB_PORT/")" = "200" ]
}

# ---------------------------------------------------------------------------
# up
# ---------------------------------------------------------------------------

# up 도중 실패하면 지금까지 띄운 것을 내리고 로그 끝을 보여 준다.
on_up_fail() {
  _code=$?
  trap - EXIT
  [ "$_code" -eq 0 ] && return 0
  echo "[live-stack] up 실패 — 띄운 것을 내린다" >&2
  for _f in "$API_LOG" "$WEB_LOG"; do
    if [ -f "$_f" ]; then
      echo "--- $_f (끝 40줄)" >&2
      tail -n 40 "$_f" >&2
    fi
  done
  cmd_down
  exit "$_code"
}

cmd_up() {
  TARGET=$(cd "${1:-.}" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) ||
    die "git 작업 폴더가 아니다: ${1:-.}"
  [ -d "$TARGET/apps/workplace-api" ] && [ -d "$TARGET/apps/workplace-web" ] ||
    die "이 저장소 구조가 아니다(apps/workplace-api·web 없음): $TARGET"

  # 같은 이름으로 이미 띄운 스택이 있으면 겹쳐 띄우지 않는다(이름마다 상태 파일이 하나라 덮으면 내릴 수 없게 된다).
  if [ -f "$STATE_FILE" ]; then
    die "이름 '$LIVE_STACK_NAME' 으로 이미 띄운 스택이 있다($STATE_FILE). 먼저 'LIVE_STACK_NAME=$LIVE_STACK_NAME $0 down' 하라"
  fi
  mkdir -p "$STATE_DIR"
  # 지난 실행의 로그는 지운다 — 남겨 두면 실패 때 보여 주는 로그 끝이 이번 실행 것이 아닐 수 있다.
  # (down 은 로그를 남겨 둔다 — 내린 뒤에도 원인을 볼 수 있게)
  rm -f "$API_LOG" "$WEB_LOG" "$SIGNUP_JSON"
  : >"$STATE_FILE"
  chmod 600 "$STATE_FILE"
  trap on_up_fail EXIT

  # 1) 포트 — 후보 대역(API 6160~·웹 6273~·DB 5444~)이 서로 떨어져 있어 셋이 겹치지 않는다.
  API_PORT=$(pick_port 6160) || exit 1
  WEB_PORT=$(pick_port 6273) || exit 1
  DB_PORT=$(pick_port 5444) || exit 1
  DB_CONTAINER="wl-$$-db"
  state_put TARGET "$TARGET"
  state_put API_PORT "$API_PORT"
  state_put WEB_PORT "$WEB_PORT"
  state_put DB_PORT "$DB_PORT"
  log "스택 '$LIVE_STACK_NAME' · 대상 $TARGET — API $API_PORT · 웹 $WEB_PORT · DB $DB_PORT"

  # 2) DB 컨테이너 — 매번 빈 DB 로 시작한다(첫 signup 이 ADMIN 이 되려면 비어 있어야 한다).
  #    만들어졌지만 기동에 실패한 컨테이너도 down 이 지우도록 docker run 전에 이름을 적는다.
  #    docker run -d 는 컨테이너를 띄우고 바로 돌아온다 — DB 초기화는 아래 빌드와 함께 진행되고, 준비 대기는 API 를 띄우기 직전에 한다.
  state_put DB_CONTAINER "$DB_CONTAINER"
  docker run -d --name "$DB_CONTAINER" \
    -e POSTGRES_DB=workplace -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app \
    -p "127.0.0.1:$DB_PORT:5432" pgvector/pgvector:pg18 >/dev/null || die "DB 컨테이너를 띄우지 못했다"

  # 3) 웹이 쓰는 공유 패키지 빌드 — dist 는 git 무시라 새 워크트리에는 없다.
  if [ ! -f "$TARGET/packages/mcp-tools-shared/dist/index.js" ]; then
    log "mcp-tools-shared 빌드(dist 없음)"
    (cd "$TARGET" && pnpm --filter @smart-workplace/mcp-tools-shared build) >/dev/null ||
      die "mcp-tools-shared 빌드 실패"
  fi

  # 4) API — 웹과 같은 커밋(대상 워크트리)에서 jar 를 만든다. 웹보다 낡은 API 는 로그인 새로고침 반복을 낸다.
  log "API bootJar 빌드"
  (cd "$TARGET/apps/workplace-api" && ./gradlew bootJar -x test -q) || die "bootJar 빌드 실패"
  JAR=$(ls "$TARGET"/apps/workplace-api/build/libs/*.jar 2>/dev/null | grep -v -- '-plain\.jar$' | head -n 1)
  [ -n "$JAR" ] || die "boot jar 를 찾지 못했다(build/libs)"

  # API 는 뜨자마자 Flyway 로 DB 에 붙으므로 여기서 DB 준비를 기다린다(빌드 동안 대부분 끝나 있다).
  log "DB 컨테이너 $DB_CONTAINER — 준비 대기"
  wait_until 60 db_ready || die "DB 가 60초 안에 준비되지 않았다"

  # .env(MAIN, git 무시, 비밀값)는 java 를 띄우는 하위 셸 안에서만 읽는다. 내용은 출력하지 않는다(set -x 금지).
  # 개발자 .env 에는 옛 예시에서 온 WEB_PORT·CORS 값 등이 남아 있을 수 있어, 읽은 뒤에 $WEB_PORT 를 펼치면 고른 포트가 .env 값으로
  # 바뀐다(실측: CORS 가 localhost:10000 이 돼 로그인 403). 그래서 인자를 .env 를 읽기 **전에** 위치 인자로 굳혀 둔다.
  # CORS 오버라이드가 없으면 브라우저 로그인이 403 이다(local 프로필은 6173 만 허용).
  # 공개 기준 주소도 이 웹으로 — 드라이브 전송 링크 등이 남의 6173 을 가리키지 않게 한다.
  # ai-agent·worker·collab 연동은 끈다 — local 프로필은 6070/6080/6095(다른 세션의 서비스)를 가리켜, 켜 두면
  # 이 격리 API 가 남의 서비스에 일을 시키고 그쪽은 자기 API(6060)로 콜백한다. 끄면 해당 기능만 비활성으로 응답한다.
  ENV_FILE="$MAIN/.env"
  log "API 기동(:$API_PORT)"
  (
    cd "$TARGET/apps/workplace-api" || exit 1
    set -- -jar "$JAR" \
      --spring.profiles.active=local \
      "--server.port=$API_PORT" \
      --server.address=127.0.0.1 \
      "--spring.datasource.url=jdbc:postgresql://127.0.0.1:$DB_PORT/workplace" \
      "--spring.flyway.url=jdbc:postgresql://127.0.0.1:$DB_PORT/workplace" \
      "--app.cors.allowed-origins=http://localhost:$WEB_PORT" \
      "--workplace.public-base-url=http://localhost:$WEB_PORT" \
      --workplace.ai-agent.enabled=false \
      --workplace.worker.enabled=false \
      --workplace.collab.enabled=false
    if [ -f "$ENV_FILE" ]; then
      set -a
      . "$ENV_FILE"
      set +a
    fi
    exec nohup java "$@"
  ) >"$API_LOG" 2>&1 </dev/null &
  API_PID=$!
  state_put API_PID "$API_PID"

  # 5) 웹 — vite 실행 파일을 exec 로 바로 띄워 기록한 pid 가 실제로 포트를 듣는 프로세스가 되게 한다
  #    (pnpm exec 를 거치면 pnpm 이 자식 node 를 띄워, pnpm pid 만 끝내면 vite 가 남는다).
  log "웹 기동(:$WEB_PORT → API :$API_PORT, collab 끊음)"
  (
    cd "$TARGET/apps/workplace-web" || exit 1
    # 노트 동시 편집 ws 는 닫힌 포트(9)로 보낸다 — 기본값 6095 는 다른 세션의 collab 이다(이 스택엔 collab 이 없다).
    # DEV_* 는 vite.config.ts 만 읽는 개발 서버 설정이다(VITE_* 는 클라이언트 코드에 노출된다).
    DEV_API_PORT="$API_PORT" DEV_COLLAB_PORT=9 exec nohup ./node_modules/.bin/vite --port "$WEB_PORT" --strictPort --host 127.0.0.1
  ) >"$WEB_LOG" 2>&1 </dev/null &
  WEB_PID=$!
  state_put WEB_PID "$WEB_PID"

  log "API health 대기(최대 240초)"
  wait_until 240 api_up || die "API 가 240초 안에 UP 이 되지 않았다"
  log "웹 응답 대기(최대 60초)"
  wait_until 60 web_200 || die "웹이 60초 안에 200 을 돌려주지 않았다"

  # 6) 첫 계정 — 빈 DB 의 첫 signup 만 허용되고 ADMIN 이 된다. username 은 이메일, 비밀번호는 대·소문자·숫자 포함.
  ADMIN_USER="admin@work-loop.local"
  ADMIN_PASSWORD="Wl$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)9a"
  _code=$(curl -s -o "$SIGNUP_JSON" -w '%{http_code}' \
    -X POST "http://localhost:$API_PORT/api/v1/auth/signup" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"email\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASSWORD\",\"name\":\"Work Loop Admin\"}")
  [ "$_code" = "201" ] || die "첫 계정 signup 실패(HTTP $_code) — $SIGNUP_JSON"
  rm -f "$SIGNUP_JSON"
  state_put ADMIN_USER "$ADMIN_USER"
  state_put ADMIN_PASSWORD "$ADMIN_PASSWORD"

  # 7) 브라우저처럼 로그인되는지 — 웹 프록시를 거쳐 Origin 을 붙여 보낸다. curl 은 Origin 이 없으면 CORS 를
  #    거치지 않아 통과하므로, Origin 없이 확인하면 브라우저에서만 나는 403 을 놓친다.
  _code=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "http://localhost:$WEB_PORT/api/v1/auth/login" \
    -H "Origin: http://localhost:$WEB_PORT" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASSWORD\"}")
  [ "$_code" = "200" ] || die "웹을 거친 로그인 실패(HTTP $_code, Origin http://localhost:$WEB_PORT) — CORS 설정 확인"

  trap - EXIT
  log "준비 완료 — 웹 http://localhost:$WEB_PORT · API http://localhost:$API_PORT · 계정 $ADMIN_USER"
  log "상태 파일 $STATE_FILE (비밀번호 포함, git 무시)"
}

# ---------------------------------------------------------------------------
# down — 상태 파일에 적힌 것만 내린다
# ---------------------------------------------------------------------------

cmd_down() {
  if [ ! -f "$STATE_FILE" ]; then
    log "스택 '$LIVE_STACK_NAME' 의 상태 파일이 없다 — 내릴 것이 없다($STATE_FILE)"
    return 0
  fi
  # 상태 파일 값을 한 줄씩 읽는다 — source 하지 않으므로 값에 셸 글자가 있어도 실행되지 않는다.
  API_PID=$(state_get API_PID) WEB_PID=$(state_get WEB_PID) DB_CONTAINER=$(state_get DB_CONTAINER)
  API_PORT=$(state_get API_PORT) WEB_PORT=$(state_get WEB_PORT) DB_PORT=$(state_get DB_PORT)

  # 웹·API 는 명령줄이 이 스택의 것일 때만 끝낸다(stop_pid).
  # API 는 --server.port=<우리 포트> --server.address=127.0.0.1, 웹은 --port <우리 포트> --strictPort --host 127.0.0.1 이
  # 명령줄에 있어야 한다(up 이 넘긴 인자 순서 그대로).
  stop_pid 웹 "$WEB_PID" "--port $WEB_PORT --strictPort --host 127.0.0.1"
  stop_pid API "$API_PID" "--server.port=$API_PORT --server.address=127.0.0.1"
  # 컨테이너는 우리 이름 규칙(wl-*-db)일 때만 지운다.
  case "$DB_CONTAINER" in
    wl-*-db)
      if docker container inspect "$DB_CONTAINER" >/dev/null 2>&1; then
        log "DB 컨테이너 삭제($DB_CONTAINER)"
        docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
      fi
      ;;
  esac

  # 포트가 비었는지 확인(최대 30초) — 남아 있으면 알리기만 한다(남의 것일 수 있어 강제로 죽이지 않는다).
  for _p in $API_PORT $WEB_PORT $DB_PORT; do
    if ! wait_until 30 sh -c "! lsof -nP -iTCP:$_p -sTCP:LISTEN" ; then
      echo "[live-stack] 경고: 포트 $_p 가 아직 쓰는 중이다" >&2
    fi
  done
  rm -f "$STATE_FILE"
  log "스택 '$LIVE_STACK_NAME' 내림 완료"
}

cmd_status() {
  if [ -f "$STATE_FILE" ]; then
    # 비밀번호는 보이지 않는다.
    grep -v '^ADMIN_PASSWORD=' "$STATE_FILE"
  else
    log "스택 '$LIVE_STACK_NAME' 없음($STATE_FILE)"
  fi
}

# ---------------------------------------------------------------------------
# 진입점 — LIVE_STACK_LIB=1 이면 함수만 읽고 끝낸다(시험용)
# ---------------------------------------------------------------------------

if [ -z "$LIVE_STACK_LIB" ]; then
  # MAIN 은 이 스크립트가 든 저장소 기준 — 어디서 불러도(cwd 무관) 같은 상태 파일을 쓴다.
  MAIN=$(main_dir "$(dirname "$0")") || die "git 저장소 안의 스크립트로 실행하라"
  STATE_DIR="$MAIN/.work-loop/state"
  # 스택 이름 — 이름마다 상태 파일·로그가 따로다(사람의 default 와 work-loop 가 서로를 건드리지 않게).
  LIVE_STACK_NAME=${LIVE_STACK_NAME:-default}
  valid_stack_name "$LIVE_STACK_NAME" || die "LIVE_STACK_NAME 은 영문·숫자·_·- 만 쓴다: '$LIVE_STACK_NAME'"
  STATE_FILE="$STATE_DIR/live-stack-$LIVE_STACK_NAME.env"
  API_LOG="$STATE_DIR/live-stack-$LIVE_STACK_NAME-api.log"
  WEB_LOG="$STATE_DIR/live-stack-$LIVE_STACK_NAME-web.log"
  SIGNUP_JSON="$STATE_DIR/live-stack-$LIVE_STACK_NAME-signup.json"
  case "$1" in
    up)
      shift
      cmd_up "$@"
      ;;
    down) cmd_down ;;
    status) cmd_status ;;
    *)
      echo "사용법: [LIVE_STACK_NAME=<이름>] $0 up [<워크트리 경로>] | down | status" >&2
      exit 2
      ;;
  esac
fi
