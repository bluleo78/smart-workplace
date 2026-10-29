#!/usr/bin/env sh
# push 게이트 범위 판정 (WP-1208) — full-regression.sh·pre-push.sh·gate-bundle.sh 가 source 해 같은 규칙을 쓴다.
# E2E 는 실제 API 를 띄워 돌므로 api 변경은 E2E 까지 필요하다. 반대 방향만 줄인다:
#   web 만 바꿨으면 admin E2E·gradle 을, admin 만 바꿨으면 web vitest·web E2E·gradle 을 건너뛴다.
# 범위 값: full | web | admin | web+admin (web+admin 은 두 앱만 바꾼 변경 — api 를 건드리지 않으니 gradle 만 건너뛴다).
# 판정할 수 없으면(기준 ref 가 없음·코드 변경 없음) full 이다 — 애매하면 전체를 도는 쪽으로 기운다.
# noncode.sh 를 먼저 source 해야 한다(code_files).
# 이 파일의 함수는 호출하는 쪽 변수를 덮지 않게 내부 변수를 _gs_ 로 시작한다(sh 에는 local 이 없다).

# 앱 폴더 안에 있어도 다른 앱의 테스트가 읽는 파일 — 바뀌면 전체를 돈다.
#   web 의 resource-contract.json 은 api 의 ResourceChangedContractTest 가 읽는다(키 목록이 서버와 같은지).
GATE_SCOPE_SHARED_RE='^apps/workplace-web/src/lib/resource-contract\.json$'

# gate_scope <base> <commit> — base 와 갈라진 뒤 commit 이 바꾼 코드 파일로 범위를 낸다.
# base 와 commit 의 merge-base 부터 본다 — main 이 앞서 있어도 브랜치가 바꾼 것만 센다.
gate_scope() {
  _gs_mb=$(git merge-base "$1" "$2" 2>/dev/null) || { echo full; return; }
  _gs_files=$(code_files "$(git -c core.quotePath=false diff --name-only --no-renames "$_gs_mb" "$2")")
  [ -n "$_gs_files" ] || { echo full; return; }
  # 앱 하나에만 걸린 변경인지 — 두 앱 밖 경로나 다른 앱이 읽는 파일이 하나라도 있으면 full.
  if printf '%s\n' "$_gs_files" | grep -qvE '^apps/workplace-(web|admin)/'; then echo full; return; fi
  if printf '%s\n' "$_gs_files" | grep -qE "$GATE_SCOPE_SHARED_RE"; then echo full; return; fi
  _gs_web=0; _gs_admin=0
  printf '%s\n' "$_gs_files" | grep -q '^apps/workplace-web/' && _gs_web=1
  printf '%s\n' "$_gs_files" | grep -q '^apps/workplace-admin/' && _gs_admin=1
  if [ "$_gs_web" -eq 1 ] && [ "$_gs_admin" -eq 1 ]; then echo web+admin
  elif [ "$_gs_web" -eq 1 ]; then echo web
  else echo admin
  fi
}

# scope_covers <기록된 범위> <필요한 범위> — 기록된 범위로 통과한 게이트가 필요한 범위를 덮으면 0.
# full 은 모두를 덮고, 그 밖에는 필요한 앱이 모두 기록에 들어 있어야 한다(web 기록은 web+admin 을 덮지 못한다).
scope_covers() {
  [ "$1" = full ] && return 0
  [ "$2" = full ] && return 1
  for _gs_app in $(printf '%s' "$2" | tr '+' ' '); do
    case "+$1+" in *"+$_gs_app+"*) : ;; *) return 1 ;; esac
  done
  return 0
}

# scope_union <범위>… — 여러 범위를 모두 덮는 가장 좁은 범위(묶음 범위·기록 합치기).
scope_union() {
  _gs_web=0; _gs_admin=0
  for _gs_s in "$@"; do
    case "$_gs_s" in
      full) echo full; return ;;
      web) _gs_web=1 ;;
      admin) _gs_admin=1 ;;
      web+admin) _gs_web=1; _gs_admin=1 ;;
      *) echo full; return ;;
    esac
  done
  if [ "$_gs_web" -eq 1 ] && [ "$_gs_admin" -eq 1 ]; then echo web+admin
  elif [ "$_gs_web" -eq 1 ]; then echo web
  elif [ "$_gs_admin" -eq 1 ]; then echo admin
  else echo full
  fi
}
