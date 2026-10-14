# genia-works 플러그인 sh 스크립트 공용 함수 — 각 스크립트가 source 한다(실행 파일 아님).
# 사용자 데이터는 플러그인 폴더(버전마다 바뀜)가 아니라 홈 ~/.genia-works 에 둔다.
GW_HOME="${HOME}/.genia-works"
GW_KEYS="$GW_HOME/keys"
GW_SESSIONS="$GW_HOME/sessions"

# 이름 검사 — 파일 이름으로 쓰므로 경로 조작(../, /)·공백·빈 값을 막는다.
gw_valid_name() {
  case "$1" in
    '' | . | .. | *[!A-Za-z0-9._@-]*) return 1 ;;
  esac
  return 0
}

# 프로세스 하나의 세션 키 "<pid>-<시작 시각>". pid 가 다시 쓰여도 시작 시각이 달라 키가 겹치지 않는다.
gw_proc_key() {
  lstart=$(LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | tr -s ' :' '__' | sed 's/^_//;s/_$//')
  [ -n "$lstart" ] || return 1
  printf '%s-%s\n' "$1" "$lstart"
}

# claude 실행 파일로 보이는 단어인지 — 네이티브(claude, …/claude, …/claude/versions/x)와 npm(node …/bin/claude) 모두.
gw_is_claude_word() {
  case "$1" in
    claude | */claude | */claude.exe | */claude/versions/*) return 0 ;;
  esac
  return 1
}

# 가장 가까운 claude 조상 프로세스 번호 — 환경변수(CLAUDE_PID 등)는 부모 세션에서 상속돼 믿을 수 없어 ps 로 찾는다(3차 실험).
gw_claude_pid() {
  p="${GW_START_PID:-$PPID}"
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    set -f
    # shellcheck disable=SC2046 — args 를 단어로 나눠 앞 두 단어만 본다.
    set -- $(ps -o args= -p "$p" 2>/dev/null)
    set +f
    if gw_is_claude_word "${1:-}" || gw_is_claude_word "${2:-}"; then
      echo "$p"
      return 0
    fi
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  return 1
}

# 끝난 세션의 선택 파일 정리 — 비정상 종료하면 mod 의 session.end 가 돌지 않으므로 헤더 스크립트가 접속 때마다 치운다.
# pid 가 살아 있어도 시작 시각이 다르면(pid 재사용) 지운다.
gw_prune_sessions() {
  [ -d "$GW_SESSIONS" ] || return 0
  for f in "$GW_SESSIONS"/*; do
    [ -f "$f" ] || continue
    k=${f##*/}
    pid=${k%%-*}
    case "$pid" in '' | *[!0-9]*) rm -f "$f"; continue ;; esac
    cur=$(gw_proc_key "$pid" 2>/dev/null) || cur=""
    [ "$cur" = "$k" ] || rm -f "$f"
  done
}

# 파일 원자적 교체 — 같은 폴더의 임시 파일에 쓰고 mv 한다(읽는 쪽이 반쯤 쓴 파일을 보지 않게).
gw_write_atomic() {
  dir=$(dirname "$1")
  tmp=$(mktemp "$dir/.tmp.XXXXXX") || return 1
  printf '%s\n' "$2" > "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$1"
}
