# Codex 작업 공간 엔트리포인트의 전용 함수(WP-1297) — Claude Code 이미지의 lib.sh 를 먼저 읽고 이 파일을 뒤에 읽는다(같은 이름은 덮어쓴다).
# 공용(필수 확인·폴더·추가 CA·키·git·dind·프로젝트·감독·정리·adopt_plugin_scripts·use_baked_plugin·write_superpowers_agents_md·bg_wait)은 lib.sh 그대로, 여기에는 Codex 만의 일을 둔다:
#   - 플러그인 고르기(use_plugin) — 빌드 때 굳힌 genia-works(codex 구동기 포함)만 쓴다.
#   - Codex 환경·설정·전역 지시·로그인 시딩(codex_env·write_codex_config·write_codex_agents_md·seed_login),
#     모델 목록 보고와 추론 강도 맞추기(report_models·codex_fit_effort — 칸의 codex 가 쉴 때만), 감독 회차 훅(before_supervise·can_launch —
#     tick 은 lib.sh).
# Codex 프로그램(@openai/codex)은 공개 패키지라 이미지에 고정 버전으로 넣는다(Dockerfile) — Gen:iA Code 처럼 Pod 가 받지 않는다.
# 함수 안 변수는 local 로 둔다 — lib.sh 는 전역 변수를 쓰므로 이름이 겹쳐 서로 덮지 않게. 일부러 내보내는 값(GW_SCRIPTS·AI_DIR·CODEX_HOME)만 전역이다.
# Pod 계약은 docs/integrations/agent-pod-contract.md. 맥(bash 3.2)에서도 돌게 쓴다. 로그인 정보·키 원문은 로그·명령줄에 남기지 않는다.

CODEX_PLUGIN_DIR=${CODEX_PLUGIN_DIR:-/opt/genia/plugin/genia-works} # 빌드 때 굳힌 genia-works 플러그인(codex 구동기 포함)
CODEX_BIN=${CODEX_BIN:-codex}                                        # 모델 목록을 물을 codex(테스트는 가짜로 바꾼다)
CODEX_MODELS_INTERVAL=${CODEX_MODELS_INTERVAL:-21600}                # 모델 목록 보고 간격(초) — 6시간
CODEX_MODELS_RETRY=${CODEX_MODELS_RETRY:-600}                        # 보고에 실패했을 때 다시 해 볼 때까지(초) — 회차(60초)마다 경고하지 않게
CODEX_MODELS_TIMEOUT=${CODEX_MODELS_TIMEOUT:-60}                     # codex debug models 를 기다리는 최대 초 — 넘으면 끊는다(감독이 멈추지 않게)

# 7 의 폴더 신뢰 훅(lib.sh) — Codex 구동기는 codex exec 에 --skip-git-repo-check·--dangerously-bypass-approvals-and-sandbox 를 넘겨
# 신뢰 물음이 없다. ~/.claude.json 은 쓰지 않는다.
trust_folders() { return 0; }

# 3. genia-works 플러그인 — 빌드 때 굳힌 것만 쓴다. 이미지와 플러그인이 같은 릴리스로 함께 빌드되므로(카탈로그 paths 가 plugins/genia-works/ 를
#    본다) 마켓플레이스에서 따로 받지 않는다. 칸 명령(agent-project 의 codex 분기 → gw-codex-loop)이 부르는 구동기(codex/driver.mjs)가 있어야 한다.
#    확인·고르기는 lib.sh 의 use_baked_plugin.
use_plugin() { use_baked_plugin "$CODEX_PLUGIN_DIR" codex; }

# 4. Codex 환경 — 설정·로그인·대화 기록 폴더(CODEX_HOME)를 AI 폴더(/work, 영속) 아래로(codex 가 스스로 갱신한 로그인과 이어 받을 대화가
#    Pod 를 다시 만들어도 남게). tmux 서버(첫 칸)가 뜨기 전에 내보내 칸(gw-codex-loop → codex exec)이 물려받게 한다.
codex_env() {
  export CODEX_HOME="$AI_DIR/codex"
  mkdir -p "$CODEX_HOME" && chmod 700 "$CODEX_HOME"
}

# 5. Codex 설정(config.toml) — 매번 덮어쓴다(재생성된 Pod 에 옛 값이 남지 않게). 넣는 것은 사람 없는 칸에 필요한 최소 키뿐이다:
#    - cli_auth_credentials_store = "file": 로그인을 $CODEX_HOME/auth.json 에 둔다(키링을 고르면 시딩한 보관본을 읽지 않는다).
#    - check_for_update_on_startup = false: 버전은 이미지가 고정한다.
#    - model·model_reasoning_effort: config.json 의 model·effort(비었거나 꼴이 이상하면 넣지 않고 codex 기본값을 쓴다).
#    MCP·무승인 실행·키 보호 hook 은 구동기(codex/lib.mjs codexArgs)가 -c 로 넘긴다 — 여기 적으면 두 곳이 어긋날 수 있어 적지 않는다.
#    (11-06 codex 0.164 로 확인: 아는 키는 타입을 검사하고 — 이 넷 모두 — 모르는 키는 조용히 무시한다.)
#    write_codex_config [<추론 강도>] — 인자를 주면 config.json 의 effort 대신 그 값을 쓴다(모델이 받지 않는 강도를 바로잡을 때 —
#    codex_fit_effort). 실제로 적은 강도를 CODEX_EFFORT_APPLIED 에 둔다.
CODEX_EFFORT_APPLIED=""
write_codex_config() {
  local model effort out
  model=$(config_get '(.config.model // "") | tostring') || return 1
  effort=$(config_get '(.config.effort // "") | tostring') || return 1
  [ -n "${1:-}" ] && effort=$1
  CODEX_EFFORT_APPLIED=""
  out='# Works 엔트리포인트가 Pod 를 띄울 때마다 새로 쓴다 — 고쳐도 다음에 덮인다(AI 상세 › 실행 설정에서 바꾼다).
cli_auth_credentials_store = "file"
check_for_update_on_startup = false'
  if safe_model_id "$model"; then
    out="$out
model = \"$model\""
  elif [ -n "$model" ]; then
    log "경고: 모델 값의 꼴이 이상해 넣지 않습니다 — Codex 기본 모델로 띄웁니다"
  fi
  case "$effort" in
    '') ;;
    *[!a-z]*) log "경고: 추론 강도 값의 꼴이 이상해 넣지 않습니다 — Codex 기본값으로 띄웁니다" ;;
    *)
      out="$out
model_reasoning_effort = \"$effort\""
      CODEX_EFFORT_APPLIED=$effort
      ;;
  esac
  gw_write_atomic "$CODEX_HOME/config.toml" "$out"
}

# 5b. 전역 지시(AGENTS.md) — superpowers 의 세션 시작 안내(using-superpowers)를 Codex 에 싣는다. Claude 는 superpowers 의 SessionStart hook 이,
#     Gen:iA Code 는 superpowers 의 genia 확장이 이 안내를 넣는데, Codex 는 스킬을 목록으로만 보이고 세션 시작 hook 을 돌리지 않는다
#     (superpowers 의 .codex-plugin 은 hooks 를 비워 두고 Codex 용 안내 글도 따로 싣지 않는다 — 7.0.x 확인). 안내가 없으면 모델이 계획·SDD 단계를
#     건너뛰기 쉽다. Codex 는 $CODEX_HOME/AGENTS.md 를 모든 세션의 전역 지시로 읽으므로(11-06 codex debug prompt-input 확인) 여기에 짧은 지시를
#     매번 새로 쓴다. 본문과 스킬이 없을 때의 처리는 lib.sh 의 write_superpowers_agents_md 가 하고, 여기서는 Codex 의 경로와 스킬 부르기·도구 이름 대응 항목만 넘긴다.
CODEX_SUPERPOWERS_SKILL=${CODEX_SUPERPOWERS_SKILL:-$HOME/.agents/skills/superpowers/using-superpowers/SKILL.md}
write_codex_agents_md() {
  write_superpowers_agents_md "$CODEX_HOME/AGENTS.md" "$CODEX_SUPERPOWERS_SKILL" \
    "- 어떤 일을 하든(질문에 답하기 전 포함) 맞는 스킬이 있는지 먼저 확인하고, 있으면 그 스킬 파일을 읽어 그 절차대로 한다.
- 스킬 안의 Claude Code 전용 도구 이름(Skill·Task 등)은 Codex 에서 같은 일을 하는 도구로 바꿔 쓴다 — using-superpowers 의 references/codex-tools.md 를 본다."
}

# 6. 로그인 정보 시딩(계약 「로그인 정보」) — 보관본 $CODEX_HOME/auth.json(규칙은 lib.sh 의 seed_login_file). 로그인이 없으면 codex exec 가
#    인증 오류로 끝나 work-loop 가 돌지 않으므로 can_launch 가 막는다. 연결을 새로 하면 runner 가 Pod 를 다시 만든다.
seed_login() { seed_login_file "$CODEX_HOME/auth.json" ChatGPT; }

# 칸을 띄울 수 있는지(lib.sh tick 의 훅) — 로그인 정보가 있을 때만. 아니면 칸도 알림 감시 창도 띄우지 않고 모델 목록도 묻지 않는다.
can_launch() { login_file_ready "$CODEX_HOME/auth.json"; }

# 감독 회차마다 칸 살피기 전(lib.sh tick 의 훅) — 로그인이 있으면 때가 된 모델 목록 보고(report_models). 첫 회차에는 칸이 아직 없어 로그인
# 갱신이 겹치지 않고(report_models 머리 주석), 받은 목록으로 맞춘 추론 강도로 칸이 처음부터 뜨며, start_projects(저장소 받기)가 길어도
# 화면의 모델 선택지가 일찍 채워진다.
before_supervise() {
  if can_launch; then report_models; fi
  return 0
}

# codex debug models 출력 → gw-models 본문. 칸에 보이는 것(visibility list)만 priority 순으로, {id, label, efforts}.
# 목록이 비면 실패(1) — 빈 목록을 보내 Works 의 선택지를 지우지 않게.
CODEX_MODELS_JQ='{ models: ([.models[]? | select(.visibility == "list")] | sort_by(.priority)
  | map({ id: .slug, label: (.display_name // .slug), efforts: [(.supported_reasoning_levels // [])[] | .effort] })) }
  | if (.models | length) > 0 then . else error("empty") end'

# 추론 강도 맞추기 — 템플릿의 강도 선택지(low~max)는 모든 모델에 공통이 아니다(11-06: gpt-5.5 는 max 를 받지 않는다). 받은 모델 목록(<파일> —
# codex debug models 그대로)에서 고른 모델이 설정한 강도를 받으면 설정값, 아니면 그 모델의 default_reasoning_level 이 config.toml 에 있어야 할
# 값이다. 목록에 그 모델이 없으면(또는 목록을 못 받으면 — 부르지 않는다) 판단할 근거가 없어 그대로 둔다. 지금 적힌 값과 다를 때만 다시 쓴다
# (목록이 바뀌어 설정값을 다시 받게 되면 설정값으로 되돌아간다). 모델 목록 보고가 받은 출력을 함께 써 codex 를 더 부르지 않는다.
codex_fit_effort() {
  local model effort want
  model=$(config_get '(.config.model // "") | tostring' 2>/dev/null)
  effort=$(config_get '(.config.effort // "") | tostring' 2>/dev/null)
  [ -n "$model" ] && [ -n "$effort" ] || return 0
  want=$(jq -r --arg m "$model" --arg e "$effort" '
      [.models[]? | select(.slug == $m)][0]
      | if . == null then ""
        elif ([(.supported_reasoning_levels // [])[] | .effort] | index($e)) != null then $e
        else (.default_reasoning_level // "") end' "$1" 2>/dev/null)
  case "$want" in '' | *[!a-z]*) return 0 ;; esac
  [ "$want" != "$CODEX_EFFORT_APPLIED" ] || return 0
  write_codex_config "$want" || return 0
  if [ "$want" = "$effort" ]; then
    log "모델 $model 이 추론 강도 $effort 를 받게 되어 설정값으로 되돌렸습니다"
  else
    log "경고: 모델 $model 은 추론 강도 $effort 를 받지 않아 그 모델의 기본값 $want 으로 띄웁니다 — 실행 설정에서 고르세요"
  fi
}

# 칸의 codex 가 도는지 — 구동기(codex/driver.mjs)는 `codex exec [resume] --json -o … --skip-git-repo-check …` 로 부른다(npm 판은 node 의
# bin/codex.js 와 그것이 띄운 실행 파일 둘 다 이 인자를 단다). 이 컨테이너에는 칸 말고 codex exec 를 띄우는 것이 없다. 패턴은 테스트가 바꾼다.
CODEX_EXEC_PATTERN=${CODEX_EXEC_PATTERN:-codex[^ ]* exec .*--skip-git-repo-check}
codex_panes_busy() {
  pgrep -f -- "$CODEX_EXEC_PATTERN" >/dev/null 2>&1
}

# 모델 목록을 한 번 받아 추론 강도를 맞추고 Works 에 알린다 — 실패면 사유를 경고 한 줄로 남기고 0 이 아닌 값.
#   codex 는 CODEX_MODELS_TIMEOUT 초 안에 끝나야 한다(bg_wait_timeout) — 감독 회차가 여기서 멈추면 칸을 띄우지도 살피지도 못한다.
#   codex 의 stderr 는 버린다(로그인 오류 문구에 무엇이 섞일지 모른다) — 실패는 종료 코드만. 받은 목록·본문은 /work/tmp 의 600 파일로만 다룬다.
#   옛 플러그인(gw-models 없음)이면 한 번만 알리고 강도 맞추기만 한 뒤 성공으로 친다.
#   gw-models 는 늘 0 으로 끝나고 실패 사유를 stderr 한 줄로만 낸다(비밀 없음) — 그 줄이 있으면 로그에 옮기고 실패로 친다(6시간 기다리지 않게).
#   마지막 성공 시각을 $AI_DIR/state/models-reported 에 적는다(밖에서 볼 수 있게).
codex_models_report_once() {
  local gw="$GW_SCRIPTS/gw-models" raw body err rc
  # 옛 플러그인 알림은 목록 받기와 상관없이 먼저 한 번 — 받기가 계속 실패해도 「알릴 곳이 없다」는 사실은 보이게.
  if [ ! -x "$gw" ] && [ -z "${CODEX_MODELS_WARNED:-}" ]; then
    log "경고: 이 플러그인 버전에는 gw-models 가 없습니다 — Codex 모델 목록을 Works 에 알리지 못합니다"
    CODEX_MODELS_WARNED=1
  fi
  raw=$(mktemp "$GENIA_WORK/tmp/codex-models.XXXXXX") || {
    log "경고: 모델 목록을 받을 임시 파일을 $GENIA_WORK/tmp 에 만들지 못했습니다 — $CODEX_MODELS_RETRY 초 뒤 다시 합니다"
    return 1
  }
  body="$raw.body"
  err="$raw.err"
  bg_wait_timeout "$CODEX_MODELS_TIMEOUT" "$CODEX_BIN" debug models > "$raw" 2>/dev/null </dev/null
  rc=$?
  if [ "$rc" != 0 ]; then
    log "경고: Codex 모델 목록을 읽지 못했습니다(codex 종료 코드 $rc — 128 이상은 $CODEX_MODELS_TIMEOUT 초 제한으로 끊은 것) — $CODEX_MODELS_RETRY 초 뒤 다시 합니다"
  else
    codex_fit_effort "$raw"
    if [ ! -x "$gw" ]; then
      : # 알릴 곳이 없다(위에서 한 번 알렸다) — 강도만 맞추고 성공으로 친다.
    elif ! (umask 077 && jq -c "$CODEX_MODELS_JQ" "$raw" > "$body" 2>/dev/null); then
      rc=1
      log "경고: Codex 모델 목록의 형식이 다르거나 비었습니다 — $CODEX_MODELS_RETRY 초 뒤 다시 합니다"
    else
      # 신원은 이 AI — 엔트리포인트 셸에는 칸과 달리 GENIA_WORKS_AS 가 없어 여기서 넘긴다(키는 gw-models 가 키 저장소에서 읽는다). stdout 은 버린다.
      GENIA_WORKS_AS="$GENIA_AGENT_NAME" "$gw" < "$body" >/dev/null 2> "$err"
      if [ -s "$err" ]; then
        rc=1
        log "경고: $(head -n 1 "$err") — $CODEX_MODELS_RETRY 초 뒤 다시 합니다"
      else
        date +%s > "$AI_DIR/state/models-reported" 2>/dev/null
        log "Codex 모델 목록을 알렸습니다($(jq '.models | length' "$body" 2>/dev/null)개)"
      fi
    fi
  fi
  rm -f "$raw" "$body" "$err"
  return "$rc"
}

# 모델 목록 보고 — 로그인으로 codex 가 받는 모델 목록(계정마다 다르다)을 Works 에 알리고 추론 강도를 맞춘다(codex_models_report_once).
# 언제: 로그인이 있는 첫 감독 회차에 칸을 띄우기 전(before_supervise — tick 이 supervise_once 보다 먼저 부른다), 그 뒤 CODEX_MODELS_INTERVAL
#   (6시간)마다. 실패하면 CODEX_MODELS_RETRY(10분) 뒤(회차마다 경고하지 않게).
# 왜 칸이 쉴 때만: ChatGPT 로그인의 갱신 토큰은 1회용이다. codex debug models 와 칸의 codex exec 가 같은 auth.json 으로 동시에 토큰을
#   새로 고치면 한쪽이 이미 쓰인 갱신 토큰을 내밀어 로그인이 풀릴 수 있다. 그래서 칸의 codex exec 가 돌고 있으면(codex_panes_busy) 묻지 않고
#   CODEX_MODELS_RETRY 뒤 다시 본다 — 구동기는 work-loop 한 번을 부르는 동안만 codex 를 띄우므로 쉬는 틈이 생긴다.
# 시각은 셸의 SECONDS(시작 뒤 초)로 잰다 — 회차(60초)마다 date 를 띄우지 않게.
CODEX_MODELS_NEXT=0
report_models() {
  [ "$SECONDS" -ge "$CODEX_MODELS_NEXT" ] || return 0
  if codex_panes_busy; then
    log "칸의 codex 가 도는 중이라 모델 목록 묻기를 $CODEX_MODELS_RETRY 초 미룹니다(로그인 갱신이 겹치지 않게)"
    CODEX_MODELS_NEXT=$((SECONDS + CODEX_MODELS_RETRY))
  elif codex_models_report_once; then
    CODEX_MODELS_NEXT=$((SECONDS + CODEX_MODELS_INTERVAL))
  else
    CODEX_MODELS_NEXT=$((SECONDS + CODEX_MODELS_RETRY))
  fi
  return 0
}
