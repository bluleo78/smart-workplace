# OpenCode 작업 공간 엔트리포인트의 전용 함수(WP-1410) — Claude Code 이미지의 lib.sh 를 먼저 읽고 이 파일을 뒤에 읽는다(같은 이름은 덮어쓴다).
# 공용(필수 확인·폴더·추가 CA·키·git·dind·프로젝트·감독·정리·adopt_plugin_scripts·use_baked_plugin·write_superpowers_agents_md·bg_wait)은 lib.sh 그대로, 여기에는 OpenCode 만의 일을 둔다:
#   - 플러그인 고르기(use_plugin) — 빌드 때 굳힌 genia-works(opencode 구동기 포함)만 쓴다.
#   - OpenCode 환경·설정·전역 지시(opencode_env·write_opencode_config·write_opencode_agents_md) — 모델 서버 연결은 Works 의 「OpenAI 호환」
#     연결 정보(/run/genia/login-info)를 $HOME/.config/opencode/opencode.json 으로 옮겨 만든다,
#   - 감독 회차 훅(can_launch — tick 은 lib.sh).
# OpenCode(opencode-ai)는 공개 패키지라 이미지에 고정 버전으로 넣는다(Dockerfile) — Gen:iA Code 처럼 Pod 가 받지 않는다.
# Codex 와 달리 모델 목록은 Pod 가 보고하지 않는다 — 연결은 정적 API 키라 서버가 모델 서버에 직접 물어 실시간 목록을 쓴다(report_models 없음).
# 함수 안 변수는 local 로 둔다 — lib.sh 는 전역 변수를 쓰므로 이름이 겹쳐 서로 덮지 않게. 일부러 내보내는 값(GW_SCRIPTS·AI_DIR·XDG_DATA_HOME·OPENCODE_*)만 전역이다.
# Pod 계약은 docs/integrations/agent-pod-contract.md. 맥(bash 3.2)에서도 돌게 쓴다. 연결 정보(API 키 포함)·키 원문은 로그·명령줄에 남기지 않는다.

OPENCODE_PLUGIN_DIR=${OPENCODE_PLUGIN_DIR:-/opt/genia/plugin/genia-works} # 빌드 때 굳힌 genia-works 플러그인(opencode 구동기 포함)
OPENCODE_CONFIG_FILE=${OPENCODE_CONFIG_FILE:-$HOME/.config/opencode/opencode.json} # OpenCode 가 전역 설정으로 읽는 자리(XDG_CONFIG_HOME 기본값)

# 7 의 폴더 신뢰 훅(lib.sh) — OpenCode 는 폴더 신뢰 물음이 없다(구동기가 permission "allow" 로 돌린다). ~/.claude.json 은 쓰지 않는다.
trust_folders() { return 0; }

# 3. genia-works 플러그인 — 빌드 때 굳힌 것만 쓴다. 이미지와 플러그인이 같은 릴리스로 함께 빌드되므로(카탈로그 paths 가 plugins/genia-works/ 를
#    본다) 마켓플레이스에서 따로 받지 않는다. 칸 명령(agent-project 의 opencode 분기 → gw-opencode-loop)이 부르는 구동기(opencode/driver.mjs)가 있어야 한다.
use_plugin() { use_baked_plugin "$OPENCODE_PLUGIN_DIR" opencode; }

# 4. OpenCode 환경 — tmux 서버(첫 칸)가 뜨기 전에 내보내 칸(gw-opencode-loop → opencode run)이 물려받게 한다.
#    - XDG_DATA_HOME: OpenCode 의 대화 기록(sqlite — 구동기가 `-s <세션>` 으로 이어 받는다)을 AI 폴더(/work, 영속) 아래로. 홈은 Pod 를 다시
#      만들면 사라지므로 두지 않는다. 설정은 홈에 둔다(매번 새로 쓰는 파일이라 영속이 필요 없다).
#    - OPENCODE_DISABLE_AUTOUPDATE: 버전은 이미지가 고정한다.
#    - OPENCODE_DISABLE_MODELS_FETCH: 모델 정보(models.dev)를 인터넷에서 받지 않는다 — 모델은 연결 정보로만 정하고, 닿지 않는 망에서 시작이 늦어지지 않게.
opencode_env() {
  export XDG_DATA_HOME="$AI_DIR/opencode/data"
  export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
  mkdir -p "$XDG_DATA_HOME" "$(dirname "$OPENCODE_CONFIG_FILE")" && chmod 700 "$AI_DIR/opencode" "$(dirname "$OPENCODE_CONFIG_FILE")"
}

# 모델 서버 연결 정보를 담은 JSON 이 쓸 수 있는 꼴인지 — 객체이고 providerId 가 안전한 글자의 문자열이며 options 가 객체.
opencode_login_ok() {
  jq -e 'type == "object"
         and (.providerId | type == "string" and test("^[A-Za-z0-9._-]+$"))
         and (.options | type == "object")' "$1" >/dev/null 2>&1
}

# 5. 설정(opencode.json) — 매번 덮어쓴다(재생성된 Pod 에 옛 값이 남지 않게, 연결을 끊으면 지운다). 모든 값은 jq 로만 조립하고(셸 문자열에
#    넣지 않는다) 연결 정보 원문(API 키)은 명령줄·로그에 두지 않는다 — jq 는 파일을 읽는다. 쓰기는 gw_write_atomic(임시 파일 → 600 → mv).
#    들어가는 것:
#    - provider.<providerId>: npm(기본 @ai-sdk/openai-compatible)·name(기본 providerId)·options(baseURL·apiKey 등 그대로)·models(연결 정보에 있으면
#      그것 + 고른 모델 한 항목). vision·defaultModel 등 OpenCode 가 모르는 키는 provider 에 넣지 않는다 — 모르는 키는 설정 검증에서 거절된다.
#      vision 이 이 모델에 true 면 모델 항목에 이미지 입력(modalities)을 선언한다(선언이 없으면 OpenCode 가 이미지를 버린다 — ai-agent 의 opencode 러너와 같은 규칙).
#    - model: "<providerId>/<모델 id>" — 템플릿 config.json 의 model 이 auto 가 아니고 이 providerId 로 시작하면 그것, 아니면(auto·비었음·다른
#      연결의 값) 연결 정보의 defaultModel(「연결에 지정한 모델」 — 이 providerId 접두일 때만)이다. 둘 다 없거나 defaultModel 이 접두가 맞지
#      않으면 만들지 않고 이유를 로그로 남겨 칸을 띄우지 않는다.
#    - permission "allow"·autoupdate false·share "disabled": 사람 없는 칸이라 도구가 묻지 않고, 버전은 이미지가 고정하며, 대화를 공유 서버로 올리지 않는다.
#    MCP·플러그인(키 보호)은 구동기가 OPENCODE_CONFIG_CONTENT 로 넘긴다 — 두 곳이 어긋나지 않게 여기 적지 않는다(설정은 병합된다).
#    로그인 정보(연결)가 없거나 꼴이 이상하거나 모델을 정할 수 없으면 옛 설정을 지우고 1 을 돌려준다(can_launch 가 막는다).
write_opencode_config() {
  local src="$GENIA_RUN_DIR/login-info" dst="$OPENCODE_CONFIG_FILE" pid cfg_model def_model full mid out
  if [ ! -s "$src" ]; then
    rm -f "$dst"
    log "경고: OpenAI 호환 연결 정보가 연결되지 않았습니다 — 관리 화면에서 연결하세요(연결 전에는 칸을 띄우지 않습니다)"
    return 1
  fi
  if ! opencode_login_ok "$src"; then
    rm -f "$dst"
    log "오류: 연결 정보의 꼴이 올바르지 않습니다(providerId 문자열·options 객체가 필요합니다) — 연결을 다시 하세요. 칸을 띄우지 않습니다"
    return 1
  fi
  pid=$(jq -r '.providerId' "$src")
  def_model=$(jq -r '.defaultModel | select(type == "string")' "$src" 2>/dev/null)
  cfg_model=$(config_get '(.config.model // "") | tostring' 2>/dev/null)
  # 모델 정하기 — 이 연결의 모델로 명시했으면 그것, 아니면 연결에 지정한 모델.
  full=""
  case "$cfg_model" in
    '' | auto) ;;
    "$pid"/?*) full=$cfg_model ;;
    *) log "경고: 설정한 모델 $cfg_model 은 이 연결($pid)의 모델이 아니라 쓰지 않습니다 — 연결에 지정한 모델로 띄웁니다" ;;
  esac
  if [ -z "$full" ] && [ -n "$def_model" ]; then
    # 연결에 지정한 모델은 「<providerId>/<모델 id>」 꼴이어야 한다(서버도 그 꼴이 아니면 null 로 보낸다). 접두가 없거나 다른 연결의 값이면
    # (옛 Claude 기본값 등) providerId 를 붙여 추측하지 않는다 — 없는 모델로 띄워 회차마다 실패하느니 「못 정함」으로 칸을 띄우지 않는다.
    case "$def_model" in
      "$pid"/?*) full=$def_model ;;
      *)
        rm -f "$dst"
        log "오류: 모델을 정할 수 없습니다 — 연결에 지정한 모델 $def_model 이 이 연결($pid)의 모델이 아닙니다. AI 설정에서 이 연결의 모델을 고르세요. 칸을 띄우지 않습니다"
        return 1
        ;;
    esac
  fi
  mid=${full#"$pid"/}
  if [ -z "$full" ]; then
    rm -f "$dst"
    log "오류: 모델을 정할 수 없습니다 — 설정의 모델이 auto 인데 OpenAI 호환 연결에도 지정한 모델이 없습니다. 연결에 모델을 지정하거나 AI 설정에서 모델을 고르세요. 칸을 띄우지 않습니다"
    return 1
  fi
  if ! safe_model_id "$mid"; then
    rm -f "$dst"
    log "오류: 모델 값의 꼴이 올바르지 않습니다 — 모델 id 는 영문·숫자와 . _ : / @ [ ] - 만 쓸 수 있습니다. 칸을 띄우지 않습니다"
    return 1
  fi
  out=$(jq --arg full "$full" --arg mid "$mid" '
    . as $li
    | ($li.vision) as $v
    | (if ($v | type) == "boolean" then $v
       elif ($v | type) == "object" then (if $v | has($full) then $v[$full] elif $v | has($mid) then $v[$mid] else null end)
       else null end) as $vision
    | (($li.models | select(type == "object")) // {}) as $models
    | (($models[$mid] | select(type == "object")) // {}) as $entry
    | {
        "$schema": "https://opencode.ai/config.json",
        autoupdate: false,
        share: "disabled",
        permission: "allow",
        provider: {
          ($li.providerId): {
            npm: (($li.npm | select(type == "string" and length > 0)) // "@ai-sdk/openai-compatible"),
            name: (($li.name | select(type == "string" and length > 0)) // $li.providerId),
            options: $li.options,
            models: ($models + { ($mid): ($entry + (if $vision == true then { modalities: { input: ["text", "image"], output: ["text"] } } else {} end)) })
          }
        },
        model: $full
      }' "$src") || {
    rm -f "$dst"
    log "오류: opencode.json 을 만들지 못했습니다(연결 정보를 읽지 못했습니다). 칸을 띄우지 않습니다"
    return 1
  }
  mkdir -p "$(dirname "$dst")" && gw_write_atomic "$dst" "$out" || {
    # 같은 Pod 안에서 컨테이너만 다시 뜨면 옛 설정이 남는다 — 지워야 칸 띄우기 확인이 옛 모델·연결로 통과하지 않는다.
    rm -f "$dst"
    log "오류: $dst 를 쓰지 못했습니다. 칸을 띄우지 않습니다"
    return 1
  }
  log "OpenCode 설정을 썼습니다(연결 $pid, 모델 $full)"
}

# 5b. 전역 지시(AGENTS.md) — superpowers 의 세션 시작 안내(using-superpowers)를 OpenCode 에 싣는다. Claude 는 superpowers 의 SessionStart hook 이,
#     Gen:iA Code 는 superpowers 의 genia 확장이 이 안내를 넣는데, OpenCode 는 스킬을 목록으로만 보이고 세션 시작 hook 이 없다(superpowers 가 따로
#     싣는 OpenCode 플러그인은 npm 으로 받아야 해 이미지에 넣지 않는다). 안내가 없으면 모델이 계획·SDD 단계를 건너뛰기 쉽다. OpenCode 는
#     ~/.config/opencode/AGENTS.md 를 모든 세션의 전역 지시로 읽으므로 여기에 짧은 지시를 매번 새로 쓴다. 본문과 스킬이 없을 때의 처리(경고·옛 파일
#     지우기)는 lib.sh 의 write_superpowers_agents_md 가 하고(WP-1445), 여기서는 OpenCode 의 경로와 스킬 부르기·도구 이름 대응 항목만 넘긴다.
OPENCODE_SUPERPOWERS_SKILL=${OPENCODE_SUPERPOWERS_SKILL:-$HOME/.agents/skills/superpowers/using-superpowers/SKILL.md}
write_opencode_agents_md() {
  write_superpowers_agents_md "$(dirname "$OPENCODE_CONFIG_FILE")/AGENTS.md" "$OPENCODE_SUPERPOWERS_SKILL" \
    "- 어떤 일을 하든(질문에 답하기 전 포함) 맞는 스킬이 있는지 먼저 확인하고, 있으면 skill 도구로 불러 그 절차대로 한다.
- 스킬 안의 Claude Code 전용 도구 이름은 OpenCode 의 같은 도구로 바꿔 쓴다: Skill → skill, Task(서브에이전트) → task, TodoWrite → todowrite,
  Read·Write·Edit·Bash·Grep·Glob → read·write·edit·bash·grep·glob."
}

# 칸을 띄울 수 있는지(lib.sh tick 의 훅) — 이번 부팅에서 opencode.json 을 만들었을 때만. 연결 정보가 없거나 모델을 못 정했으면 칸도 알림 감시
# 창도 띄우지 않는다(opencode run 이 모델 없음 오류로 끝나 work-loop 가 돌지 않는다). 연결·설정을 바꾸면 runner 가 Pod 를 다시 만든다.
can_launch() { [ -s "$OPENCODE_CONFIG_FILE" ]; }
