# WP-1445 작업 공간 이미지 엔트리포인트·lib 중복 공용화 계획

이슈: WP-1445(부모 WP-1245). 동작은 바꾸지 않는 정리다.

## 범위 (내가 정한 것)

- **네 벌** — 처음엔 origin/main(b3af6c8ec)에 OpenCode 이미지(WP-1410)가 없어 세 벌로 만들었고, 기차에 싣기 전 origin/main(6b1284cad)에 OpenCode(d25d7e3cd)가 들어와 그 위로 rebase 해 OpenCode 도 같은 도우미로 바꿨다(이슈 챗에서 사람이 고른 A안).
- **엔트리포인트 부팅 단계 목록은 이미지마다 그대로 둔다** — 단계 순서가 이미지마다 다르다(claude: 플러그인 → settings·trust / genia: genia_ca·install_genia 가 플러그인 앞 / codex: start_display 없음·버전 로그). 하나의 틀(runner_setup 훅)로 묶으면 순서가 바뀌어 동작이 달라질 위험이 커서, 이슈의 완료 기준(감독 루프·trap 이 한 곳)에 맞춰 **trap 과 감독 루프만** lib.sh 로 옮긴다.
- **Dockerfile 통합은 하지 않는다** — Claude·Gen:iA 는 받는 프로그램과 COPY 가 크게 달라 ARG 로 줄일 수 없다. Codex·OpenCode 는 약 10줄(npm 패키지·버전 ARG·구동기 COPY·bin COPY)만 달라 `ARG CLI_PKG`/`ARG CLI_DIR` 한 벌로 줄일 수 있지만, 릴리스 카탈로그 두 항목이 같은 Dockerfile 에 buildArgs 를 나눠 넘겨야 해서 이슈가 손대지 말라고 한 카탈로그를 바꾸게 된다. 이유를 README 에 남긴다.
- 처음 기준선에서 깨져 있던 codex 도구 블록 테스트·claude chmodSync import 는 그 사이 main(953cf0400)이 고쳤다 — rebase 때 main 의 것을 쓰고 내 수정은 뺐다.
- claude `screen.test.mjs` 의 attach 테스트 실패는 agent-screen(이 이슈 밖)이라 손대지 않고 보고에 남긴다.

## 할 일

### Task 1. trap·감독 루프를 lib.sh 로 (apps/workplace-agent-claude-code/bin/lib.sh)

- `install_term_trap` — 전역 `SLEEP_PID=""`, `on_term`(trap 해제 → SLEEP_PID kill → abort_boot → `log "종료 신호 — 칸들을 정리합니다"` → stop_all → exit 0) 정의와 `trap on_term TERM INT`. 엔트리포인트는 lib 를 읽은 바로 뒤(지금 trap 자리)에서 부른다.
- `run_supervisor <tick|boot>` — `PROJECTS_READY=0`·`BOOT_KEYS=""` 를 정하고 돈다. 돌아오지 않는다.
  - `tick`(genia·codex·opencode): `while :; do tick; sleep & wait; done` — 지금과 같다.
  - `boot`(claude): `start_projects && PROJECTS_READY=1; ensure_events; while :; do sleep & wait; supervise_once; done` — 지금과 같다(첫 회차 전에 sleep).
  - sleep 은 `sleep "$GENIA_SUPERVISE_INTERVAL" &` → `SLEEP_PID=$!` → `wait` → `SLEEP_PID=""` 그대로(SIGTERM 즉시 처리).
  - 알 수 없는 모드면 die.
- 네 엔트리포인트에서 on_term·trap·PROJECTS_READY/BOOT_KEYS·while 루프를 지우고 `install_term_trap` / `run_supervisor tick|boot` 로 바꾼다. 주석(한국어)은 옮긴 곳에 맞게 고친다.

### Task 2. 전역 지시·굳힌 플러그인 도우미 (lib.sh, lib-codex.sh)

- `write_superpowers_agents_md <출력 경로> <using-superpowers SKILL.md 경로> <실행기 항목>` — 스킬 없으면 rm·경고·return 0, 있으면 폴더를 만들고 gw_write_atomic 으로 같은 본문. 셋째 인자는 「스킬 파일을 읽고 따른다」 뒤의 줄들 그대로(스킬 부르는 방법 — Codex: 스킬 파일을 읽어 / OpenCode: skill 도구로 — 과 도구 이름 대응이 실행기마다 다르다). 결과 파일 바이트가 codex·opencode 모두 지금과 같아야 한다.
- `write_codex_agents_md`·`write_opencode_agents_md` 는 각자의 출력 경로·스킬 경로·실행기 항목만 넘긴다.
- `use_baked_plugin <플러그인 폴더> <구동기 하위 폴더>` — `[ -f "$1/$2/driver.mjs" ] || return 1; adopt_plugin_scripts "$1/scripts"`. codex·opencode `use_plugin` 은 `use_baked_plugin "$CODEX_PLUGIN_DIR" codex` / `use_baked_plugin "$OPENCODE_PLUGIN_DIR" opencode`. genia 의 use_plugin(마켓플레이스 고르기)은 그대로.
- `trust_folders` 무동작 덮어쓰기(genia·codex·opencode)는 한 줄이라 그대로 둔다.

### Task 3. OpenCode 를 같은 도우미로 (rebase 뒤)

### Task 4. README — 새 실행기를 더할 때 바꿀 파일

- `apps/workplace-agent-claude-code/README.md`(공용 lib.sh 가 있는 곳)에 「새 실행기 이미지 더하기」 절: 이제 엔트리포인트는 부팅 단계 목록 + `install_term_trap`·`run_supervisor` 만, lib-<cli>.sh 는 설정 쓰기·로그인·`use_baked_plugin`·`write_superpowers_agents_md` 호출만 쓰면 된다. 바꿀 파일 목록(이미지 폴더 4개 파일 + 카탈로그·Helm·플러그인 GW_LAUNCH_CLIS 등 이 이슈가 손대지 않은 곳)과 Dockerfile 을 합치지 않은 이유.

## 확인

- 네 이미지 `node --test tests/*.test.mjs`(각 앱 폴더). 끝나면 claude 의 attach(agent-screen, 이 이슈 밖) 하나 말고 모두 통과.
- `grep -n "trap on_term\|while :" apps/workplace-agent-*/bin/entrypoint` 결과 없음 — 한 곳(lib.sh)에만.
- `bash -n` 으로 바꾼 셸 파일 문법 확인.

## Review Focus (완료 기준이 말하지 않은 입력·실패 경우)

- on_term 이 부팅 도중(start_projects 전·중) 와도 지금처럼 abort_boot 후 0 으로 끝나는가 — trap 을 루프 함수 안이 아니라 부팅 앞에서 건다.
- run_supervisor 안 `wait` 가 trap 으로 끊겨도 on_term 이 exit 하므로 루프로 돌아오지 않는다.
- claude 의 boot 모드는 첫 supervise_once 전에 sleep 한다 — tick 모드로 바꾸면 부팅 직후 agent-window 를 한 번 더 부른다(동작 변화). 모드를 나눈 이유.
- AGENTS.md 본문이 codex·opencode 모두 한 글자도 바뀌지 않았는지(바이트 비교).
- `local` — lib.sh 는 전역 변수를 쓰므로 새 함수 안 변수는 local(bash 3.2 호환).
