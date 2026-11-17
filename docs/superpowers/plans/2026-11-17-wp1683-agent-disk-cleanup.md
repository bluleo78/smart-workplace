# AI 작업 공간 디스크 정리 (WP-1683) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI Pod 의 `/work` 가 차지 않게 — 안 쓰는 Playwright 브라우저, `/work/tmp` 의 오래된 것, 끝난 이슈의 워크트리를 Pod 가 뜰 때(그리고 tmp 는 도는 동안 주기적으로) 지우고, 외부 호스트(start-agent)의 브라우저 폴더도 같은 규칙으로 정리한다.

**Architecture:** 정리 규칙은 genia-works 플러그인 스크립트 두 개에 둔다 — `browser-prune`(브라우저 폴더 정리, 이미지·호스트 공용)과 `agent-sweep`(AI 폴더의 모든 `repos/*` 에 `worktree-sweep` 을 돌리고 이슈 상태를 REST 로 물어 DONE·CANCELED 만 지움, 서버 조회는 새 스크립트 `gw-issue-status`). 이미지 쪽 `bin/lib.sh`(네 작업 공간 이미지 공용)는 브라우저를 PVC 의 고정 폴더(`.genia-installs/<버전>`)에 설치하고, 부팅 때 `browser-prune`·`agent-sweep` 을 부르고, `/work/tmp` 를 부팅 때 비우고 감독 회차에서 3일 지난 것을 지운다.

**Tech Stack:** POSIX sh(플러그인 스크립트, macOS 기본 셸에서도 돈다)·bash 3.2 호환(lib.sh)·jq·git, 테스트는 `node --test`(`plugins/genia-works/tests/*.test.mjs`, `apps/workplace-agent-*/tests/*.test.mjs` + `tests/harness.mjs`).

**Spec:** WP-1683 이슈 본문 + 이 계획 앞머리의 「정한 것」(제품 책임자 결정). 이미지와 Pod 의 약속은 `docs/integrations/agent-pod-contract.md`.

## 정한 것 (스펙 요약 — 구현자가 다시 정하지 않는다)

- **브라우저(이미지)**: 저장소 Playwright 버전의 chromium 은 `npx` 대신 `npm install --prefix "$BROWSERS_DIR/.genia-installs/<버전>" playwright-core@<버전>` 로 PVC 의 고정 폴더에 받고, 그 `playwright-core/cli.js install chromium` 으로 브라우저를 받는다 → Playwright 의 설치 기록(`.links/<해시>`)이 PVC 경로를 가리켜 재시작해도 STALE 이 되지 않는다. 받을 때는 `PLAYWRIGHT_SKIP_BROWSER_GC=1`(지우기는 `browser-prune` 하나가 한다). `.genia-chromium-<버전>` 표시는 쓰지 않는다 — 「받았는지」는 그 버전 `browsers.json` 의 chromium·chromium-headless-shell 폴더에 `INSTALLATION_COMPLETE` 가 있는지로 본다(없으면 다시 받는다). headless shell 도 받는다 — 저장소 E2E(`devices['Desktop Chrome']`, channel 지정 없음)의 headless 실행은 `chromium_headless_shell-<rev>` 를 쓴다.
- **브라우저 정리 규칙(`browser-prune`, 이미지·호스트 같다)**:
  1. `.links/*` 중 대상 폴더에 `browsers.json` 이 없는 것(STALE)은 지운다.
  2. 「임시 설치」(대상 경로에 `/_npx/` 가 있거나 `<브라우저 폴더>/.genia-installs/` 아래) 중 `package.json` 버전이 `<홈>/*/repos/*` 저장소들의 Playwright 버전 집합에 없는 것은 링크를 지운다(`.genia-installs/<버전>` 은 폴더도 지운다, `_npx` 폴더는 건드리지 않는다). 예외: `_npx/<h>/node_modules/@playwright/cli` 를 품은 임시 설치는 링크 파일이 가장 최근인 것 하나를 남긴다(호스트의 화면 탐색용 cli).
  3. 남은 링크들의 `browsers.json` 이 가리키는 모든 폴더(`<name 의 - 를 _ 로>-<revision>` 과 `revisionOverrides` 의 값들)가 「쓰는 것」이다.
  4. 브라우저 폴더 바로 아래 **진짜 폴더** 중 이름이 `^(chromium|chromium_headless_shell|chromium_tip_of_tree|chromium_tip_of_tree_headless_shell|firefox|firefox_beta|webkit|ffmpeg|winldd|android)-[0-9]+$` 이고 「쓰는 것」이 아닌 것을 지운다. 심볼릭 링크(이미지가 `/ms-playwright` 에 건 것)는 건드리지 않는다. 그 밖의 이름(`daemon`, `b`, `cli-update-check.json` 등)은 건드리지 않는다.
  5. `.genia-chromium-*` 표시 파일은 모두 지운다(옛 방식).
  6. 안 하는 때: `__dirlock`(Playwright 설치 잠금)이 있고 10분 안에 바뀌었으면, jq 가 없으면, 1~2 뒤 유효한 링크가 하나도 없으면 — 아무것도 지우지 않고 종료 3.
- **이미지 부팅 순서(start_projects)**: 저장소 받기 → 목록의 모든 키 중 폴더가 있는 저장소의 버전마다 `ensure_playwright`(병렬) → **하나라도 실패하면 정리하지 않는다**, 모두 성공하면 `browser-prune` → 칸 띄우기.
- **`/work/tmp`**: 부팅 때(prepare_dirs, 다른 무엇도 tmp 를 쓰기 전) 안을 모두 지운다. 도는 동안은 감독 루프의 회차마다(tick 모드는 `tick` 이 `can_launch` 와 상관없이, boot 모드는 루프가 `supervise_once` 뒤에 — 코드 리뷰) 1시간(`GENIA_TMP_SWEEP_EVERY=3600`)에 한 번, 수정 시각(mtime)과 상태 변경 시각(ctime)이 둘 다 3일(`GENIA_TMP_MAX_AGE_MIN=4320`)을 넘은 일반 파일·심볼릭 링크(Chrome 프로필 잠금 `Singleton*` 링크는 빼고)를 지우고, 바로 아래(깊이 1) 빈 폴더 중 3일 넘은 것을 지운다. `claude-*` 아래 폴더는 비어도 지우지 않는다(돌고 있는 Claude 세션의 scratchpad). 소켓·FIFO 는 건드리지 않는다. 캐시(playwright-transform-cache·node-compile-cache)는 tmp 에 그대로 두고 이 3일 규칙으로 상한을 둔다(옮기지 않는다 — 옮겨도 같은 크기가 PVC 에 쌓인다).
- **워크트리**: 지금 규칙(work-loop 2-1) 그대로. 더해서 부팅 때 `agent-sweep <AI 폴더>` 가 `repos/*` 전부(칸이 없는 프로젝트 포함)에 대해 `worktree-sweep list` → 이슈 키는 `gw-issue-status` 로 물어 `DONE`·`CANCELED` 이고 상태가 `ok`·`notes-only` 일 때만 `worktree-sweep remove`, 기차 키(`integ-<AI>-<n>`)는 list 가 낸 것이면(들어간 기차) 바로 remove. 서버에 못 닿거나 403·404 면 남긴다. 이슈 챗 알림은 하지 않는다(MCP 가 없다 — work-loop 2-1 이 칸에서 알린다).
- **외부 호스트**: start-agent 5번(저장소 준비) 뒤에 `browser-prune "<홈>"` 을 부른다. 브라우저 폴더는 `PLAYWRIGHT_BROWSERS_PATH`(값이 `0` 이면 정리하지 않음), 없으면 macOS `~/Library/Caches/ms-playwright`, 그 밖 `${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright`.
- 자원 상한은 올리지 않는다.

## Global Constraints

- 주석은 한국어로 무엇을·왜(`docs/CODING_CONVENTION.md`). 스크립트 머리 주석에 사용법·출력·종료 코드를 적는다(기존 `worktree-sweep`·`gw-agent-projects` 모양).
- 플러그인 스크립트는 `#!/bin/sh` POSIX(로컬 변수 없음 — 접두 `_bp_`·`_as_`·`_is_` 를 붙인 전역), `here=$(cd "$(dirname "$0")" && pwd)` 후 `. "$here/gw-lib.sh"`. lib.sh 는 bash 3.2 에서도 돈다.
- 키·토큰 원문은 인자·로그에 두지 않는다 — 서버 호출은 `gw_api_request`(키를 표준 입력으로 curl 설정에 넣음)만 쓴다.
- 이미지 엔트리포인트의 정리 실패는 경고 한 줄만 남기고 부팅을 계속한다(정리가 칸 띄우기를 막지 않는다).
- 오래 걸리는 정리(rm·fetch)는 `bg_wait`/`bg_wait_timeout` 로 돌려 SIGTERM 을 바로 받는다.
- 플러그인 버전 0.1.51 → **0.1.52**(rebase 때 origin/main 이 이미 0.1.52 면 그다음 번호). 바꿀 곳: `plugins/genia-works/.claude-plugin/plugin.json`, `plugins/genia-works/.codex-plugin/plugin.json`, `apps/workplace-web/public/claude/marketplace.json` 의 `ref`(`genia-works--v0.1.52`), `apps/workplace-web/src/lib/pluginGuide.test.ts` 의 기대 ref.
- 셸 명령은 단순하게 — 한 줄 함수 정의(`f(){…;}`)·`${…:-{…}}`·긴 `;`/`&&` 사슬을 쓰지 않는다. 복잡하면 함수·스크립트로 나눈다.
- 테스트 명령: 플러그인 `pnpm test:plugin`(또는 파일 하나 `node --test plugins/genia-works/tests/<파일>`), 이미지 네 개 `pnpm --filter @smart-workplace/workplace-agent-claude-code test`·`…-codex test`·`…-genia-code test`·`…-opencode test`(lib.sh 공용이라 넷 다), 버전 문자열 `cd apps/workplace-web && npx vitest run src/lib/pluginGuide.test.ts`.

## Review Focus

각 줄의 테스트는 괄호 안 Task 가 갖는다.

- **다른 저장소가 아직 쓰는 버전**: AA(1.60.0)·BB(1.61.0) 중 AA 만 1.62.0 으로 올리면 1.60 의 chromium·headless shell 만 사라지고 1.61 은 남아야 한다 — 같은 AI 의 다른 저장소, 호스트에선 다른 AI 의 저장소(`<홈>/*/repos/*` 전부를 본다)도 지킨다. (Task 1 `keepsVersionsOfEveryRepoUnderHome`, Task 2 `rebootAfterVersionChangeDropsOnlyOldBrowsers`)
- **playwright-cli 브라우저**: `.links/genia-playwright-cli` 가 가리키는 cli core 의 chromium(이미지에선 `/ms-playwright` 로의 심볼릭 링크, 호스트에선 진짜 폴더)은 저장소 버전과 상관없이 남는다. (Task 1 `keepsBrowsersOfValidNonTemporaryLinks`, Task 2 같은 테스트의 cli 단언)
- **반쯤 받은 폴더**: `INSTALLATION_COMPLETE` 없는 폴더 — 쓰는 버전이면 지우지 않고 `ensure_playwright` 가 다시 받으며, 안 쓰는 버전이면 지운다. 설치가 도는 중(`__dirlock` 10분 안)이면 아무것도 지우지 않는다. (Task 1 `skipsWhileInstallLockIsFresh`, Task 2 `ensurePlaywrightReinstallsWhenBrowserIncomplete`)
- **베이스 이미지의 심볼릭 링크 브라우저**: `chromium-1223 -> /ms-playwright/chromium-1223` 같은 링크는 「쓰는 것」이 아니어도 지우지 않고, 링크가 가리키는 폴더에 `INSTALLATION_COMPLETE` 가 있으면 그 버전은 받지 않는다. (Task 1 `neverTouchesSymlinksOrNonBrowserEntries`, Task 2 `ensurePlaywrightTrustsSeededSymlink`)
- **받기 실패·서버 불통 때 지우지 않음**: `ensure_playwright` 가 하나라도 실패하면 `browser-prune` 을 부르지 않는다. 부팅 때 서버에 닿지 못하면(gw-issue-status 종료 5) 워크트리를 하나도 지우지 않는다. (Task 2 `skipsPruneWhenAnyInstallFails`, Task 4 `keepsEverythingWhenServerUnreachable`)
- **더는 소속이 아닌 프로젝트의 워크트리**: `repos/OLD` 는 남아 있지만 AI 가 멤버가 아니어서 이슈 조회가 403·404 → 남긴다. (Task 4 `keepsWorktreesWhenIssueForbiddenOrMissing`)
- **돌던 프로세스가 쓰는 tmp**: 3일 넘게 안 바뀐 파일이라도 소켓·FIFO 는 남고, `claude-<uid>/…` 아래 빈 폴더는 남는다. 부팅 비우기는 다른 무엇도 tmp 를 쓰기 전(prepare_dirs 맨 앞)에만 한다. (Task 3 `sweepTmpDeletesOnlyOldFilesAndKeepsSocketsAndClaudeDirs`)
- **권한**: tmp 안의 root 소유 파일(dind 가 bind mount 로 만든 것 등)·쓸 수 없는 브라우저 폴더를 못 지워도 경고만 남기고 부팅·감독을 계속한다(종료 코드로 엔트리포인트가 죽지 않는다). (Task 3 `cleanTmpWarnsButContinuesOnUndeletable`, Task 1 `continuesWhenAFolderCannotBeRemoved`)
- **dirty·unpushed·locked·running 워크트리**: DONE 이어도 `worktree-sweep` 상태가 `ok`·`notes-only` 가 아니면 묻지도 지우지도 않는다. (Task 4 `keepsDirtyDoneWorktree`)

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `plugins/genia-works/scripts/gw-lib.sh` | `gw_playwright_version <저장소 폴더>`(lib.sh 의 playwright_version 을 옮김), `gw_browsers_dir`(기본 브라우저 폴더) | 1 |
| `plugins/genia-works/scripts/browser-prune` (새) | 브라우저 폴더 정리 규칙 | 1 |
| `plugins/genia-works/tests/browser-prune.test.mjs` (새) | 위 테스트 | 1 |
| `apps/workplace-agent-claude-code/bin/lib.sh` | `ensure_playwright`·`browsers_ready`·`prune_browsers`·start_projects 배선 | 2 |
| 〃 | `clean_tmp`·`sweep_tmp`·`sweep_tmp_due`, prepare_dirs·supervise_once 배선 | 3 |
| 〃 | `sweep_worktrees`, start_projects 배선 | 5 |
| `apps/workplace-agent-claude-code/tests/entrypoint.test.mjs` | 가짜 npm·가짜 cli.js, Task 2·3·5 테스트 | 2·3·5 |
| `plugins/genia-works/scripts/gw-issue-status` (새) | 이슈 상태 범주 한 줄 조회(REST) | 4 |
| `plugins/genia-works/scripts/agent-sweep` (새) | AI 폴더의 모든 저장소 워크트리 정리 | 4 |
| `plugins/genia-works/tests/agent-sweep.test.mjs` (새) | gw-issue-status·agent-sweep 테스트 | 4 |
| `plugins/genia-works/skills/start-agent/SKILL.md`, `tests/skills.test.mjs` | 호스트 브라우저 정리 단계 | 6 |
| 버전 파일 4곳, `plugins/genia-works/README.md` | 0.1.52 | 6 |
| `apps/workplace-agent-claude-code/README.md`, `docs/integrations/agent-pod-contract.md` | 엔트리포인트 단계·디스크 배치 문서 | 7 |

---

### Task 1: 플러그인 — `gw_playwright_version` 옮기기와 `browser-prune`

**Files:**
- Modify: `plugins/genia-works/scripts/gw-lib.sh` (끝에 두 함수)
- Create: `plugins/genia-works/scripts/browser-prune`
- Create: `plugins/genia-works/tests/browser-prune.test.mjs`
- Modify: `apps/workplace-agent-claude-code/bin/lib.sh:335-348`(`playwright_version` 본문 → `gw_playwright_version` 위임), `apps/workplace-agent-claude-code/tests/entrypoint.test.mjs:427-441`(`readsPlaywrightVersionFromLockfile` 가 gw-lib 를 먼저 읽게)

**Interfaces:**
- Produces:
  - `gw_playwright_version <저장소 폴더>` — 지금 lib.sh `playwright_version` 과 같은 규칙(pnpm-lock.yaml 의 `@playwright/test@`·`playwright@` 줄 먼저, 없으면 package.json 고정 버전, `^~=v` 뗌). 출력 `x.y.z\n`·0, 없으면 1.
  - `gw_browsers_dir` — 위 「외부 호스트」 규칙의 기본 브라우저 폴더를 출력. `PLAYWRIGHT_BROWSERS_PATH=0` 이면 출력 없이 1.
  - `browser-prune [--dir <브라우저 폴더>] <홈>` — `<홈>/*/repos/*` 저장소 버전으로 「정리 규칙」 1~6. stdout 한 줄씩 `removed-link <링크 파일 이름>` · `removed-install <버전>` · `removed <폴더 이름>` · `removed-marker <파일 이름>`. 종료 0 성공(지운 것 없어도) · 2 사용법(홈이 폴더가 아님 등) · 3 건너뜀(이유 한 줄을 stderr — `설치 중`·`jq 없음`·`유효한 설치 기록 없음`·`브라우저 폴더 없음`). 개별 `rm` 실패는 stderr 경고 후 계속(종료 0).
- lib.sh `playwright_version` 은 `gw_playwright_version "$1"` 한 줄로 남긴다(다른 이미지 테스트가 이 이름을 부르지 않지만 start_projects 가 쓴다).

- [ ] **Step 1: 테스트 쓰기** — `browser-prune.test.mjs`. 도우미 `makeBrowsersDir(root)`: `<root>/pw` 에 `.links/`, 가짜 core 폴더 만들기 `core(path, version, revs)` → `<path>/package.json`(`{"version":…}`)·`<path>/browsers.json`(`browsers: [{name:'chromium',revision},{name:'chromium-headless-shell',revision},{name:'ffmpeg',revision:'1011'}]`), 브라우저 폴더 `dir(name)` → `<pw>/<name>/INSTALLATION_COMPLETE`. 홈은 `<root>/home/<AI>/repos/<키>/pnpm-lock.yaml` 로 버전을 둔다(이미지 테스트의 lock 모양 그대로).
  - `dropsStaleLinksAndTheirBrowsers`: 링크 A → 없는 경로, 링크 B → `.genia-installs/1.60.0/node_modules/playwright-core`(rev 1600); 홈 저장소 1.60.0; 폴더 `chromium-1500`·`chromium-1600`·`chromium_headless_shell-1600`·`ffmpeg-1011`. 결과: 링크 A 사라짐, `chromium-1500` 사라짐, 나머지 남음, stdout 에 `removed-link A`·`removed chromium-1500`.
  - `keepsVersionsOfEveryRepoUnderHome`: 홈 `ai1/repos/AA`(1.60.0)·`ai2/repos/BB`(1.61.0), 설치 `.genia-installs/1.59.0`·`1.60.0`·`1.61.0` 와 각 링크·브라우저. 결과: 1.59 의 링크·`.genia-installs/1.59.0`·`chromium-1590`·`chromium_headless_shell-1590` 사라짐(`removed-install 1.59.0`), 1.60·1.61 것은 남음.
  - `npxInstallsFollowRepoVersionsButKeepNewestCli`: 링크 → `<root>/npm/_npx/h1/node_modules/playwright-core`(1.58.0, 저장소에 없음), `_npx/h2/node_modules/playwright-core`(1.60.0, 저장소에 있음), `_npx/c1/node_modules/@playwright/cli/node_modules/playwright-core`(cli, 오래된 mtime), `_npx/c2/…`(cli, 새 mtime). 결과: h1·c1 링크 삭제(그 `_npx` 폴더는 남음), h2·c2 링크와 브라우저 남음.
  - `keepsBrowsersOfValidNonTemporaryLinks`: 링크 → `<root>/proj/node_modules/playwright-core`(1.57.0, 저장소 버전 아님) 와 `genia-playwright-cli` → cli core. 둘의 브라우저 모두 남는다.
  - `neverTouchesSymlinksOrNonBrowserEntries`: `chromium-1223` 이 `<root>/base/chromium-1223` 로의 심볼릭 링크, `daemon/`·`b/`·`cli-update-check.json`·`chromium-notes/`. 아무도 쓰지 않아도 모두 남는다.
  - `removesLegacyMarkers`: `.genia-chromium-1.59.1`·`.genia-chromium-1.60.0` 이 사라지고 `removed-marker` 두 줄.
  - `skipsWhileInstallLockIsFresh`: `__dirlock` 폴더(지금 mtime) → 종료 3, 아무것도 안 지움. mtime 을 11분 전으로 → 정리함.
  - `skipsWithoutAnyValidLink`: 링크가 모두 STALE → STALE 링크만 지우고 브라우저 폴더는 남김, 종료 3.
  - `continuesWhenAFolderCannotBeRemoved`: 지울 `chromium-1500` 안 파일을 둔 하위 폴더를 `chmod 0o500` → 종료 0, stderr 경고, 다른 지울 폴더는 지워짐(root 로 도는 CI 면 `t.skip`).
  - `defaultsBrowsersDir`: `gw_browsers_dir` 를 `sh -c '. gw-lib.sh && gw_browsers_dir'` 로 — `PLAYWRIGHT_BROWSERS_PATH=/x` → `/x`, `=0` → 1, 없음 + `XDG_CACHE_HOME=/c` → `/c/ms-playwright`(Linux 에서만; Darwin 이면 `~/Library/Caches/ms-playwright`).
  - `gwPlaywrightVersionReadsLockThenPackageJson`: 지금 `readsPlaywrightVersionFromLockfile` 와 같은 세 경우(1.58.2·1.57.0·없음 → 1).

- [ ] **Step 2: 실패 확인** — `node --test plugins/genia-works/tests/browser-prune.test.mjs` → `browser-prune` 없음(ENOENT)·`gw_playwright_version: not found` 로 FAIL.

- [ ] **Step 3: 구현** — `gw-lib.sh` 에 두 함수, `browser-prune` 스크립트(실행 권한 755). 순서: 인자·홈 검사 → 브라우저 폴더 정함(`--dir` 또는 `gw_browsers_dir`) → 잠금·jq 검사 → 저장소 버전 집합(`for r in "$home"/*/repos/*`) → 링크 판정(STALE / 임시 설치 버전 / cli 최신 하나) → 지울 링크·설치 지움 → 남은 링크의 `browsers.json` 에서 jq 로 「쓰는 것」 이름 목록(`.browsers[] | (.name | gsub("-";"_")) as $n | ([.revision] + ((.revisionOverrides // {}) | [.[]]))[] | "\($n)-\(.)"`) → 진짜 폴더 판정·지움 → 표시 파일. 폴더 이름 규칙은 「정한 것」 4의 정규식을 `case`/`grep -E` 로. cli 판정은 링크 대상 경로에 `/node_modules/@playwright/cli/` 가 있거나 `<_npx/h>/node_modules/@playwright/cli` 가 있는 것, 「가장 최근」은 링크 파일 mtime(`ls -t`). 디렉터리 이름 규칙(`-` → `_`)은 설치된 playwright-core 의 `server/registry/index.js` 에서 한 번 확인해 머리 주석에 근거로 적는다.
  lib.sh `playwright_version` 본문을 `gw_playwright_version "$1"` 로 바꾸고, `readsPlaywrightVersionFromLockfile` 를 `h.callLib([gwLib, lib], …)`(`gwLib = join(pluginScripts, 'gw-lib.sh')`)로 바꾼다.

- [ ] **Step 4: 통과 확인** — `node --test plugins/genia-works/tests/browser-prune.test.mjs` PASS, `pnpm --filter @smart-workplace/workplace-agent-claude-code test` PASS.

- [ ] **Step 5: 커밋** — `git add plugins/genia-works/scripts/gw-lib.sh plugins/genia-works/scripts/browser-prune plugins/genia-works/tests/browser-prune.test.mjs apps/workplace-agent-claude-code/bin/lib.sh apps/workplace-agent-claude-code/tests/entrypoint.test.mjs` → `git commit -m "feat(plugin): 안 쓰는 Playwright 브라우저를 지우는 browser-prune 을 더한다 (WP-1683)"`

---

### Task 2: 이미지 — 고정 폴더 설치·폴더 확인·부팅 정리

**Files:**
- Modify: `apps/workplace-agent-claude-code/bin/lib.sh` — `ensure_playwright`(350-359) 다시 쓰기, 새 `browsers_ready`·`prune_browsers`, `start_projects`(518-540 의 버전 모으기·받기 부분)
- Modify: `apps/workplace-agent-claude-code/tests/entrypoint.test.mjs` — fixture 의 가짜 `npx`(78-97)를 가짜 `npm` 으로, `startsSeveralProjects…`(695-722) 단언 갱신, 새 테스트

**Interfaces:**
- Consumes: `gw_playwright_version`, `"$GW_SCRIPTS/browser-prune" --dir <폴더> <홈>`(Task 1).
- Produces:
  - `browsers_ready <playwright-core 폴더>` — `browsers.json` 이 있고 그 `chromium`·`chromium-headless-shell` 의 `$BROWSERS_DIR/<이름>-<revision>/INSTALLATION_COMPLETE` 가 있으면(심볼릭 링크 따라감) 0.
  - `ensure_playwright <버전>` — 준비돼 있으면 0, 아니면 `(cd "$GENIA_WORK/tmp" && npm install --prefix "$BROWSERS_DIR/.genia-installs/<버전>" --no-audit --no-fund --loglevel=error "playwright-core@<버전>")` 뒤 `PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_DIR" PLAYWRIGHT_SKIP_BROWSER_GC=1 node "<core>/cli.js" install chromium`(둘 다 `>&2 </dev/null`), 끝나고 `browsers_ready` 면 0, 아니면 경고(기존 문구) 후 1. `.genia-chromium-*` 는 만들지 않는다.
  - `prune_browsers` — `[ -x "$GW_SCRIPTS/browser-prune" ]` 이 아니면 경고 한 줄 후 0. 있으면 `bg_wait_timeout 300 "$GW_SCRIPTS/browser-prune" --dir "$BROWSERS_DIR" "$AI_HOME"` 출력을 `$BOOT_DIR/prune.out` 에 받아 줄마다 `log "브라우저 정리: <줄>"`. 늘 0.
  - `start_projects` 변화: 버전은 `ok_list` 만이 아니라 목록의 모든 키 중 `$AI_DIR/repos/<키>` 가 있는 것에서 모은다. 각 `ensure_playwright` 를 `( ensure_playwright "$v"; printf '%s' $? > "$BOOT_DIR/pw-$v.rc" ) &` 로 돌리고, 모두 기다린 뒤 rc 가 모두 0 이고 버전 받기 단계가 끝났으면 `prune_browsers`(BOOT_DIR 를 지우기 전). 하나라도 실패하면 `log "경고: 브라우저 받기에 실패한 버전이 있어 이번에는 브라우저를 정리하지 않습니다"`.

- [ ] **Step 1: 테스트 쓰기** — fixture 에서 가짜 `npx` 를 지우고 가짜 `npm` 을 둔다: 인자를 `$FAKE_OUT/npm.log` 에 `install <버전>` 꼴로 적고, `--prefix` 폴더에 `node_modules/playwright-core/{package.json, browsers.json, cli.js}` 를 만든다. revision 은 버전에서 `1.<minor>.<patch>` → `<minor>0`(예 1.60.0 → `1600`, 1.61.0 → `1610`). `cli.js` 는 진짜 node 로 도는 JS 로 `install chromium` 을 받으면 `$PLAYWRIGHT_BROWSERS_PATH/chromium-<rev>/INSTALLATION_COMPLETE`·`chromium_headless_shell-<rev>/INSTALLATION_COMPLETE` 를 만들고 `.links/<버전>` 에 core 경로를 적고 `$FAKE_OUT/pw-install.log` 에 버전 한 줄. 지금 npx 의 `FAKE_NPX_RENDEZVOUS`·`FAKE_NPX_HANG` 동작은 이름을 `FAKE_NPM_RENDEZVOUS`·`FAKE_NPM_HANG` 로 바꿔 가짜 npm 으로 옮긴다(`sigtermDuringParallelBoot…` 도 갱신). `FAKE_NPM_FAIL=<버전>` 이면 그 버전은 종료 1.
  - `ensurePlaywrightInstallsUnderStableFolder`: `callLib(env, 'ensure_playwright 1.60.0')` → 0, `npm.log` 한 줄, `.genia-installs/1.60.0/node_modules/playwright-core/browsers.json` 있음, `.genia-chromium-1.60.0` 없음. 다시 부르면 `npm.log` 그대로 한 줄.
  - `ensurePlaywrightReinstallsWhenBrowserIncomplete`: 위 뒤에 `chromium_headless_shell-1600/INSTALLATION_COMPLETE` 를 지우고 부르면 `npm.log` 두 줄. 옛 표시 `.genia-chromium-1.61.0` 만 있고 폴더가 없는 1.61.0 도 받는다.
  - `ensurePlaywrightTrustsSeededSymlink`: `GENIA_BASE_BROWSERS=<root>/base` 에 `chromium-1600`·`chromium_headless_shell-1600`(각 INSTALLATION_COMPLETE)과 `.genia-installs/1.60.0/…/browsers.json` 을 미리 두고 `seed_browsers && ensure_playwright 1.60.0` → `npm.log` 없음.
  - `rebootAfterVersionChangeDropsOnlyOldBrowsers`(tmuxTest): AA(1.60.0)·BB(1.61.0)로 부팅 → 칸 뜸 → SIGTERM → AA 의 bare 저장소에 lock 을 1.62.0 으로 커밋 → 다시 부팅. 단언: `chromium-1600`·`chromium_headless_shell-1600`·`.genia-installs/1.60.0` 없음, `1610`·`1620` 것과 `.genia-installs/1.61.0`·`1.62.0` 있음, cli core(`GENIA_PLAYWRIGHT_CLI_CORE` 에 browsers.json rev 1700 + `<pw>/chromium-1700` 진짜 폴더)의 `chromium-1700` 있음, 로그에 `브라우저 정리: removed chromium-1600`.
  - `skipsPruneWhenAnyInstallFails`(tmuxTest): 위 첫 부팅 뒤 `<pw>/chromium-1500`(아무도 안 씀)을 두고, `FAKE_NPM_FAIL=1.62.0` 으로 다시 부팅 → `chromium-1500` 남음, 로그에 정리 건너뜀 경고.
  - 기존 `startsSeveralProjectsSkipsFailedCloneAndInstallsSharedPlaywrightOnce` 단언을 `npm.log` 정렬값 `['install 1.60.0', 'install 1.61.0']`·`.genia-installs/<v>` 있음으로 바꾼다.

- [ ] **Step 2: 실패 확인** — `pnpm --filter @smart-workplace/workplace-agent-claude-code test` → 새 테스트 FAIL(npx 를 부르고 `.genia-installs` 가 없음).

- [ ] **Step 3: 구현** — 위 Interfaces 대로 `browsers_ready`·`ensure_playwright`·`prune_browsers`·`start_projects` 를 고친다. `browsers_ready` 의 revision 은 `jq -r --arg n chromium '.browsers[] | select(.name == $n) | .revision'`. 주석: STALE 링크가 생기던 이유(휘발 홈의 npx 캐시)와 고정 폴더로 바꾼 이유, 받기 실패 때 정리하지 않는 이유.

- [ ] **Step 4: 통과 확인** — `pnpm --filter @smart-workplace/workplace-agent-claude-code test` PASS. 공용 lib.sh 라 `pnpm --filter @smart-workplace/workplace-agent-codex test`·`…-genia-code test`·`…-opencode test` 도 PASS(그쪽 저장소에는 Playwright 버전이 없어 받기·정리가 돌지 않는다 — 실패하면 그 fixture 에 `npm` 가짜가 필요한지 본다).

- [ ] **Step 5: 커밋** — `git add apps/workplace-agent-claude-code/bin/lib.sh apps/workplace-agent-claude-code/tests/entrypoint.test.mjs` → `git commit -m "fix(agent): 저장소 Playwright 를 PVC 고정 폴더에 받고 부팅 때 안 쓰는 브라우저를 지운다 (WP-1683)"`

---

### Task 3: 이미지 — `/work/tmp` 부팅 비우기와 3일 정리

**Files:**
- Modify: `apps/workplace-agent-claude-code/bin/lib.sh` — 상단 env 두 줄, 새 `clean_tmp`·`sweep_tmp`·`sweep_tmp_due`, `prepare_dirs`(58-62), `supervise_once`(564-590 끝 `ensure_events` 앞)
- Test: `apps/workplace-agent-claude-code/tests/entrypoint.test.mjs`

**Interfaces:**
- Produces:
  - env `GENIA_TMP_MAX_AGE_MIN=${GENIA_TMP_MAX_AGE_MIN:-4320}`, `GENIA_TMP_SWEEP_EVERY=${GENIA_TMP_SWEEP_EVERY:-3600}`.
  - `clean_tmp` — `$GENIA_WORK/tmp` 바로 아래 모든 항목을 `find … -mindepth 1 -maxdepth 1 -exec rm -rf {} +` 로(`bg_wait` 로 돌린다). 실패하면 `log "경고: /work/tmp 를 다 비우지 못했습니다 — <남은 개수>개 남음"`. 늘 0. `prepare_dirs` 에서 `mkdir -p` 바로 뒤, `seed_browsers` 앞에 부른다.
  - `sweep_tmp` — `find "$t" -mindepth 1 \( -type f -o -type l \) -mmin +"$GENIA_TMP_MAX_AGE_MIN" -exec rm -f {} +`, 그다음 `find "$t" -mindepth 1 -maxdepth 1 -type d -empty -mmin +"$GENIA_TMP_MAX_AGE_MIN" ! -name 'claude-*' -exec rmdir {} +`. 오류는 버리고 늘 0.
  - `sweep_tmp_due` — `$AI_DIR/state/tmp-swept`(에포크 초)의 나이(`gw_stamp_age`)가 없거나 `GENIA_TMP_SWEEP_EVERY` 이상이면 `bg_wait_timeout 300 sweep_tmp` 후 지금 시각을 적는다. 감독 루프가 회차마다 부른다(코드 리뷰 뒤: `tick` 이 `can_launch` 와 상관없이, boot 모드는 `run_supervisor` 루프가 `supervise_once` 뒤에).

- [ ] **Step 1: 테스트 쓰기**
  - `prepareDirsEmptiesTmpAtBoot`: `work/tmp` 에 파일·폴더(안에 파일)·심볼릭 링크·`claude-1001/x` 를 두고 `callLib(env, 'check_required && prepare_dirs')` → 0, `readdirSync(work/tmp)` 가 `[]`.
  - `cleanTmpWarnsButContinuesOnUndeletable`: `work/tmp/locked/f` 에서 `locked` 를 `chmod 0o500` → `prepare_dirs` 종료 0, stderr 에 `/work/tmp 를 다 비우지 못했습니다`(root 면 skip). 테스트 끝에 권한을 되돌린다.
  - `sweepTmpDeletesOnlyOldFilesAndKeepsSocketsAndClaudeDirs`: `utimesSync` 로 4일 전: `old.txt`, `gwA/old`, 빈 폴더 `gwB`, `claude-1001/s/scratchpad`(빈 폴더), FIFO `old.fifo`(`mkfifo` 를 `spawnSync`), 지금: `new.txt`, `gwA/new`. 폴더 mtime 은 안을 만든 뒤 맞춘다. `callLib(env, 'sweep_tmp')` → 남음: `new.txt`·`gwA/new`·`claude-1001/s/scratchpad`·`old.fifo`, 사라짐: `old.txt`·`gwA/old`·`gwB`.
  - `sweepTmpDueRunsAtMostOncePerInterval`: 오래된 파일 하나 두고 `GENIA_TMP_SWEEP_EVERY=3600` 로 `check_required && adopt_plugin_scripts <plugin/scripts> && sweep_tmp_due` → 지워지고 `state/tmp-swept` 생김. 새 오래된 파일을 두고 다시 → 남음. `tmp-swept` 를 2시간 전 값으로 고치고 다시 → 지워짐.
  - `supervisorSweepsTmpWhileRunning`(tmuxTest): 엔트리포인트를 `GENIA_TMP_SWEEP_EVERY=0` 으로 띄우고 칸이 뜬 뒤 4일 전 파일을 `work/tmp` 에 둔다 → 다음 회차 안에 사라진다(`until`).

- [ ] **Step 2: 실패 확인** — `pnpm --filter @smart-workplace/workplace-agent-claude-code test` → `sweep_tmp: command not found` 등 FAIL.

- [ ] **Step 3: 구현** — 위 Interfaces 대로. 주석: 무엇이 쌓였는지(transform·compile 캐시, claude-<uid>, gw*/subagent*), 부팅 때는 이 컨테이너의 어느 프로세스도 아직 tmp 를 쓰지 않아 전부 지워도 되는 이유, 소켓·`claude-*` 폴더를 남기는 이유, 캐시를 옮기지 않고 나이로 상한을 두는 이유.

- [ ] **Step 4: 통과 확인** — 이미지 네 개 테스트 PASS(다른 이미지 테스트가 `prepare_dirs` 를 부르므로 그 fixture 의 tmp 를 비워도 깨지지 않는지 본다).

- [ ] **Step 5: 커밋** — `git commit -m "fix(agent): /work/tmp 를 부팅 때 비우고 도는 동안 3일 지난 것을 지운다 (WP-1683)"`

---

### Task 4: 플러그인 — `gw-issue-status` 와 `agent-sweep`

**Files:**
- Create: `plugins/genia-works/scripts/gw-issue-status`, `plugins/genia-works/scripts/agent-sweep`
- Create: `plugins/genia-works/tests/agent-sweep.test.mjs`

**Interfaces:**
- Consumes: `worktree-sweep list|remove`(그대로), `gw_read_key`·`gw_api_request`·`gw_api_url`·`gw_valid_issue_key`·`gw_valid_project_key`·`gw_valid_name`·`gw_ai_dir`.
- Produces:
  - `gw-issue-status <AI 이름> <이슈 키>` — `GET $(gw_api_url)/projects/<키 앞>/issues/<번호>`(연결 5초·전체 15초)의 `.summary.status`(`TODO|IN_PROGRESS|DONE|CANCELED`)를 한 줄 출력, 0. 실패는 stderr 한 줄과 종료 코드: 1 키 없음·깨짐 · 2 사용법(이슈 키 형식 아님) · 4 401 · 6 403 · 8 404 · 5 닿지 못함·그 밖 HTTP·JSON 못 읽음 · 7 jq 없음. 키 원문을 어디에도 내지 않는다. 워크스페이스 헤더는 `gw_curl_auth` 가 이미 붙인다.
  - `agent-sweep <AI 폴더>` — AI 이름은 폴더 이름. `<AI 폴더>/repos/*` 중 이름이 `gw_valid_project_key` 이고 `.git` 이 있는 것마다: `worktree-sweep list <저장소> <키> <AI 이름>`(종료 2 면 `<키>\tskip fetch-failed`). 줄마다:
    - 상태가 `ok`·`notes-only` 가 아니면 `<키>\tkept <이슈 키>: <상태>`.
    - 이슈 키면 `gw-issue-status` → 0 이고 `DONE`·`CANCELED` 일 때만 `worktree-sweep remove <저장소> <경로 또는 -> <이슈 키>` 의 출력 줄을 `<키>\t<출력>` 으로. 0 이고 다른 상태면 `kept <이슈 키>: <상태>`, 실패면 `kept <이슈 키>: 상태 확인 실패(<종료 코드>)`.
    - 기차 키(`integ-<AI 이름>-<n>`)면 묻지 않고 remove.
    - 서버 실패(종료 5)를 한 번 만나면 그 뒤 이슈는 묻지 않고 모두 `kept …: 서버에 닿지 못함` (부팅이 서버 시간 제한 × 이슈 수만큼 늘지 않게).
    - 표준 입력은 `</dev/null`. 종료 0(사용법 오류만 2). `state/sweep/<키>` 는 쓰지 않는다.

- [ ] **Step 1: 테스트 쓰기** — `worktree-sweep.test.mjs` 의 git 환경 도우미(`env`·`git`·origin bare·워크트리·notes 만들기)를 같은 방식으로 쓰고(복사보다 필요한 것만 — 공용 파일로 뺄 만큼 크면 `tests/git-fixture.mjs` 로 빼서 두 테스트가 import), `scripts.test.mjs` 의 `fakeProjectServer` 처럼 가짜 서버를 둔다: `/api/v1/projects/WP/issues/<n>` 에 `{ summary: { status } }` 또는 지정 HTTP 코드. 키는 `gw-keys add kodi`. AI 폴더 `<root>/home/kodi/repos/WP`(MAIN) 아래 `.claude/worktrees/WP-1`(DONE)·`WP-2`(IN_PROGRESS)·`WP-3`(CANCELED, 워크트리 없이 notes 만)·`WP-4`(DONE 이지만 커밋 안 한 변경).
  - `gwIssueStatusPrintsCategory`: DONE → stdout `DONE\n`, 요청 주소 `/api/v1/projects/WP/issues/1`, 인증 `Bearer ak_…`, 출력에 키 없음.
  - `gwIssueStatusExitCodes`: 401→4, 403→6, 404→8, 500→5, 닿지 못함(닫은 포트)→5, `WP1` 형식 아님→2.
  - `removesDoneAndCanceledOnly`: `agent-sweep <AI 폴더>` → WP-1 워크트리·브랜치 사라짐, WP-3 notes 사라짐, WP-2 남음(`kept WP-2: IN_PROGRESS`).
  - `keepsDirtyDoneWorktree`: WP-4 남고 `kept WP-4: dirty`, 서버에 WP-4 를 묻지 않았다(요청 목록).
  - `sweepsEveryRepoEvenWithoutPane`: `repos/OPS`(두 번째 저장소, 칸 없음)의 DONE 이슈도 지워진다.
  - `keepsWorktreesWhenIssueForbiddenOrMissing`: `repos/OLD` 의 `OLD-1` 이 403, `OLD-2` 가 404 → 둘 다 남음.
  - `keepsEverythingWhenServerUnreachable`: 서버 주소를 닫은 포트로 → 아무것도 안 지움, 첫 실패 뒤 요청 없음(가짜 서버 대신 닫힌 포트이므로 출력 줄로 확인: 모든 이슈 줄이 `서버에 닿지 못함`).
  - `removesMergedTrainWithoutAsking`: `integ-kodi-1` 기차 워크트리(origin/main 에 merge 커밋으로 들어감) → 사라지고 서버 요청 없음.
  - `skipsNonRepoFolders`: `repos/bad name`, `repos/NOGIT`(git 아님) 은 건너뛰고 종료 0.

- [ ] **Step 2: 실패 확인** — `node --test plugins/genia-works/tests/agent-sweep.test.mjs` → ENOENT FAIL.

- [ ] **Step 3: 구현** — 두 스크립트(755). `gw-issue-status` 는 `gw-agent-projects` 의 `fetch` 오류 분기 모양을 따른다(404 를 8 로 따로). `agent-sweep` 머리 주석에 「worktree-sweep 은 서버를 묻지 않고, 묻는 일은 여기서 한다 — 부팅 때 MCP 없이 쓰는 길」과 work-loop 2-1 과의 관계(알림은 2-1 이 한다)를 적는다.

- [ ] **Step 4: 통과 확인** — `pnpm test:plugin` PASS.

- [ ] **Step 5: 커밋** — `git commit -m "feat(plugin): 부팅 때 모든 저장소의 끝난 이슈 워크트리를 서버 상태로 정리하는 agent-sweep 을 더한다 (WP-1683)"`

---

### Task 5: 이미지 — 부팅 때 워크트리 정리 배선

**Files:**
- Modify: `apps/workplace-agent-claude-code/bin/lib.sh` — 새 `sweep_worktrees`, `start_projects` 맨 앞(list_projects 앞)에서 부름; 머리 주석의 「함께 쓰는 것」 목록에 더함
- Test: `apps/workplace-agent-claude-code/tests/entrypoint.test.mjs`

**Interfaces:**
- Consumes: `"$GW_SCRIPTS/agent-sweep" <AI 폴더>`(Task 4).
- Produces: `sweep_worktrees` — `WORKTREES_SWEPT` 가 1 이면 0. 1 로 정한 뒤 `[ -x "$GW_SCRIPTS/agent-sweep" ]` 아니면 경고 한 줄. 있으면 `bg_wait_timeout "${GENIA_SWEEP_TIMEOUT:-600}" "$GW_SCRIPTS/agent-sweep" "$AI_DIR" > "$AI_DIR/state/boot-sweep.log" 2>&1 </dev/null`, 그 파일의 줄마다 `log "워크트리 정리: <줄>"`. 늘 0. 한 Pod 에 한 번(서버가 안 닿아 남긴 것은 칸의 work-loop 2-1 이 맡는다). `run_supervisor` 가 `WORKTREES_SWEPT` 를 비우지 않는다.

- [ ] **Step 1: 테스트 쓰기** — 가짜 curl 에 `*/projects/WP/issues/*` 분기를 더해 `$FAKE_OUT/issues.json`(`{"1":"DONE","2":"IN_PROGRESS"}`)에서 번호의 상태로 `{"summary":{"status":…}}` 와 `200` 을 낸다(없는 번호는 404).
  - `bootSweepsFinishedIssueWorktreesBeforePanes`(tmuxTest): 첫 부팅으로 저장소를 받은 뒤 SIGTERM. `repos/WP` 에 워크트리 `WP-1`·`WP-2` 와 notes 를 만들고 브랜치를 origin 에 push(올리지 않은 커밋 없게). `repos/OLD`(목록에 없는 프로젝트, origin 은 같은 bare 사본)에 `OLD-1` 워크트리 + notes(가짜 curl 404). 다시 부팅 → `WP-1` 사라짐, `WP-2`·`OLD-1` 남음, 로그에 `워크트리 정리:` 줄, `state/boot-sweep.log` 있음, 그리고 WP 칸이 떴다.
  - `sweepWorktreesRunsOncePerPod`: `callLib` 로 `WORKTREES_SWEPT=1` 을 두고 부르면 agent-sweep 을 부르지 않는다(가짜 `GW_SCRIPTS` 폴더의 `agent-sweep` 가 부르면 파일을 남기게 해 확인).

- [ ] **Step 2: 실패 확인** — 이미지 테스트 FAIL(`WP-1` 이 남음).

- [ ] **Step 3: 구현** — 위 Interfaces 대로. 주석: 칸 없는 프로젝트(소속에서 빠진 것 포함)의 워크트리도 여기서만 정리된다는 점, 칸을 띄우기 전에 하는 이유(같은 MAIN 에서 work-loop·`agent-project repo` 의 fetch 와 겹치지 않게).

- [ ] **Step 4: 통과 확인** — 이미지 네 개 테스트 PASS.

- [ ] **Step 5: 커밋** — `git commit -m "fix(agent): Pod 가 뜰 때 모든 저장소의 끝난 이슈 워크트리를 지운다 (WP-1683)"`

---

### Task 6: 외부 호스트 브라우저 정리와 플러그인 버전

**Files:**
- Modify: `plugins/genia-works/skills/start-agent/SKILL.md` — 5번 끝(「대기열 라벨」 앞)에 「브라우저 정리」 문단, 7번 표 뒤 안내 한 줄
- Modify: `plugins/genia-works/tests/skills.test.mjs` — start-agent 테스트에 단언
- Modify: `plugins/genia-works/.claude-plugin/plugin.json`, `plugins/genia-works/.codex-plugin/plugin.json`, `apps/workplace-web/public/claude/marketplace.json`, `apps/workplace-web/src/lib/pluginGuide.test.ts`, `plugins/genia-works/README.md`

**Interfaces:**
- Consumes: `browser-prune <홈>`(Task 1 — `--dir` 없이 `gw_browsers_dir` 기본값).

- [ ] **Step 1: 테스트 쓰기** — `skills.test.mjs` 에 `start-agent: 저장소 준비 뒤 브라우저 폴더를 browser-prune 으로 정리하고 실패해도 띄우기를 계속한다 (WP-1683)`: SKILL.md 에 `` `"<이 스킬 폴더>/../../scripts/browser-prune" "<홈>"` `` 문자열, `종료 3` 을 「건너뜀 — 알리기만」으로 다룬다는 문장, 정리 결과(지운 폴더 수)를 7번 표 뒤 한 줄로 알린다는 문장이 있는지. `pluginGuide.test.ts` 의 기대 ref 를 `genia-works--v0.1.52` 로.

- [ ] **Step 2: 실패 확인** — `node --test plugins/genia-works/tests/skills.test.mjs` FAIL, `cd apps/workplace-web && npx vitest run src/lib/pluginGuide.test.ts` FAIL.

- [ ] **Step 3: 고치기** — SKILL.md: 「5번이 끝나면 `"<이 스킬 폴더>/../../scripts/browser-prune" "<홈>"` 을 한 번 부른다 — 이 컴퓨터의 Playwright 브라우저 폴더에서 홈 아래 모든 AI 저장소가 쓰는 버전·사람이 받은 프로젝트(node_modules)의 브라우저·최근 playwright-cli 를 남기고 나머지를 지운다. 종료 3(설치 중·기록 없음 등)과 그 밖의 실패는 알리기만 하고 6번으로 간다. 지운 것은 `removed` 줄 수로 7번에 한 줄.」 버전 네 곳을 0.1.52 로. README 의 work-loop 워크트리 줄 뒤에 「Works 가 띄운 AI 는 Pod 가 뜰 때 모든 저장소의 끝난 이슈 워크트리를 정리하고(`scripts/agent-sweep`), start-agent 는 띄울 때 안 쓰는 Playwright 브라우저를 지웁니다(`scripts/browser-prune`) (WP-1683)」.

- [ ] **Step 4: 통과 확인** — `pnpm test:plugin` PASS, `npx vitest run src/lib/pluginGuide.test.ts` PASS.

- [ ] **Step 5: 커밋** — `git commit -m "feat(plugin): start-agent 가 호스트의 안 쓰는 Playwright 브라우저를 정리한다, 0.1.52 (WP-1683)"`

---

### Task 7: 문서

**Files:**
- Modify: `apps/workplace-agent-claude-code/README.md` — 「엔트리포인트」 1번(tmp 비움), 7번(받기 위치·정리·워크트리 정리), 8번(1시간마다 tmp 3일 정리), 「들어 있는 것」의 playwright-cli 줄(`.links` 설명은 그대로 맞는지)
- Modify: `docs/integrations/agent-pod-contract.md` — 「디스크 배치」 표의 `/work/tmp`(부팅 때 비움·3일 지난 것 지움), `/work/.cache`(브라우저 폴더에 `.genia-installs/<버전>` — 저장소 Playwright 설치 기록, 안 쓰는 브라우저는 부팅 때 지움) 칸
- Modify: `apps/workplace-agent-claude-code/bin/lib.sh` 머리 주석(10-14줄) — 새 공용 함수 이름(`clean_tmp`·`sweep_tmp_due`·`sweep_worktrees`·`prune_browsers`)

- [ ] **Step 1: 고치기** — 위 문장들. 숫자(3일·1시간·10분·600초)는 lib.sh 기본값과 같게.
- [ ] **Step 2: 확인** — `rg -n "genia-chromium" apps docs plugins` 가 옛 표시를 설명하는 남은 문장 없이(browser-prune 의 「옛 표시 지움」 주석과 테스트만) 나온다. 이미지 테스트를 한 번 더 돌린다(주석만 바뀜 — `bash -n apps/workplace-agent-claude-code/bin/lib.sh` 로도 충분).
- [ ] **Step 3: 커밋** — `git commit -m "docs(agent): 작업 공간 디스크 정리(tmp·브라우저·워크트리)를 엔트리포인트 안내와 Pod 계약에 적는다 (WP-1683)"`

---

## 마지막 확인

- [ ] `pnpm test:plugin`
- [ ] `pnpm --filter @smart-workplace/workplace-agent-claude-code test` · `…-codex test` · `…-genia-code test` · `…-opencode test`
- [ ] `cd apps/workplace-web && npx vitest run src/lib/pluginGuide.test.ts`
- [ ] (가능하면) 이미지 빌드 `docker build --platform linux/amd64 apps/workplace-agent-claude-code` 뒤 PVC 를 흉내 낸 폴더로 한 번 띄워 `/work/.cache/ms-playwright` 의 결과를 본다 — 진짜 `playwright-core` 의 폴더 이름 규칙(`-`→`_`)과 `.links` 동작이 가짜와 같은지 확인하는 유일한 길이다.

## 제품 책임자에게 물을 것

1. **호스트의 npx 로 받은 사람의 Playwright** — 외부 호스트에서 사람이 AI 와 상관없는 프로젝트를 `npx playwright …`(로컬 설치 없이)로 쓰면, 그 버전이 AI 저장소에 없을 때 `browser-prune` 이 그 브라우저를 지운다(다음 실행 때 Playwright 가 다시 받으라고 안내한다). 프로젝트 `node_modules` 로 설치한 것은 지키므로 대부분의 사람 프로젝트는 영향이 없다. 계획은 이대로(_npx 임시 설치는 AI 저장소 버전만 남김) 진행하되, 호스트에서는 `_npx` 링크를 지우지 않는 쪽(정리 효과가 거의 없어진다)을 원하면 알려 달라.
