# workplace-agent-opencode

Works 가 띄우는 AI Pod 의 OpenCode 작업 공간 이미지다(WP-1410, 템플릿 `opencode`). runner(`apps/workplace-agent-runner`)가 Pod 를 만들면, 이 이미지의 엔트리포인트가 OpenCode(Works 의 「OpenAI 호환」 모델 서버 연결)·플러그인·저장소·work-loop 칸을 사람 손 없이 띄우고 지킨다. Pod 와 무엇을 주고받는지는 [agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md)에 있다. 모양은 Codex 이미지([workplace-agent-codex](../workplace-agent-codex))를 따르고, 공용 함수(`bin/lib.sh`)와 작업 화면(`bin/agent-screen`)은 Claude Code 이미지([workplace-agent-claude-code](../workplace-agent-claude-code))의 파일을 그대로 COPY 해 쓴다.

## 들어 있는 것

- 베이스 `mcr.microsoft.com/playwright:v1.60.0-noble`. 도구 블록은 Gen:iA Code 이미지와 글자까지 같다(tmux, git, gh, glab, jq, tini, OpenJDK 21, docker CLI·compose v2, pnpm(corepack), Noto CJK 글꼴, lsof·iproute2 등 포트·프로세스 확인 도구, playwright-cli 와 그 chromium·headless 기본 설정, Claude Code CLI). 한쪽을 바꾸면 다른 쪽도 함께 바꾼다(테스트가 두 블록을 맞춰 본다).
- OpenCode CLI `opencode-ai` 고정 버전(`ARG OPENCODE_VERSION`, 지금 1.18.31). 공개 npm 패키지라 이미지에 넣는다(플랫폼별 실행 파일은 npm 이 optionalDependencies 로 받아 잇는다). 올리면 구동기(`plugins/genia-works/opencode`)의 `run`·`--format json`·`-s` 인자, 구동기가 넘기는 `OPENCODE_CONFIG_CONTENT`, 그리고 아래 `opencode.json` 키가 그대로 먹는지 확인한다(OpenCode 는 설정에 모르는 키가 있으면 시작하지 않는다).
- genia-works 플러그인: 빌드할 때 저장소의 `plugins/genia-works` 중 OpenCode 구동기가 쓰는 것(`package.json`·`.claude-plugin`·`opencode`(구동기·키 보호 플러그인)·`genia`(구동기가 import 하는 `loop.js`)·`hooks`(`loop.js` 가 import 하는 `lib.js`)·`scripts`·`skills`)만 `/opt/genia/plugin/genia-works` 에 넣는다. Pod 가 뜰 때 마켓플레이스에서 따로 받지 않는다 — 이미지와 플러그인이 같은 릴리스로 함께 빌드된다(카탈로그 paths 가 `plugins/genia-works/` 를 본다).
- 개발 절차 플러그인(WP-1336): Claude Code CLI(실행하지 않고 받는 데만 쓴다)로 Claude 이미지의 [plugins.lock](../workplace-agent-claude-code/plugins.lock)을 `genia-works` 만 빼고 받은 뒤, `skills/` 가 있는 플러그인(superpowers·frontend-design)의 그 폴더를 OpenCode 가 읽는 `~/.agents/skills/<플러그인 이름>` 으로 링크한다. 에이전트 형식이라 스킬로 읽히지 않는 `code-simplifier` 는 Gen:iA Code 이미지가 스킬로 옮긴 것(`../workplace-agent-genia-code/skills/code-simplifier`)을 같은 자리에 COPY 한다. 명령(commands) 형식(code-review·feature-dev)은 읽지 못한다.
- `/opt/genia/bin/`: `entrypoint`·`lib-opencode.sh`(이 앱), `lib.sh`·`agent-screen`(Claude Code 이미지).
- 사용자 `agent`(UID/GID 1001). jdtls·TS 언어 서버는 넣지 않는다.

OpenCode 가 스킬을 찾는 자리(11-08 opencode 1.18.31 `opencode debug skill` 로 확인): `~/.agents/skills`·`~/.claude/skills`(외부 스킬 — 링크 폴더 안의 스킬 폴더까지 찾는다), `~/.config/opencode/skills`, 작업 폴더의 `.opencode/skills`. 이 이미지는 `~/.agents/skills` 를 쓴다(Codex 이미지와 같은 자리).

## 엔트리포인트 (`bin/entrypoint`, 함수는 `lib.sh` + `bin/lib-opencode.sh`)

1. 필수 파일·env 를 확인하고 `/work` 아래 폴더를 만든다(lib.sh). 가상 화면(Xvfb)을 띄우고(`start_display`) 위치의 추가 CA 가 있으면 시스템 CA 와 합친다(`setup_ca` — OpenCode 는 `NODE_EXTRA_CA_CERTS`(추가분)와 `SSL_CERT_FILE`(합친 번들)를 따른다. 자체서명 서버로 11-08 확인).
2. `use_plugin`: 이미지에 굳힌 플러그인(`opencode/driver.mjs` 가 있어야 한다)을 쓰고 플러그인 공용 함수(`gw-lib.sh`)를 읽는다.
3. `opencode_env`: `XDG_DATA_HOME=$AI_DIR/opencode/data`(영속, 700 — OpenCode 대화 기록, 구동기가 `-s` 로 이어 받는다), `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_MODELS_FETCH=1`(모델은 연결 정보로만 정한다). tmux 서버가 뜨기 전에 내보내므로 칸이 물려받는다.
4. `write_opencode_agents_md`: `~/.config/opencode/AGENTS.md`(OpenCode 가 모든 세션에 싣는 전역 지시)를 매번 새로 쓴다 — 세션을 시작하면 먼저 `~/.agents/skills/superpowers/using-superpowers/SKILL.md` 를 읽고 따르라는 짧은 지시와 Claude Code 도구 이름 → OpenCode 도구 이름 대응이다. OpenCode 에는 세션 시작 hook 이 없다. 스킬이 없으면 경고하고 파일을 지운다.
5. `write_opencode_config`: 연결 정보(`/run/genia/login-info`)와 `/run/genia/config.json` 의 `model` 로 `$HOME/.config/opencode/opencode.json`(600)을 매번 새로 쓴다(아래).
6. AI 키·git·저장소 자격 증명·dind 를 준비한다(lib.sh). 그다음 `agent-home set cli opencode` 로 실행기를 opencode 로 적는다. 칸 명령은 플러그인 `agent-project` 의 opencode 분기(`gw-opencode-loop "<키> --queue …"` → `opencode/driver.mjs` 가 `opencode run --format json` 으로 work-loop 를 부른다)다.
7. 감독(60초마다 `tick`): `can_launch`(= `opencode.json` 이 만들어졌을 때)면 lib.sh 의 `supervise_once`(처음이면 맡은 프로젝트마다 저장소를 받고 칸을 띄우고, 그 뒤 죽은 칸 되살리기·6일 넘은 칸 다시 띄우기·알림 감시 창). SIGTERM 정리는 Claude Code 이미지와 같다. Codex 와 달리 모델 목록 보고(`report_models`)는 없다 — 연결이 정적 API 키라 서버가 모델 서버에 직접 물어 실시간 목록을 쓴다.

### 설정 파일 만들기 (`write_opencode_config`)

연결 정보는 서버가 로그인 정보 경로(`GET …/secrets/login` → Secret `login-info` → `/run/genia/login-info`, env `GENIA_LOGIN_VERSION`)로 준다 — runner 는 그대로 전한다. 모양은 계약 문서 「OpenCode 연결 정보」: `providerId`·`options`{`baseURL`·`apiKey`…}·`npm`?·`name`?·`models`?·`vision`?·`defaultModel`(연결에 지정한 모델 `providerId/modelId`).

```json
{ "$schema": "https://opencode.ai/config.json", "autoupdate": false, "share": "disabled", "permission": "allow",
  "provider": { "<providerId>": { "npm": "@ai-sdk/openai-compatible", "name": "…", "options": { "baseURL": "…", "apiKey": "…" }, "models": { "<모델 id>": {} } } },
  "model": "<providerId>/<모델 id>" }
```

- **모델**: 템플릿 `config.json` 의 `model` 이 `auto` 가 아니고 `<providerId>/` 로 시작하면 그것, 아니면 `defaultModel`(서버는 이 연결의 `<providerId>/` 접두가 아닌 지정 모델을 null 로 보낸다. 접두가 없거나 다른 값이 오면 추측해 붙이지 않고 「모델을 정할 수 없음」으로 칸을 띄우지 않는다). 접두가 다른 값(연결을 바꿨는데 옛 값이 남음)은 경고하고 `defaultModel` 로 간다. 둘 다 없으면 이유를 로그에 남기고 칸을 띄우지 않는다 — 엔트리포인트는 끝내지 않는다(끝내면 kubelet 이 같은 generation 으로 다시 띄워 헛돈다). 모델 id 는 서버의 `ModelIds` 와 같은 글자만 받는다.
- `provider` 항목에는 `npm`·`name`·`options`·`models` 만 넣는다. `vision`·`defaultModel` 처럼 OpenCode 가 모르는 키는 넣지 않는다. 다만 `vision` 이 이 모델에 true 면 모델 항목에 이미지 입력(`modalities`)을 선언한다 — 선언이 없으면 OpenCode 가 이미지를 버린다.
- MCP 연결·키 보호 플러그인·permission 과 `lsp: false`·`formatter: false` 는 구동기가 `OPENCODE_CONFIG_CONTENT` 로 넘긴다. LSP·포매터를 끄는 까닭: OpenCode 가 스스로 띄우는 이 프로세스들은 셸 도구가 아니라 키 보호 플러그인의 `shell.env` 를 거치지 않아 AI 키 변수를 물려받고 저장소 코드(포매터·LSP 플러그인)를 돌리며, 이미지에 없는 언어 서버(jdtls 등)를 스스로 내려받는다. 검사·포맷은 work-loop 가 저장소 명령으로 돌린다. OpenCode 가 전역 설정과 병합한다(`opencode debug config` 로 확인 — 테스트가 진짜 opencode 가 있으면 한 번 읽혀 본다).
- 연결 정보(API 키 포함)는 `jq` 가 파일에서 읽어 조립하므로 명령줄·로그에 남지 않는다. 연결 정보가 없거나 꼴이 틀리면 옛 설정을 지우고 경고·오류만 남긴다. `opencode.json` 의 API 키는 같은 사용자의 도구(bash)가 읽을 수 있다 — Codex 의 `auth.json` 과 같은 보호 수준이다(키 보호 플러그인은 AI 키 env 와 도구 인자를 막는다).

## 테스트·빌드

```sh
pnpm --filter @smart-workplace/workplace-agent-opencode test   # node --test tests/*.test.mjs (tmux 필요)
docker build --platform linux/amd64 -f apps/workplace-agent-opencode/Dockerfile .   # 컨텍스트는 저장소 루트
```

테스트는 PATH 앞의 가짜 opencode(`--version` 에 답하고, `run` 이면 받은 env·인자를 남기고 기다린다)를 쓰고, 그 밖의 플러그인 스크립트·OpenCode 구동기는 저장소의 진짜 것을 쓴다. 진짜 `opencode` 가 PATH 에 있으면 만든 `opencode.json` 을 `opencode debug config` 로 읽혀 보는 테스트도 돈다(없으면 건너뜀).
