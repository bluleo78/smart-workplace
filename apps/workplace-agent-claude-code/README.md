# workplace-agent-claude-code

Works 가 띄우는 AI Pod 의 작업 공간 이미지다(WP-1252). runner(`apps/workplace-agent-runner`)가 Pod 를 만들면, 이 이미지의 엔트리포인트가 Claude Code·플러그인·저장소·work-loop 칸을 사람 손 없이 띄우고 지킨다. Pod 와 무엇을 주고받는지는 [agent-pod-contract.md](../../docs/integrations/agent-pod-contract.md)에 있다.

## 들어 있는 것

- 베이스 `mcr.microsoft.com/playwright:v1.60.0-noble`. 개발용 작업 공간이라 DHI 규칙의 예외다(사유는 Dockerfile 머리에 있다).
- tmux, git, gh, glab(GitLab — 사용 통계·업데이트 확인 끔), jq, tini, OpenJDK 21, docker CLI·compose v2, pnpm(corepack)
- 포트·프로세스 확인 도구(WP-1404): lsof, ss·ip(iproute2), nc(BSD 판), netstat, fuser·killall, file, xxd, column, bc, zip, dig, ping, rsync, uuidgen — Mac 에 기본으로 있어 스크립트가 쓰는 명령
- playwright-cli(고정 버전, WP-1404) — 그 cli 가 품은 Playwright 의 chromium 을 `/ms-playwright` 에 굳히고, `~/.playwright/cli.config.json` 이 chromium headless 를 기본으로 둔다(`--config` 없이 `playwright-cli open <url>`). 엔트리포인트가 cli 설치를 PVC 브라우저 폴더의 `.links` 에 올려 저장소 Playwright 를 받을 때 GC 가 그 chromium 을 지우지 않게 하고, Xvfb 가상 화면(`DISPLAY=:99`)을 띄워 `--headed` 도 그리게 한다
- Claude Code `2.1.316`(npm 전역 설치, `DISABLE_AUTOUPDATER=1`)
- 언어 서버 jdtls, typescript-language-server
- 플러그인 8개: 빌드할 때 `/home/agent` 에 받아 이미지에 넣는다. 버전은 [plugins.lock](plugins.lock)에 고정한다. 받은 버전이 lock 과 다르면 빌드가 실패한다. superpowers 는 만든 사람의 마켓플레이스(`obra/superpowers-marketplace`)에서 받는다(최신을 바로 싣는다). Gen:iA Code 이미지도 이 lock 을 받는다(`genia-works` 만 빼고).
- 사용자 `agent`(UID/GID 1001)

## 엔트리포인트 (`bin/entrypoint`, 함수는 `bin/lib.sh`)

1. 필수 파일·env(`/run/genia/config.json`, `/run/genia/agent-key`, `GENIA_AGENT_NAME`)를 확인한다. 없으면 이유를 한 줄 남기고 종료 1. `/work` 아래 폴더를 만든다.
2. genia-works 마켓플레이스를 이 Works 주소(`GENIA_WORKS_API_URL` 의 origin + `/claude/marketplace.json`)로 맞춘다. 그 주소에 닿으면 이미지에 넣어 둔 주소와 같든 다르든 지우고 다시 더한 뒤 genia-works 를 받는다(늘 서버의 버전). 닿지 않으면 이미지에 넣어 둔 것을 그대로 쓴다. 템플릿에 새로 넣은 플러그인도 받는다. 그다음 플러그인 스크립트 폴더를 찾아 플러그인 공용 함수(`gw-lib.sh`)를 읽는다 — 이 뒤로는 키 저장·검사·경로·파일 쓰기를 플러그인과 같은 규칙으로 한다.
3. `~/.claude/settings.json` 을 매번 새로 쓴다. 넣는 것: 모델, 켤 플러그인, 마켓플레이스(genia-works 는 2번에서 정한 주소·claude-plugins-official), genia-works MCP 주소(`GENIA_WORKS_MCP_URL`).
4. `~/.claude.json` 에 온보딩 완료·bypass 확인을 적고, AI 폴더와 저장소 폴더를 신뢰한다고 적는다. 상위 폴더를 신뢰하면 하위 폴더도 신뢰된다.
5. AI 키를 플러그인의 `gw-keys add` 로 둔다(형식 검사, 600). git 신원을 정하고, GitHub 토큰은 표준 입력으로 넘겨 `gh auth login` 한 뒤 `gh auth setup-git` 하고, GitLab 토큰은 호스트마다 git 자격 증명 도우미가 그때그때 파일을 읽게 한다(WP-1276). 그보다 앞서(1단계 뒤) 위치의 추가 CA(`/run/genia/ca/ca.crt`)가 있으면 시스템 CA 와 합친다.
6. dind 소켓을 최대 60초 기다린다. 없으면 경고만 남긴다.
7. 맡은 프로젝트마다 진행한다: 저장소 받기 → 저장소의 Playwright 버전에 맞는 chromium 받기 → `agent-project start` 로 칸 띄우기. 다 띄운 뒤 `agent-events ensure` 로 알림 감시 창을 한 번 챙긴다.
8. 60초마다 감독한다. 칸 상태를 tmux 에서 한 번 읽어(`agent-window --states`) 죽었거나 빠진 칸만 다시 띄우고, 6일이 넘은 칸은 새로 시작하고, 끝에 알림 감시 창을 한 번 챙긴다.
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
