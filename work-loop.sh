#!/usr/bin/env bash
# genia-works work-loop 실행기 — AI 신원을 고르고(필수), 대기열 라벨을 고른 뒤(선택)
# 자동 압축 임계값을 낮춘 Claude Code 세션에서 `/loop /genia-works:work-loop <프로젝트>` 를 띄운다.
#
# 사용법: ./work-loop.sh [-a <AI 이름>] [-q <대기열 라벨>|-Q] [-p <프로젝트 키>] [-C <저장소 폴더>] [-c <압축 %>]
#   -a  AI 이름(~/.genia-works/keys 에 등록한 것). 없으면 목록에서 고른다
#   -q  대기열 라벨. 없으면 물어본다(엔터 = 대기열 없음)
#   -Q  대기열 없이 바로 띄운다(묻지 않음)
#   -p  프로젝트 키(기본 WP)
#   -C  work-loop 를 돌릴 저장소 폴더(기본 이 스크립트가 있는 저장소). 저장소 하나에는 work-loop 하나만 돈다
#   -c  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE 값(기본 40, 기본 임계값보다 낮출 때만 효과)
# GH_TOKEN 등 다른 환경변수는 그대로 넘어간다(PR 흐름 준비는 플러그인 README 「PR 흐름 준비」).
set -euo pipefail

KEYS_DIR="$HOME/.genia-works/keys"
agent="" queue="" ask_queue=1 project="WP" repo="$(cd "$(dirname "$0")" && pwd)" pct="40"

usage() { sed -n '5,12p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while getopts "a:q:Qp:C:c:h" opt; do
  case "$opt" in
    a) agent="$OPTARG" ;;
    q) queue="$OPTARG"; ask_queue=0 ;;
    Q) queue=""; ask_queue=0 ;;
    p) project="$OPTARG" ;;
    C) repo="$OPTARG" ;;
    c) pct="$OPTARG" ;;
    h) usage 0 ;;
    *) usage 2 ;;
  esac
done

# 압축 %는 1~100 정수만 받는다(문서 범위)
[[ "$pct" =~ ^[0-9]+$ ]] && (( pct >= 1 && pct <= 100 )) || { echo "압축 % 는 1~100 사이 정수여야 합니다: $pct" >&2; exit 2; }

# 저장소 확인 — work-loop 는 git 저장소의 main 작업 폴더(.work-loop/project.md)를 기준으로 돈다
repo=$(cd "$repo" && git rev-parse --show-toplevel 2>/dev/null) || { echo "git 저장소가 아닙니다: $repo" >&2; exit 2; }
[[ -f "$repo/.work-loop/project.md" ]] || echo "경고: $repo/.work-loop/project.md 가 없어 라이브 검증에서 막힐 수 있습니다" >&2

# 1. AI 선택 — 등록된 키 파일 이름이 곧 AI 이름(gw-keys list 와 같은 기준: me 예약, 허용 문자만)
agents=()
if [[ -d "$KEYS_DIR" ]]; then
  for f in "$KEYS_DIR"/*; do
    n=${f##*/}
    [[ -f "$f" && "$n" != "me" && "$n" =~ ^[A-Za-z0-9._@-]+$ ]] && agents+=("$n")
  done
fi
(( ${#agents[@]} > 0 )) || { echo "등록된 AI 키가 없습니다. claude 에서 /genia-works:login 으로 먼저 등록하세요" >&2; exit 2; }

if [[ -n "$agent" ]]; then
  [[ " ${agents[*]} " == *" $agent "* ]] || { echo "등록되지 않은 AI 입니다: $agent (등록: ${agents[*]})" >&2; exit 2; }
else
  echo "실행할 AI 를 고르세요:"
  PS3="번호> "
  select a in "${agents[@]}"; do
    [[ -n "${a:-}" ]] && { agent="$a"; break; }
    echo "목록의 번호를 고르세요"
  done
  [[ -n "$agent" ]] || exit 1
fi

# 2. 대기열 라벨(선택) — project.md 「대기열 라벨」 표의 라벨을 후보로 보여 주고, 직접 입력도 받는다
if (( ask_queue )); then
  labels=()
  if [[ -f "$repo/.work-loop/project.md" ]]; then
    while IFS= read -r l; do [[ -n "$l" ]] && labels+=("$l"); done < <(
      awk '/^## .*대기열 라벨/{on=1;next} /^## /{on=0} on && /^\|/' "$repo/.work-loop/project.md" \
        | grep -o '`[^`]*`' | tr -d '`'
    )
  fi
  echo
  echo "대기열 라벨(선택) — 할 일이 없을 때 이 라벨이 붙은 이슈를 가져갑니다."
  i=1
  for l in ${labels[@]+"${labels[@]}"}; do echo "  $i) $l"; i=$((i + 1)); done
  read -r -p "번호 또는 라벨 입력(엔터 = 대기열 없음)> " ans
  if [[ "$ans" =~ ^[0-9]+$ ]] && (( ans >= 1 && ans <= ${#labels[@]} )); then
    queue="${labels[ans-1]}"
  else
    queue="$ans"
  fi
fi

# 라벨 규칙(project.md): 숫자만·쉼표 금지, 슬래시 명령 인자를 깨는 따옴표도 막는다
if [[ -n "$queue" ]]; then
  [[ "$queue" =~ ^[0-9]+$ || "$queue" == *,* || "$queue" == *\"* ]] && { echo "쓸 수 없는 라벨입니다(숫자만·쉼표·따옴표 불가): $queue" >&2; exit 2; }
fi

# 3. 실행
cmd="/loop /genia-works:work-loop $project"
[[ -n "$queue" ]] && cmd+=" --queue \"$queue\""

echo
echo "AI: $agent · 프로젝트: $project · 대기열: ${queue:-없음} · 자동 압축: ${pct}%"
echo "폴더: $repo"
echo "명령: $cmd"
echo

cd "$repo"
export GENIA_WORKS_AS="$agent"
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE="$pct"
exec claude --permission-mode bypassPermissions "$cmd"
