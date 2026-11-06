# workplace-agent-codex

Works 가 띄우는 AI Pod 의 Codex 작업 공간 이미지다(WP-1297, 템플릿 `codex`). runner(`apps/workplace-agent-runner`)가 Pod 를 만들면, 이 이미지의 엔트리포인트가 Codex(ChatGPT 구독 로그인)·플러그인·저장소·work-loop 칸을 사람 손 없이 띄우고 지킨다. Pod 와 무엇을 주고받는지는 [agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md)에 있다. 모양은 Gen:iA Code 이미지([workplace-agent-genia-code](../workplace-agent-genia-code))를 따르고, 공용 함수(`bin/lib.sh`)와 작업 화면(`bin/agent-screen`)은 Claude Code 이미지([workplace-agent-claude-code](../workplace-agent-claude-code))의 파일을 그대로 COPY 해 쓴다.

## 들어 있는 것

- 베이스 `mcr.microsoft.com/playwright:v1.60.0-noble`. 도구 블록은 Gen:iA Code 이미지와 글자까지 같다(tmux, git, gh, glab, jq, tini, OpenJDK 21, docker CLI·compose v2, pnpm(corepack), Noto CJK 글꼴, Claude Code CLI). 한쪽을 바꾸면 다른 쪽도 함께 바꾼다(테스트가 두 블록을 맞춰 본다).
- Codex CLI `@openai/codex` 고정 버전(`ARG CODEX_VERSION`, 지금 0.167.0). 공개 패키지라 이미지에 넣는다. 올리면 구동기(`plugins/genia-works/codex`)의 `exec`·`resume`·`-c` 인자와 아래 config.toml 키가 그대로 먹는지 확인한다.
- genia-works 플러그인: 빌드할 때 저장소의 `plugins/genia-works` 중 Codex 구동기가 쓰는 것(`package.json`·`.claude-plugin`·`codex`·`genia`(구동기가 import 하는 `loop.js`)·`hooks`(`loop.js` 가 import 하는 `lib.js`)·`scripts`·`skills`)만 `/opt/genia/plugin/genia-works` 에 넣는다. Pod 가 뜰 때 마켓플레이스에서 따로 받지 않는다 — 이미지와 플러그인이 같은 릴리스로 함께 빌드된다(카탈로그 paths 가 `plugins/genia-works/` 를 본다).
- 개발 절차 플러그인(WP-1336): Claude Code CLI(실행하지 않고 받는 데만 쓴다)로 Claude 이미지의 [plugins.lock](../workplace-agent-claude-code/plugins.lock)을 `genia-works` 만 빼고 받은 뒤, `skills/` 가 있는 플러그인(superpowers·frontend-design)의 그 폴더를 Codex 가 읽는 `~/.agents/skills/<플러그인 이름>` 으로 링크한다. 에이전트 형식이라 Codex 가 읽지 못하는 `code-simplifier` 는 Gen:iA Code 이미지가 스킬로 옮긴 것(`../workplace-agent-genia-code/skills/code-simplifier`)을 같은 자리에 COPY 한다. 명령(commands) 형식(code-review·feature-dev)은 Codex 가 읽지 못한다.
- `/opt/genia/bin/`: `entrypoint`·`lib-codex.sh`(이 앱), `lib.sh`·`agent-screen`(Claude Code 이미지).
- 사용자 `agent`(UID/GID 1001). jdtls·TS 언어 서버는 넣지 않는다.

Codex 가 스킬을 찾는 자리(11-06 codex 0.164 `codex debug prompt-input` 으로 확인): `~/.agents/skills`, `$CODEX_HOME/skills`, 작업 폴더의 `.agents/skills`. 링크 폴더 안의 스킬 폴더까지 찾는다. `~/.codex/skills` 는 `CODEX_HOME` 이 다른 곳이면 읽지 않는다.

## 엔트리포인트 (`bin/entrypoint`, 함수는 `lib.sh` + `bin/lib-codex.sh`)

1. 필수 파일·env 를 확인하고 `/work` 아래 폴더를 만든다(lib.sh). 위치의 추가 CA 가 있으면 시스템 CA 와 합친다(`setup_ca`).
2. `use_plugin`: 이미지에 굳힌 플러그인(`codex/driver.mjs` 가 있어야 한다)을 쓰고 플러그인 공용 함수(`gw-lib.sh`)를 읽는다.
3. `codex_env`: `CODEX_HOME=$AI_DIR/codex`(영속, 700). tmux 서버가 뜨기 전에 내보내므로 칸이 물려받는다 — 로그인·대화 기록(이어 받기)이 Pod 를 다시 만들어도 남는다.
4. `write_codex_config`: `$CODEX_HOME/config.toml` 을 매번 새로 쓴다. 넣는 것은 `cli_auth_credentials_store = "file"`(로그인을 `auth.json` 파일로), `check_for_update_on_startup = false`, `model`·`model_reasoning_effort`(config.json 의 `model`·`effort` — 비었거나 꼴이 이상하면 빼고 Codex 기본값)뿐이다. MCP·무승인 실행·키 보호 hook 은 구동기가 `-c` 로 넘기므로 적지 않는다.
5. `write_codex_agents_md`: `$CODEX_HOME/AGENTS.md`(Codex 가 모든 세션에 싣는 전역 지시)를 매번 새로 쓴다 — 세션을 시작하면 먼저 `~/.agents/skills/superpowers/using-superpowers/SKILL.md` 를 읽고 따르라는 짧은 지시다. Claude 는 superpowers 의 SessionStart hook, Gen:iA Code 는 superpowers 의 genia 확장이 이 안내를 넣지만, Codex 는 세션 시작 hook 이 없고 superpowers 도 Codex 용 안내 글을 싣지 않는다(스킬 목록만 보인다). 스킬이 없으면 경고하고 파일을 지운다.
6. `seed_login`: 로그인 정보(`/run/genia/login-info` — ChatGPT 로그인의 `auth.json`)를 `$CODEX_HOME/auth.json`(600)에 심는다. 표식 `$AI_DIR/state/login-version` 이 `GENIA_LOGIN_VERSION` 과 다를 때만 복사한다 — codex 가 토큰을 스스로 갱신해 다시 쓴 파일을 옛 Secret 값으로 덮지 않는다. 마운트가 없으면 보관본과 표식을 지운다. 로그인 정보가 없으면 경고만 남기고 **칸을 띄우지 않는다**.
7. AI 키·git·저장소 자격 증명·dind 를 준비한다(lib.sh). 그다음 `agent-home set cli codex` 로 실행기를 codex 로 적는다. 칸 명령은 플러그인 `agent-project` 의 codex 분기(`gw-codex-loop "<키> --queue …"` → `codex/driver.mjs` 가 `codex exec`/`exec resume` 으로 work-loop 를 부른다)다.
8. 감독(60초마다 `tick`): 로그인이 있으면 `report_models`(아래 — 첫 회는 칸을 띄우기 전) 다음 lib.sh 의 `supervise_once`(처음이면 맡은 프로젝트마다 저장소를 받고 칸을 띄우고, 그 뒤 죽은 칸 되살리기·6일 넘은 칸 다시 띄우기·알림 감시 창). SIGTERM 정리는 Claude Code 이미지와 같다.

### 모델 목록 보고 (`report_models`)와 추론 강도 맞추기

ChatGPT 로그인은 갱신 토큰이 1회용이라 Works 서버가 저장된 로그인으로 모델 목록을 물으면 Pod 안 codex 의 로그인이 풀린다. 그래서 Pod 가 묻고 알린다: `codex debug models` 를 돌려 `visibility == "list"` 만 `priority` 순으로 `{"models":[{"id":slug,"label":display_name,"efforts":[…]}]}` 로 바꿔 플러그인 `gw-models` 에 표준 입력으로 넘긴다(신원은 이 AI).

- **언제**: 로그인이 있는 첫 감독 회차에 **칸을 띄우기 전**에 한 번, 그 뒤 6시간(`CODEX_MODELS_INTERVAL`)마다.
- **칸이 쉴 때만**: 같은 1회용 갱신 토큰 때문에, `codex debug models` 와 칸의 `codex exec` 가 같은 `auth.json` 으로 동시에 토큰을 새로 고치면 한쪽이 이미 쓰인 토큰을 내밀어 로그인이 풀릴 수 있다. 그래서 칸의 codex(구동기가 띄우는 `codex exec … --skip-git-repo-check`, `pgrep -f` 로 찾는다)가 돌고 있으면 묻지 않고 10분(`CODEX_MODELS_RETRY`) 뒤 다시 본다. 구동기는 work-loop 한 번을 부르는 동안만 codex 를 띄우므로 쉬는 틈이 생긴다. 첫 회에는 칸이 아직 없어 겹치지 않는다.
- **추론 강도 맞추기**: 템플릿의 강도 선택지(low~max)는 모든 모델에 공통이 아니다(예: gpt-5.5 는 max 를 받지 않는다). 받은 목록에서 고른 모델의 `supported_reasoning_levels` 에 설정한 강도가 없으면 config.toml 을 그 모델의 `default_reasoning_level` 로 다시 쓰고 경고 한 줄을 남긴다. 목록에 그 모델이 없거나 목록을 받지 못하면 설정값 그대로다. 나중에 받게 되면 설정값으로 되돌린다. 보고와 같은 한 번의 `codex debug models` 출력을 쓴다 — 첫 회가 칸보다 먼저라 칸은 처음부터 맞춘 강도로 뜬다.
- **실패**: codex 는 60초(`CODEX_MODELS_TIMEOUT`) 안에 끝나야 한다 — 넘으면 끊어 감독 회차가 멈추지 않게 한다. 실패(codex 오류·시간 초과·빈 목록·형식 다름, 그리고 `gw-models` 가 stderr 로 알린 보고 실패)는 경고 한 줄(codex 의 stderr 는 버리고 종료 코드만)과 10분 뒤 다시 시도다. 플러그인에 `gw-models` 가 없으면 한 번만 알리고 강도 맞추기만 한다. 마지막 성공 시각은 `$AI_DIR/state/models-reported`.

## 테스트·빌드

```sh
pnpm --filter @smart-workplace/workplace-agent-codex test   # node --test tests/*.test.mjs (tmux 필요)
docker build --platform linux/amd64 -f apps/workplace-agent-codex/Dockerfile .   # 컨텍스트는 저장소 루트
```

테스트는 PATH 앞의 가짜 codex(모델 목록 JSON 을 내고, `exec` 면 받은 env·인자를 남기고 기다린다)와 가짜 `gw-models` 를 쓰고, 그 밖의 플러그인 스크립트·Codex 구동기는 저장소의 진짜 것을 쓴다.
