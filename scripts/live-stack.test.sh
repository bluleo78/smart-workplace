#!/usr/bin/env sh
# scripts/live-stack.sh 의 작은 함수들(포트 고르기·스택 이름·상태 파일 읽고 쓰기·DB 컨테이너 지우기)을 따로 시험한다.
# up 은 DB·빌드가 필요해 돌리지 않고, down 은 가짜 docker 로 웹·API 끄기를 건너뛰고 돌린다 — 이 시험은 수 초 안에 끝나야 한다.
# - 후보 포트가 비어 있으면 그대로 고른다.
# - 후보가 쓰는 중이면 +1 한 포트를 고른다.
# - 다른 세션 포트(6060 등)는 후보로 받아도 절대 고르지 않는다.
# - docker 가 공개한 포트(단일·범위)는 lsof 에 안 보여도 쓰는 중으로 본다(WP-864).
# - 스택 이름은 영문·숫자·_·- 만 받는다.
# - 상태 파일 값은 공백·$·`·' 가 있어도 그대로 되읽히고, 사람이 `. ` 로 읽어도 실행되지 않는다.
# - DB 컨테이너는 docker 에 닿지 않거나 지우지 못하면 실패로 알린다(down 이 상태 파일을 남기도록).
# 실행: sh scripts/live-stack.test.sh

DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$DIR/live-stack.sh"

fail=0
pass=0
holder=""
tmp=""

# 시험 중 잡아 둔 포트·임시 폴더는 끝날 때 반드시 정리한다(실패로 빠져나가도).
# 파이프 앞쪽 sleep 은 $! 에 잡히지 않으므로 이 셸의 자식 sleep 도 함께 끝낸다.
cleanup() {
  [ -n "$holder" ] && kill "$holder" 2>/dev/null
  holder=""
  pkill -P $$ sleep 2>/dev/null || true
}
trap 'cleanup; [ -n "$tmp" ] && rm -rf "$tmp"' EXIT INT TERM

check() {
  # $1 = 이름, $2 = 기대, $3 = 실제
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1))
    echo "ok   - $1"
  else
    fail=$((fail + 1))
    echo "FAIL - $1 (기대: '$2', 실제: '$3')"
  fi
}

if [ ! -f "$SCRIPT" ]; then
  echo "FAIL - $SCRIPT 가 없다"
  exit 1
fi

# 스크립트를 라이브러리로만 읽는다 — LIVE_STACK_LIB=1 이면 up/down 을 실행하지 않는다.
LIVE_STACK_LIB=1
. "$SCRIPT"

# 시험용 기준 포트 — 다른 세션과 겹치지 않게 높은 대역(46160~)에서 연속 두 칸(BASE, BASE+1)이 빈 곳을 직접 찾는다.
# 6160 처럼 고정하면 그 포트를 누가 쓰는 순간 시험이 실패한다.
BASE=""
_b=46160
while [ "$_b" -lt 46660 ]; do
  if ! port_in_use "$_b" && ! port_in_use $((_b + 1)); then
    BASE=$_b
    break
  fi
  _b=$((_b + 2))
done
if [ -z "$BASE" ]; then
  echo "FAIL - 시험 전제: 46160~46659 에 연속으로 빈 포트 두 칸이 없다"
  exit 1
fi

# 1) 빈 후보 포트는 그대로
check "빈 $BASE 은 그대로 $BASE" "$BASE" "$(pick_port "$BASE")"

# 2) 후보를 잡아 둔 상태에서는 +1
# nc -l 은 연결이 오면 끝나므로 sleep 을 앞에 물려 시험 동안 붙잡아 둔다.
# 고르는 쪽이 nc -z 로 찔러도 끊기지 않도록 pick_port 는 lsof 로만 확인해야 한다.
sleep 30 | nc -l "$BASE" >/dev/null 2>&1 &
holder=$!
# 듣기 시작할 때까지 기다린다(경합 방지) — 최대 5초
i=0
while ! port_in_use "$BASE"; do
  i=$((i + 1))
  if [ "$i" -gt 50 ]; then
    echo "FAIL - 시험 전제: nc 가 $BASE 을 잡지 못했다"
    exit 1
  fi
  sleep 0.1
done
check "쓰는 중인 $BASE 이면 $((BASE + 1))" "$((BASE + 1))" "$(pick_port "$BASE")"
cleanup

# 3) 금지 포트는 후보로 받아도 고르지 않는다
got=$(pick_port 6060)
case "$got" in
  6060 | 6173 | 5434 | 6090 | "") check "6060 후보에서 금지 포트를 고르지 않음" "금지 포트 아님" "$got" ;;
  *) check "6060 후보에서 금지 포트를 고르지 않음" "x" "x" ;;
esac

# 4) 올려 가다 금지 포트를 만나도 건너뛴다(6173 은 웹 기본 포트 — 고르면 안 됨)
check "6173 후보는 건너뛰어 6175 이상" "1" "$([ "$(pick_port 6173)" -ge 6175 ] && echo 1 || echo 0)"

# 4-1) Docker 공개 포트는 lsof 에 안 보여도 쓰는 중(WP-864) — Linux Docker 는 root 의 docker-proxy·iptables 가 잡는다.
# 가짜 docker 가 다른 스택의 DB 컨테이너처럼 $BASE 를, 다른 컨테이너가 범위 $((BASE + 300))-$((BASE + 302)) 를 공개한 것으로 답한다.
portbin=$(mktemp -d)
cat >"$portbin/docker" <<FAKE
#!/bin/sh
[ "\$1" = ps ] && echo "127.0.0.1:$BASE->5432/tcp" && echo "0.0.0.0:$((BASE + 300))-$((BASE + 302))->80-82/tcp, :::$((BASE + 300))-$((BASE + 302))->80-82/tcp"
exit 0
FAKE
chmod +x "$portbin/docker"
check "docker 가 공개한 $BASE 이면 $((BASE + 1))" "$((BASE + 1))" "$(PATH="$portbin:$PATH" pick_port "$BASE")"
check "docker 가 공개한 범위 안의 $((BASE + 301)) 도 쓰는 중" "0" "$(PATH="$portbin:$PATH" port_in_use $((BASE + 301)) && echo 0 || echo 1)"
# 앞자리만 같은 짧은 포트는 겹침으로 보지 않는다 — 그 포트가 실제로 비어 있을 때만 본다(남이 쓰면 이 확인은 건너뜀).
short=${BASE%?}
if ! port_in_use "$short"; then
  check "공개 포트 $BASE 가 앞자리만 같은 $short 을 막지 않는다" "1" "$(PATH="$portbin:$PATH" port_in_use "$short" && echo 0 || echo 1)"
fi
rm -rf "$portbin"

# 5) 스택 이름 — 상태 파일 이름에 들어가므로 경로 조각·셸 글자는 거절한다
for n in default work-loop fix_check2; do
  check "스택 이름 '$n' 은 받는다" "0" "$(valid_stack_name "$n" && echo 0 || echo 1)"
done
for n in "" "a/b" "../x" "a b" 'a$b' "a.b"; do
  check "스택 이름 '$n' 은 거절한다" "1" "$(valid_stack_name "$n" && echo 0 || echo 1)"
done

# 6) 상태 파일 — 셸 글자가 든 값도 그대로 되읽히고(state_get), `. ` 로 읽어도 명령이 실행되지 않는다
tmp=$(mktemp -d)
STATE_FILE="$tmp/state.env"
: >"$STATE_FILE"
weird="$tmp/작업 폴더 \$(touch $tmp/pwned) \`touch $tmp/pwned2\` it's \\n end"
state_put TARGET "$weird"
state_put API_PORT 6160
check "공백·\$()·백틱·'·\\ 가 든 값을 그대로 되읽는다" "$weird" "$(state_get TARGET)"
check "평범한 값도 되읽는다" "6160" "$(state_get API_PORT)"
check "없는 키는 빈 값" "" "$(state_get NOPE)"
(
  TARGET=""
  . "$STATE_FILE"
  [ "$TARGET" = "$weird" ] && echo same
) >"$tmp/sourced" 2>&1
check "사람이 . 로 읽어도 같은 값" "same" "$(cat "$tmp/sourced")"
check ". 로 읽어도 \$() 가 실행되지 않는다" "no" "$([ -e "$tmp/pwned" ] && echo yes || echo no)"
check ". 로 읽어도 백틱이 실행되지 않는다" "no" "$([ -e "$tmp/pwned2" ] && echo yes || echo no)"

# 7) DB 컨테이너 지우기 — 가짜 docker 로 「닿지 않음 · 없음 · 지움 · rm 실패」를 보고, down 이 지우지 못하면 상태 파일을 남기는지 본다.
fakebin="$tmp/bin"
mkdir -p "$fakebin"
cat >"$fakebin/docker" <<'FAKE'
#!/bin/sh
# FAKE_DOCKER: down(닿지 않음) · missing(컨테이너 없음) · ok(지움) · rmfail(rm 실패)
case "$FAKE_DOCKER:$1" in
  down:*) echo "Cannot connect to the Docker daemon" >&2; exit 1 ;;
  missing:container) echo "Error: No such container: $3" >&2; exit 1 ;;
  rmfail:rm) echo "Error: container is in use" >&2; exit 1 ;;
  *) exit 0 ;;
esac
FAKE
chmod +x "$fakebin/docker"
# 마지막 절이라 이 뒤로는 가짜 docker 만 쓴다.
PATH="$fakebin:$PATH"
for case_ in "down 1" "missing 0" "ok 0" "rmfail 1"; do
  set -- $case_
  got=$(FAKE_DOCKER=$1 remove_db_container wl-1-db >/dev/null 2>&1 && echo 0 || echo 1)
  check "DB 컨테이너 지우기 — docker $1 이면 $2" "$2" "$got"
done
check "우리 이름 규칙이 아니면 docker 를 부르지 않고 성공" "0" \
  "$(FAKE_DOCKER=down remove_db_container smart-workplace-db-1 >/dev/null 2>&1 && echo 0 || echo 1)"

# down — 웹·API 끄기와 포트 기다리기는 이 시험에서 건너뛴다(가짜로 바꿔 둔다).
stop_pid() { :; }
wait_until() { return 0; }
down_case() {
  # $1 = FAKE_DOCKER → 「종료코드 상태파일남음(yes/no)」
  : >"$STATE_FILE"
  state_put DB_CONTAINER wl-1-db
  FAKE_DOCKER=$1 cmd_down >/dev/null 2>&1
  echo "$? $([ -f "$STATE_FILE" ] && echo yes || echo no)"
}
check "down — docker 에 닿지 않으면 1 을 내고 상태 파일을 남긴다" "1 yes" "$(down_case down)"
check "down — rm 이 실패하면 1 을 내고 상태 파일을 남긴다" "1 yes" "$(down_case rmfail)"
check "down — 지우면 0 을 내고 상태 파일을 지운다" "0 no" "$(down_case ok)"
check "down — 컨테이너가 이미 없으면 0 을 내고 상태 파일을 지운다" "0 no" "$(down_case missing)"

echo "통과 $pass · 실패 $fail"
[ "$fail" -eq 0 ]
