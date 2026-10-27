# genia-works 플러그인 sh 스크립트 공용 함수 — 각 스크립트가 source 한다(실행 파일 아님).
# 사용자 데이터는 플러그인 폴더(버전마다 바뀜)가 아니라 홈 ~/.genia-works 에 둔다.
GW_HOME="${HOME}/.genia-works"
GW_KEYS="$GW_HOME/keys"
GW_SESSIONS="$GW_HOME/sessions"

# 이름 검사 — 파일 이름으로 쓰므로 경로 조작(../, /)·공백·빈 값을 막는다.
# me 는 "내 토큰" 선택값(gw-session select me)이라 키 이름으로 쓰면 선택할 수 없으므로 예약한다.
gw_valid_name() {
  case "$1" in
    '' | . | .. | me | *[!A-Za-z0-9._@-]*) return 1 ;;
  esac
  return 0
}

# 프로세스 시작 시각을 늘 같은 모양으로 — 예: Thu_Oct_15_06_00_00_2026. 못 읽으면(프로세스 없음 등) 아무것도 내지 않고 1.
# 시작 시각 문자열은 지역 시간대(TZ·DST)에 따라 달라진다 — 세션 도중 시간대가 바뀌면 키가 어긋나
# 헤더가 {}(내 토큰)로 나가고 선택 파일이 지워져 신원이 조용히 뒤집힌다. 그래서 UTC·C 로캘로 고정한다.
gw_lstart() {
  _gw_ls=$(TZ=UTC0 LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | tr -s ' :' '__' | sed 's/^_//;s/_$//')
  [ -n "$_gw_ls" ] || return 1
  printf '%s\n' "$_gw_ls"
}

# 프로세스 하나의 세션 키 "<pid>-<시작 시각>". pid 가 다시 쓰여도 시작 시각이 달라 키가 겹치지 않는다.
# 세션 선택 파일 이름(gw-session)과 work-loop 잠금(loop-lock)이 같은 키를 쓴다.
gw_proc_key() {
  _gw_ls=$(gw_lstart "$1") || return 1
  printf '%s-%s\n' "$1" "$_gw_ls"
}

# 키 파일 내용 검사 — 비어 있지 않고, 보이는 문자(공백·제어 문자 없음)만이며, JSON 을 깨는 따옴표·역슬래시가 없어야 한다.
# 헤더 스크립트(gw-headers)와 존재 확인(gw-keys has)이 같은 기준을 쓰도록 한곳에 둔다.
gw_key_ok() {
  case "$1" in
    '' | *[![:graph:]]* | *'"'* | *\\*) return 1 ;;
  esac
  return 0
}

# 키 읽기 — 이름이 유효하고 파일이 있고 첫 줄이 gw_key_ok 를 통과하면 키를 출력하고 0, 아니면 아무것도 내지 않고 1.
# 헤더 스크립트·존재 확인(gw-keys has)·세션 선택이 같은 기준을 한 함수로 쓴다(호출 쪽에서 존재 확인만 할 때는 출력을 버린다).
gw_read_key() {
  gw_valid_name "$1" && [ -f "$GW_KEYS/$1" ] || return 1
  _gw_k=""
  { IFS= read -r _gw_k || true; } 2>/dev/null < "$GW_KEYS/$1"
  gw_key_ok "$_gw_k" || return 1
  printf '%s\n' "$_gw_k"
}

# claude 실행 파일로 보이는 단어인지 — 네이티브(claude, …/claude, …/claude/versions/x)와 npm(node …/bin/claude) 모두.
gw_is_claude_word() {
  case "$1" in
    claude | */claude | */claude.exe | */claude/versions/*) return 0 ;;
  esac
  return 1
}

# 프로세스의 명령줄이 claude 실행으로 보이는지 — 앞 두 단어만 본다(node …/bin/claude 처럼 둘째 단어일 수 있다).
# 위치 인자를 바꾸므로 하위 셸에서 돌린다(부르는 쪽의 $1… 를 건드리지 않게).
gw_is_claude_proc() (
  set -f
  # shellcheck disable=SC2046 — args 를 단어로 나눠 앞 두 단어만 본다.
  set -- $(ps -o args= -p "$1" 2>/dev/null)
  gw_is_claude_word "${1:-}" || gw_is_claude_word "${2:-}"
)

# 가장 가까운 claude 조상 프로세스 번호 — 환경변수(CLAUDE_PID 등)는 부모 세션에서 상속돼 믿을 수 없어 ps 로 찾는다(3차 실험).
gw_claude_pid() {
  # GW_START_PID 는 테스트 전용 훅(가짜 ps 표에서 시작 프로세스를 고정) — 운영에서는 설정하지 않는다.
  p="${GW_START_PID:-$PPID}"
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    if gw_is_claude_proc "$p"; then
      echo "$p"
      return 0
    fi
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  return 1
}

# 프로세스가 살아 있는지 — kill -0 이 성공하거나(다른 사용자 프로세스는 EPERM 으로 실패하므로) ps 가 그 pid 를 보여 주면 산 것으로 본다.
# GW_PRUNE_PS_ONLY 는 테스트 전용 훅(가짜 pid 가 진짜 프로세스와 겹치지 않게 kill 검사를 건너뛰고 가짜 ps 표만 본다) — 운영에서는 설정하지 않는다.
gw_pid_alive() {
  [ -n "${GW_PRUNE_PS_ONLY:-}" ] || ! kill -0 "$1" 2>/dev/null || return 0
  [ -n "$(ps -o pid= -p "$1" 2>/dev/null | tr -d ' ')" ]
}

# 끝난 세션의 선택 파일 정리 — 비정상 종료하면 mod 의 session.end 가 돌지 않으므로 헤더 스크립트가 접속 때마다 치운다.
# 프로세스가 끝났거나(pid 없음) 재사용됐을 때(시작 시각을 읽었고 다름)만 지운다.
# 시작 시각을 읽지 못하면(ps 일시 실패) pid 가 살아 있는 한 둔다 — 살아 있는 세션의 선택을 지우면 신원이 조용히 내 토큰으로 뒤집힌다.
gw_prune_sessions() {
  [ -d "$GW_SESSIONS" ] || return 0
  for f in "$GW_SESSIONS"/*; do
    [ -f "$f" ] || continue
    k=${f##*/}
    pid=${k%%-*}
    case "$pid" in '' | *[!0-9]*) rm -f "$f"; continue ;; esac
    if ! gw_pid_alive "$pid"; then rm -f "$f"; continue; fi
    cur=$(gw_proc_key "$pid" 2>/dev/null) || cur=""
    [ -z "$cur" ] || [ "$cur" = "$k" ] || rm -f "$f"
  done
}

# 파일 원자적 교체 — 같은 폴더의 임시 파일에 쓰고 mv 한다(읽는 쪽이 반쯤 쓴 파일을 보지 않게).
gw_write_atomic() {
  dir=$(dirname "$1")
  tmp=$(mktemp "$dir/.tmp.XXXXXX") || return 1
  # 하나라도 실패하면 임시 파일을 남기지 않고 실패를 알린다.
  if printf '%s\n' "$2" > "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$1"; then
    return 0
  fi
  rm -f "$tmp"
  return 1
}

# 이 세션의 신원 이름 — 세션 선택(gw-session) > GENIA_WORKS_AS. 없거나 me 면 아무것도 내지 않는다(내 토큰).
# 헤더 스크립트와 알림 구독(gw-events)이 같은 신원을 쓰도록 한곳에 둔다(WP-720). 부르는 스크립트와 같은 폴더의 gw-session-key 를 쓴다.
gw_identity() {
  _gw_name=""
  _gw_sk=$("$(dirname "$0")/gw-session-key" 2>/dev/null) && [ -f "$GW_SESSIONS/$_gw_sk" ] && _gw_name=$(head -n1 "$GW_SESSIONS/$_gw_sk")
  [ -n "$_gw_name" ] || _gw_name="${GENIA_WORKS_AS:-}"
  [ "$_gw_name" = me ] && _gw_name=""
  printf '%s' "$_gw_name"
}
