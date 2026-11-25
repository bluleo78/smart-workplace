# workplace-agent-claude-code

Works 가 띄우는 AI Pod 의 작업 공간 이미지다(WP-1252). runner(`apps/workplace-agent-runner`)가 Pod 를 만들면, 이 이미지의 엔트리포인트가 Claude Code·플러그인·저장소·work-loop 칸을 사람 손 없이 띄우고 지킨다. Pod 와 무엇을 주고받는지는 [agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md)에 있다.

## 들어 있는 것

- 베이스 `mcr.microsoft.com/playwright:v1.60.0-noble`. 개발용 작업 공간이라 DHI 규칙의 예외다(사유는 Dockerfile 머리에 있다).
- tmux, git, gh, glab(GitLab — 사용 통계·업데이트 확인 끔), jq, tini, OpenJDK 21, docker CLI·compose v2, pnpm(corepack)
- kubectl(WP-2136, 운영·PoC 서버와 같은 minor 로 고정) — 허용 목록 ServiceAccount 를 받은 배포 담당 AI 만 쓸 수 있다(그 밖의 AI 는 토큰이 없다, WP-2135·계약 문서 「클러스터 권한」)
- 포트·프로세스 확인 도구(WP-1404): lsof, ss·ip(iproute2), nc(BSD 판), netstat, fuser·killall, file, xxd, column, bc, zip, dig, ping, rsync, uuidgen — Mac 에 기본으로 있어 스크립트가 쓰는 명령
- playwright-cli(고정 버전, WP-1404) — 그 cli 가 품은 Playwright 의 chromium 을 `/ms-playwright` 에 굳히고, `~/.playwright/cli.config.json` 이 chromium headless 를 기본으로 둔다(`--config` 없이 `playwright-cli open <url>`). 엔트리포인트가 cli 설치를 PVC 브라우저 폴더의 `.links` 에 올려(`genia-playwright-cli`) 부팅 때 브라우저 정리(`browser-prune`)가 그 chromium 을 「쓰는 것」으로 남기게 하고, Xvfb 가상 화면(`DISPLAY=:99`)을 띄워 `--headed` 도 그리게 한다
- Claude Code `2.1.330`(npm 전역 설치, `DISABLE_AUTOUPDATER=1`). 버전은 고정하고 손으로 올린다 — 칸이 쓰는 Code Mode 가 실험 기능이라 릴리스마다 바뀔 수 있다. 올릴 때는 다른 실행기 이미지 세 개의 `CLAUDE_CODE_VERSION` 도 같이 올리고(테스트가 같은지 본다), 아래 「Code Mode 확인」을 다시 한다
- 언어 서버 jdtls, typescript-language-server
- 플러그인 8개: 빌드할 때 `/home/agent` 에 받아 이미지에 넣는다. 버전은 [plugins.lock](plugins.lock)에 고정한다. 받은 버전이 lock 과 다르면 빌드가 실패한다. superpowers 는 만든 사람의 마켓플레이스(`obra/superpowers-marketplace`)에서 받는다(최신을 바로 싣는다). Gen:iA Code 이미지도 이 lock 을 받는다(`genia-works` 만 빼고).
- 사용자 `agent`(UID/GID 1001)

## 엔트리포인트 (`bin/entrypoint`, 함수는 `bin/lib.sh`)

1. 필수 파일·env(`/run/genia/config.json`, `/run/genia/agent-key`, `GENIA_AGENT_NAME`)를 확인한다. 없으면 이유를 한 줄 남기고 종료 1. `/work` 아래 폴더를 만들고, 바로 `/work/tmp` 안을 모두 비운다 — 이때는 이 컨테이너의 어느 프로세스도 아직 tmp 를 쓰지 않아 지난 Pod 가 남긴 것뿐이다(WP-1683). 지우지 못한 것(root 소유 파일 등)이 있으면 경고만 남긴다.
2. genia-works 마켓플레이스를 이 Works 주소(`GENIA_WORKS_API_URL` 의 origin + `/claude/marketplace.json`)로 맞춘다. 그 주소에 닿으면 이미지에 넣어 둔 주소와 같든 다르든 지우고 다시 더한 뒤 genia-works 를 받는다(늘 서버의 버전). 닿지 않으면 이미지에 넣어 둔 것을 그대로 쓴다. 템플릿에 새로 넣은 플러그인도 받는다. 그다음 플러그인 스크립트 폴더를 찾아 플러그인 공용 함수(`gw-lib.sh`)를 읽는다 — 이 뒤로는 키 저장·검사·경로·파일 쓰기를 플러그인과 같은 규칙으로 한다.
3. `~/.claude/settings.json` 을 매번 새로 쓴다. 넣는 것: 모델, 켤 플러그인, 마켓플레이스(genia-works 는 2번에서 정한 주소·claude-plugins-official), genia-works MCP 주소(`GENIA_WORKS_MCP_URL`), Code Mode 를 켜는 `env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`(WP-1960 — 셸에는 내보내지 않는다).
4. `~/.claude.json` 에 온보딩 완료·bypass 확인·Code Mode 안내 확인(`codeModeCaveatsAcceptedV1`·`codeModeAutoModeCaveatAcceptedV1` — 없으면 칸이 opt-in 창에서 멈춘다)을 적고, AI 폴더와 저장소 폴더를 신뢰한다고 적는다. 상위 폴더를 신뢰하면 하위 폴더도 신뢰된다.
5. AI 키를 플러그인의 `gw-keys add` 로 둔다(형식 검사, 600). git 신원을 정하고, GitHub 토큰은 표준 입력으로 넘겨 `gh auth login` 한 뒤 `gh auth setup-git` 하고, GitLab 토큰은 호스트마다 git 자격 증명 도우미가 그때그때 파일을 읽게 한다(WP-1276). 그보다 앞서(1단계 뒤) 위치의 추가 CA(`/run/genia/ca/ca.crt`)가 있으면 시스템 CA 와 합친다.
6. dind 소켓을 최대 60초 기다린다. 없으면 경고만 남긴다.
7. Pod 마다 한 번, 칸을 띄우기 전에 플러그인의 `agent-sweep` 으로 AI 폴더의 모든 저장소(`repos/*` — 칸이 없는 프로젝트 포함)에서 끝난 이슈의 워크트리를 지운다 — 이슈 상태를 서버에 물어(`gw-issue-status`) 완료·취소이고 커밋 안 한 변경·올리지 않은 커밋·잠금·돌고 있는 작업이 없는 것만, main 에 들어간 기차는 묻지 않고. 서버에 닿지 못하면 하나도 지우지 않는다(칸의 work-loop 가 이어 정리한다). 결과는 `state/boot-sweep.log` 와 「워크트리 정리: …」 로그, 10분(600초)에 끊는다(WP-1683). 그다음 맡은 프로젝트마다 진행한다: 저장소 받기 → 저장소의 Playwright 버전에 맞는 chromium·headless shell 받기 → `agent-project start` 로 칸 띄우기. 다 띄운 뒤 `agent-events ensure` 로 알림 감시 창을 한 번 챙긴다.
   - Playwright 는 버전마다 PVC 의 고정 폴더(`/work/.cache/ms-playwright/.genia-installs/<버전>`)에 `playwright-core` 를 받고 그 cli 로 브라우저를 받는다 — 설치 기록(`.links`)이 PVC 경로를 가리켜 재시작 뒤에도 깨지지 않는다. 「받았는지」는 그 버전의 chromium·headless shell 폴더에 `INSTALLATION_COMPLETE` 가 있는지로 본다(headless shell 항목이 없는 Playwright 1.48 이하는 chromium 만). 버전은 폴더가 있는 모든 저장소에서 모으고 버전끼리 동시에 받는다.
   - 모든 버전을 받았으면 `browser-prune` 으로 안 쓰는 브라우저를 지운다 — `/work/agents/*/repos/*` 의 Playwright 버전과 playwright-cli 가 쓰는 브라우저, 임시 설치(npx·`.genia-installs`)가 아닌 유효한 설치 기록이 가리키는 것은 남기고, 이미지가 `/ms-playwright` 에 건 심볼릭 링크는 건드리지 않는다. 하나라도 받기에 실패했거나 Playwright 가 받는 중(`__dirlock` 이 10분 안에 바뀜)이면 지우지 않는다. 결과는 「브라우저 정리: …」 로그로 남기고 5분에 끊는다.
8. 60초마다 감독한다. 칸 상태를 tmux 에서 한 번 읽어(`agent-window --states`) 죽었거나 빠진 칸만 다시 띄우고, 6일이 넘은 칸은 새로 시작하고, 1시간(`GENIA_TMP_SWEEP_EVERY=3600`)에 한 번 `/work/tmp` 에서 3일(`GENIA_TMP_MAX_AGE_MIN=4320`) 넘게 안 바뀐(수정 시각 mtime 과 상태 변경 시각 ctime 둘 다 — tar·npm 이 되살린 옛 mtime 의 새 파일은 남는다) 파일·심볼릭 링크와 바로 아래 빈 폴더를 지우고(소켓·FIFO, Chrome 프로필 잠금 `Singleton*` 링크, Claude 세션의 `claude-*` 폴더는 남긴다, WP-1683), 끝에 알림 감시 창을 한 번 챙긴다. tmp 정리는 감독 루프가 회차마다 부른다 — 세 다른 이미지의 `tick` 은 칸을 띄울 수 없는(로그인 전) 회차에도 부른다.
9. SIGTERM 을 받으면 칸마다 SIGTERM 을 보내고 최대 40초 기다린 뒤 tmux 를 끄고 종료 0. work-loop 가 멈춰도(DRAIN) 엔트리포인트는 끝내지 않는다.

## 다른 이미지와 함께 쓰는 파일

`bin/lib.sh`·`bin/agent-screen` 은 Gen:iA Code 이미지([workplace-agent-genia-code](../workplace-agent-genia-code))·Codex 이미지([workplace-agent-codex](../workplace-agent-codex))·OpenCode 이미지([workplace-agent-opencode](../workplace-agent-opencode))도 그대로 COPY 해 쓴다(그 이미지 전용 함수는 `lib-genia.sh`·`lib-codex.sh`·`lib-opencode.sh` 가 덮어쓴다). 세 이미지는 `lib.sh` 의 감독 회차 `tick`(훅 `before_supervise`·`can_launch`), 로그인 시딩 `seed_login_file`·`login_file_ready`, 시간 제한 받기 `bg_wait_timeout` 도 쓴다 — 이 이미지의 엔트리포인트는 `tick` 을 쓰지 않는다. 종료 신호 trap(`install_term_trap`)과 감독 루프(`run_supervisor tick|boot`)는 네 엔트리포인트가 모두 `lib.sh` 의 것을 부른다(WP-1445) — 이 이미지는 `boot`(부팅 때 칸을 띄우고 한 회차 쉰 뒤부터 감독), 세 이미지는 `tick`(부팅 첫 회차부터 `tick`). 엔트리포인트 테스트의 공용 도구는 `tests/harness.mjs`(네 이미지가 함께 import)다. 함수 이름·인자나 harness 를 바꾸면 네 이미지의 테스트를 모두 돌린다.

## 새 실행기 이미지 더하기

실행기(칸에서 work-loop 를 도는 CLI)를 하나 더할 때는 Codex 이미지([workplace-agent-codex](../workplace-agent-codex))나 OpenCode 이미지([workplace-agent-opencode](../workplace-agent-opencode))를 본보기로 삼는다. 공용 일은 `lib.sh` 에 있으므로 새 이미지가 쓸 것은 아래뿐이다.

- `bin/entrypoint` — 부팅 단계 목록(필수 확인·폴더·CA·플러그인·설정·로그인·키·git·dind·`agent-home set cli <실행기>`)을 이미지에 맞는 순서로 적고, `lib.sh`·`lib-<cli>.sh` 를 읽은 바로 뒤에 `install_term_trap`, 끝에 `run_supervisor tick` 을 부른다. trap·`on_term`·`while` 루프를 엔트리포인트에 다시 쓰지 않는다.
- `bin/lib-<cli>.sh` — 그 실행기만의 일: 설정 파일 쓰기, 로그인 정보 시딩(`seed_login_file`)·`can_launch`(`login_file_ready`), 플러그인 고르기(빌드 때 굳힌 것이면 `use_plugin() { use_baked_plugin <플러그인 폴더> <구동기 하위 폴더>; }`), 세션 시작 hook 이 없는 실행기면 전역 지시(`write_superpowers_agents_md <출력 경로> <SKILL.md 경로> <실행기 항목>` — 스킬 부르기·도구 이름 대응 줄), 필요하면 `trust_folders`·`before_supervise` 덮어쓰기.
- 부팅 단계 순서는 이미지마다 다르다(Claude: 플러그인 → 설정·신뢰 / Gen:iA Code: CA·genia 받기가 플러그인 앞 / Codex·OpenCode: 버전 로그). 그래서 단계 목록은 하나의 틀로 묶지 않고 엔트리포인트에 둔다.

바꿀 파일:

1. 새 이미지 폴더 `apps/workplace-agent-<cli>/` 의 `Dockerfile`·`bin/entrypoint`·`bin/lib-<cli>.sh`·`tests/entrypoint.test.mjs`(와 `package.json`·`README.md`).
2. 릴리스 이미지 카탈로그 `deploy/release/image-catalog.json`(`helm: false` — 작업 공간 이미지는 Helm 으로 배포하지 않고 runner 가 템플릿의 `image` 로 Pod 를 만든다)과 그 테스트 `deploy/release/tests/catalog.test.mjs`.
3. AI 템플릿 `apps/workplace-api/src/main/resources/agent-templates/<cli>.yaml`(이미지 주소·요구 로그인·설정 항목).
4. genia-works 플러그인: `scripts/gw-lib.sh` 의 `GW_LAUNCH_CLIS`(실행기 이름 허용 목록), `scripts/agent-project` 의 실행기 분기(칸 명령), 필요하면 구동기 폴더(`<cli>/driver.mjs`).
5. Pod 계약 `docs/integrations/agent-pod-contract.md`.

Dockerfile 은 합치지 않았다(WP-1445). Claude Code·Gen:iA Code 는 받는 프로그램(Claude Code·사내 genia)과 COPY 가 크게 달라 ARG 로 줄일 수 없다. Codex·OpenCode 는 실제로 다른 곳이 npm 패키지·버전 ARG·구동기 폴더 COPY·`bin/` COPY 넷(약 10줄)뿐이라 `ARG CLI_PKG`/`ARG CLI_DIR` 한 벌로 줄일 수는 있지만, 그러면 릴리스 카탈로그(`deploy/release/image-catalog.json`)의 두 항목이 같은 Dockerfile 에 `buildArgs` 를 나눠 넘겨야 하고 이미지 경로 변경 감지(`paths`)도 함께 바뀐다 — 카탈로그는 이 정리에서 손대지 않기로 해서(동작 그대로) 두 벌로 둔다. 두 파일의 주석은 각 CLI 를 실제로 확인한 기록(버전·스킬 경로)이라 합치면 잃는다. 대신 apt·glab·Claude Code·playwright-cli·사용자를 만드는 「같은 도구 블록」은 글자까지 같게 두고, Codex 테스트(`dockerfileKeepsSharedToolBlockIdenticalToGeniaImage`)가 Gen:iA Code 의 블록과 어긋나면 실패시킨다 — 새 이미지도 그 블록을 그대로 복사하고 같은 테스트를 둔다.

## 테스트·빌드

```sh
pnpm --filter @smart-workplace/workplace-agent-claude-code test   # node --test tests/*.test.mjs (tmux 필요)
docker build --platform linux/amd64 apps/workplace-agent-claude-code
```

빌드하려면 네트워크가 필요하다. 플러그인을 Anthropic 디렉터리, GitHub, Works 마켓플레이스에서 받기 때문이다.

## Code Mode 확인 (WP-1960 — `CLAUDE_CODE_VERSION` 을 올릴 때마다)

Code Mode 는 실험 기능이라 릴리스마다 켜는 방법이나 확인 플래그 이름(`…V1`)이 바뀔 수 있다. 바뀌면 칸이 opt-in 창에서 멈추므로 새 버전으로 올리기 전에 같은 설정 경로로 띄워 본다.

1. 새 버전 claude 와 Opus 5.5 이상 모델로, `~/.claude/settings.json`(또는 `--settings`)의 `env` 에 `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: "1"`, `~/.claude.json` 에 두 확인 플래그를 둔다.
2. tmux 에서 `claude --permission-mode bypassPermissions "<파일 하나 Read 하는 지시>"` 로 띄운다.
3. 「Code Mode (experimental)」 opt-in 창 없이 「Code Mode (experimental) is on」 줄이 보이고, 세션 기록(`~/.claude/projects/…/*.jsonl`)에 `REPL` 도구 호출이 있으면 된다.

모델이 Opus 5.5 미만이거나 계정 게이트·정책 조건이 안 맞으면 Claude Code 가 창 없이 일반 모드로 뜬다(칸은 멈추지 않는다). Code Mode 세션에서는 Remote Control 을 쓸 수 없다(이 이미지는 쓰지 않는다).
