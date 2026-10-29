# 이 저장소의 테스트·라이브 검증 방법 (work-loop)

`/genia-works:work-loop` 스킬이 읽는 저장소 안내다(`process-issue.md` 2·6·8·9번과 「PR 리뷰·머지」, `SKILL.md` 「이슈 만들기·담당 바꾸기」·「검토자」). 사람 세션도 같은 방법을 쓸 수 있다.
경로는 모두 이슈 워크트리(`MAIN/.claude/worktrees/<이슈 키>`) 루트 기준이다. 실행 상태는 `MAIN/.work-loop/state/`(git 무시).

## 1. 새 워크트리 준비

```sh
pnpm install                                            # 전체 설치 — --filter 로 일부만 설치하면 노트 협업 E2E 가 대량으로 깨진다
pnpm --filter @smart-workplace/mcp-tools-shared build   # dist 는 git 무시라 새 워크트리에 없다 — web·mcp·ai-agent 가 이 dist 를 읽는다
```

## 2. 바뀐 범위별 테스트 (`process-issue.md` 6번)

바뀐 파일(`git diff --name-only main...HEAD`)에 해당하는 줄을 모두 돌린다.

| 바뀐 곳 | 명령 |
|---|---|
| `apps/workplace-api/` | `cd apps/workplace-api && ./gradlew test --tests "<패키지>.*"` (예: `"com.workplace.issue.*"`) · 커밋 전 `./gradlew spotlessApply` |
| ↳ `db/migration/` | 위에 더해 `./gradlew generateJooq` 로 `src/main/generated` 를 다시 만들어 함께 커밋. 버전 번호(`V<n>__`)가 main 의 마지막보다 큰지 rebase 뒤 다시 확인 |
| `apps/workplace-web/` | `cd apps/workplace-web && pnpm test`(vitest 전체, 40초 안팎) · `pnpm test:e2e e2e/<바꾼 화면 spec>` · `pnpm typecheck` |
| ↳ `vite.config.ts`·`src/App.tsx`·`src/main.tsx`·`e2e/fixtures/` 등 공유 설정 | `E2E_SERVER=preview pnpm test:e2e`(E2E 전체) |
| `apps/workplace-admin/` | `cd apps/workplace-admin && pnpm test && pnpm test:e2e` |
| `packages/mcp-tools-shared/` | `pnpm --filter @smart-workplace/mcp-tools-shared test` → `… build` → 쓰는 쪽 `pnpm --filter @smart-workplace/workplace-mcp test`·`pnpm --filter @smart-workplace/workplace-ai-agent test`·`cd apps/workplace-web && pnpm test` |
| `packages/wiki-editor-schema/` | `pnpm --filter @smart-workplace/wiki-editor-schema test` · `pnpm --filter @smart-workplace/workplace-collab test` · `cd apps/workplace-web && pnpm test` |
| `apps/workplace-mcp/`·`apps/workplace-ai-agent/`·`apps/workplace-collab/` | `pnpm --filter @smart-workplace/<앱 이름> test` (mcp·ai-agent 는 먼저 mcp-tools-shared build) |
| `apps/workplace-worker/` | `cd apps/workplace-worker && uv run pytest -q` |
| `plugins/genia-works/` | `pnpm test:plugin` · mod(`hooks/`)를 바꿨으면 `claude plugin test plugins/genia-works` |
| `scripts/live-stack.sh` | `sh scripts/live-stack.test.sh` |
| `scripts/*.mjs` | `pnpm test:scripts` |
| `.dockerignore`·앱 `tsconfig*.json`·`src/test/` 를 옮기거나 테스트 도우미를 새로 둠 | `pnpm typecheck:image`(.dockerignore 를 뺀 복사본에서 web·admin·collab tsc, 1분 안팎) |
| 문서(`*.md`·`docs/`)만 | 테스트 없음 |

- JS·TS 를 바꿨으면 `pnpm lint`·`pnpm typecheck` 도 돌린다.
- api 테스트는 Testcontainers 가 격리 DB 를 스스로 띄운다(Docker 데몬만 필요). dev DB(5434)는 쓰지 않는다.
- E2E 는 런마다 20000번대 랜덤 포트로 자체 Vite 를 띄우고 API 를 모킹한다 — 6173 dev 서버를 확인하거나 끄지 않는다.

### 웹 테스트를 어디에 쓰나 (WP-971)

새 테스트는 **기본이 vitest** 다(순수 함수 `*.test.ts`, 페이지 테스트 `*.test.tsx` + `renderPage`·MSW). 아래 이유가 있을 때만 E2E 로 쓰고 그 태그를 단다 — 태그 없는 E2E 는 `pnpm lint` 가 막는다.

| 태그 | E2E 로 쓰는 경우 |
|---|---|
| `@layout` | 폭·겹침·넘침·스크롤 위치·정렬 — jsdom 이 못 재는 기하 |
| `@input` | 포커스 이동·복원, IME 조합, 드래그, 길게 누르기, 호버, 붙여넣기, 파일 드롭 |
| `@platform` | SW/PWA, 다운로드, 클립보드, 실제 SSE·collab 연결, PDF·미디어 렌더 |
| `@wiring` | 화면당 1건 — 라우트 → 페이지 → API 실제 배선 |
| `@flow` | 여러 화면을 넘나드는 흐름 |

payload·쿼리·4xx/5xx 메시지·권한/조건부 렌더·유효성·빈/로딩 상태·문구는 vitest 다. 자세한 기준과 페이지 테스트 쓰는 법은 `apps/workplace-web/CLAUDE.md` 「테스트 종류 판정」·「단위·페이지 테스트」.

## 3. 전체 회귀

여러 앱에 걸치거나 공유 영역(위 표의 「공유 설정」, `packages/`, 마이그레이션, 보안 설정)을 바꿨으면 머지 전에 돌린다.

```sh
pnpm lint && pnpm typecheck && pnpm test:plugin
pnpm test:full   # 이미지 입력 타입 검사 → web vitest → web E2E 전체(preview) → admin E2E → api gradle 전체. push 게이트와 같다(10분 이상)
```

- 통과하면 그 커밋 트리를 「검증 완료」로 기록해, 같은 트리(스쿼시·`--no-ff` 머지 결과가 같을 때)를 push 할 때 pre-push 가 회귀를 다시 돌지 않는다 — 커밋한 상태에서 돌려야 기록된다.
- **범위(WP-1208)**: `test:full` 은 origin/main 과 갈라진 뒤 바꾼 코드 파일로 단계를 줄인다(`scripts/husky/gate-scope.sh`) — `apps/workplace-web` 만 → 이미지 타입 검사·web vitest·web E2E, `apps/workplace-admin` 만 → 이미지 타입 검사·admin E2E, 두 앱만 → gradle 만 건너뜀. api·`packages/`·`scripts/`·lockfile·루트 설정·`plugins/` 가 하나라도 있거나 판정할 수 없으면 전체. 첫 줄 `[full-regression] 범위: …` 에 고른 범위가 찍힌다. `FULL_REGRESSION_SCOPE=full pnpm test:full` 이면 전체를 강제한다.
- 범위를 줄여 통과한 트리는 「<트리> <범위>」로 기록되고, pre-push 는 push 하는 커밋에 지금(원격 main 기준) 필요한 범위를 그 기록이 덮을 때만 회귀를 건너뛴다.
- `test:full` 은 저장소 전역 락을 잡는다 — 다른 세션의 게이트가 돌고 있으면 기다린다. 락 파일을 지우거나 그 프로세스를 끝내지 않는다.
- 락을 기다리는 게이트는 로그에 `[test-lock] 다른 세션이 테스트 게이트 실행 중 — 대기합니다` 만 있고, 잡으면 `[test-lock] 락 획득 — 게이트 실행` 이 찍힌다.
- 병렬·부하에서만 깨지는 테스트는 제외하지 말고 원인을 고친다(시간 단언·실시간 데드라인을 없애 결정적으로).

### 기차 (WP-1216 — 개발 PR 의 기본 경로)

이 저장소는 기차 흐름을 켠다(`process-issue.md` 「기차」). 이슈마다 PR 을 내지 않고, 끝낸 이슈를 내 통합 브랜치 `integ/<AI 이름>-<번호>`(AI 이름 = 내 username 의 `@` 앞, 예: `integ/developer3-4`)에 커밋 하나씩 쌓아 기차마다 push 게이트 한 번·PR 하나로 올린다. 게이트 락이 이 저장소 사본마다 하나라 이슈마다 게이트를 띄우면 한 AI 의 이슈들이 한 줄로 기다리고, 예전 묶음 게이트(WP-1208)는 게이트만 합쳐 돌고 PR 은 이슈마다 내서 A+B 로 통과한 뒤 B 가 반려되면 A 혼자의 트리가 검증 없이 머지됐다.

```sh
pnpm train stack <AI 이름> <feature 브랜치> <이슈 키>   # 다음 기차에 커밋 하나로 쌓는다(출발한 기차는 건너뛰고, 없으면 새 번호를 origin/main 에서)
pnpm train rebase <기차 브랜치>                         # 출발 전 → 최신 origin/main 으로. 출발한 기차 → main 과 충돌할 때만
pnpm train next <AI 이름>                               # 아직 출발하지 않은 기차(없으면 빈 출력)
pnpm train keys <기차 브랜치>                           # 실린 이슈 키 「K1·K2」 — PR 제목 `통합 K1·K2`
```

- 스크립트는 `scripts/husky/train.sh`(테스트 `train.test.sh`). 「출발」 = 기차 브랜치를 origin 에 push 한 것. 기차마다 워크트리 `MAIN/.claude/worktrees/integ-<AI 이름>-<번호>` 를 스크립트가 만든다 — 게이트·수정 커밋·push 는 그 안에서 한다. 처음 게이트를 돌기 전에 1절처럼 설치·빌드한다.
- 쌓기는 feature 의 커밋 하나(제목 끝 `(<이슈 키>)`, 작성자 유지)를 그대로 옮긴다. 마이그레이션 번호가 origin/main·앞서 실린 이슈와 겹치거나 앞서 실린 이슈와 충돌하면 쌓지 않고 멈춘다 — feature 에서 고쳐 다시 쌓는다.
- 출발: 내 앞 기차의 PR 이 main 에 머지됐거나 처음일 때만. 최신 origin/main 으로 rebase → 기차 워크트리에서 `pnpm test:full`(백그라운드) → `git push -u origin <기차>` → PR(제목 `통합 <키>·…`, 본문 첫 줄 `개발: <username>`, 이슈마다 요약·검증 근거·라이브 검증).
- 게이트 실패·반려: 같은 기차에 수정 커밋(제목 끝에 고친 이슈 키)을 더해 다시 돈다. 출발한 기차는 main 과 충돌할 때만 rebase 한다(그때는 게이트를 다시 돌고 `--force-with-lease`).
- 다른 AI 의 이슈는 내 기차에 싣지 않는다.

### 커밋 훅으로 충분한 것 (`process-issue.md` 9번 「돌릴지부터 판단」, WP-1209)

push 게이트(`pnpm test:full`)가 커밋 훅보다 더 돌리는 것은 web 페이지 테스트·web E2E 전체·admin E2E·api gradle 전체다(이미지 입력 타입 검사는 테스트 파일을 빼고 본다). 브랜치가 바꾼 파일이 모두 아래에 들면 게이트가 더 확인할 것이 없으니 돌리지 않고 옆의 테스트만 돌린다. web·admin·api·collab 의 제품 코드나 `scripts/` 가 하나라도 바뀌었으면 해당하지 않는다.

- `plugins/genia-works/` — 게이트가 돌지 않는다. `pnpm test:plugin`
- 플러그인 버전 문자열(`plugins/genia-works/.claude-plugin/plugin.json` 의 `version`, `apps/workplace-web/public/claude/marketplace.json` 의 `ref`, `apps/workplace-web/src/lib/pluginGuide.test.ts` 의 기대 ref) — `pnpm test:plugin` 과 `pluginGuide` vitest(`apps/workplace-web` 에서 `npx vitest run src/lib/pluginGuide.test.ts`)
- web 단위 테스트 파일(`apps/workplace-web/src/**/*.test.ts` — `renderPage`·`renderScreen` 을 쓰지 않는 것) — 커밋 훅이 web vitest(페이지 테스트 제외)로 이미 돌렸다
- api 테스트 파일(`apps/workplace-api/src/test/**`) — 커밋 훅이 바뀐 테스트 클래스를 이미 돌렸다
- 비코드(`scripts/husky/noncode.sh` — 문서·릴리스 노트·`.work-loop/` 등) — pre-push 도 원래 건너뛴다

### 오래 걸리는 작업 (`process-issue.md` 「오래 걸리는 작업」·9번)

work-loop 는 아래 명령을 기다리지 않고 이슈 워크트리에서 백그라운드로 돌린다. 예상 시간은 `nextRunAt` 을 잡는 기준이다(대략값 — 락 대기는 빠져 있다).

| 명령 | 예상 시간 |
|---|---|
| `pnpm test:full`(push 게이트) | 45분 |
| `pnpm test:full` — web 만 바꾼 범위(admin E2E·gradle 빠짐) | 36분 |
| 기차 출발 게이트(`pnpm test:full`, 기차 워크트리) | 실린 이슈들의 범위에 따라 위와 같음 |
| `E2E_SERVER=preview pnpm test:e2e`(웹 E2E 전체, `apps/workplace-web`) | 35분 |
| `./gradlew test`(api 전체, `apps/workplace-api`) | 10분 |

- **push 게이트 미리 돌리기(9번)**: 커밋한 상태에서 `pnpm test:full` 을 띄운다. 통과하면 그 트리가 기록돼 뒤의 `git push` 가 회귀를 다시 돌지 않는다. 지금 HEAD 트리가 이미 기록돼 있는지는 워크트리에서 `sh -c '. scripts/husky/noncode.sh && . scripts/husky/gate-scope.sh && . scripts/husky/verified-trees.sh && is_verified_head'` 로 본다(성공이면 기록됨 — 다시 돌리지 않는다. HEAD 에 필요한 범위를 origin/main 기준으로 구해 pre-push 와 같게 판정한다). 기차는 기차 워크트리에서 이렇게 돌린다(위 「기차」).
- 한 번에 `test:full` 하나만 돈다(전역 락). 다른 이슈의 게이트를 띄우면 락을 기다리느라 그만큼 늦게 끝난다.

## 4. 격리 라이브 스택 (`process-issue.md` 8·10번)

```sh
LIVE_STACK_NAME=work-loop scripts/live-stack.sh up <워크트리 경로>   # 그 워크트리 코드로 DB·API·웹을 띄운다(처음 1~2분: bootJar 빌드)
LIVE_STACK_NAME=work-loop scripts/live-stack.sh status               # 띄운 것(비밀번호 빼고)
LIVE_STACK_NAME=work-loop scripts/live-stack.sh down                 # 이 이름의 상태 파일에 적힌 것만 내린다
```

- **work-loop 는 늘 `LIVE_STACK_NAME=work-loop` 를 붙인다**(up·status·down 모두). 이름마다 상태 파일·로그가 따로라, 사람이 이름 없이(`default`) 띄운 스택을 보거나 내리지 않고 겹쳐 띄우기로 막히지도 않는다. 이름은 영문·숫자·`_`·`-` 만 쓴다.

`up` 이 하는 일:
1. 빈 포트를 고른다(모든 포트는 `127.0.0.1` 에만 연다 — DB 컨테이너 공개, API `--server.address`, 웹 `--host` 모두) — API 6160·웹 6273·DB 5444 부터 쓰는 중이면 +1. 다른 세션 포트(6060·6070·6080·6090·6095·6173·6174·5434)는 비어 있어도 고르지 않는다.
2. 빈 DB 컨테이너 `wl-<pid>-db`(`pgvector/pgvector:pg18`)를 띄운다.
3. 그 워크트리에서 `./gradlew bootJar -x test` 로 jar 를 만들어 띄운다(`local` 프로필, 고른 포트·DB, `app.cors.allowed-origins=http://localhost:<웹>`). 비밀값은 MAIN 의 `.env` 를 그 프로세스 안에서만 읽는다. 웹과 같은 커밋의 jar 다 — 웹보다 낡은 API 는 로그인 새로고침 반복을 낸다.
4. 웹은 `DEV_API_PORT=<API> DEV_COLLAB_PORT=9` 로 `vite --port <웹> --strictPort` — 노트 동시 편집 ws 를 닫힌 포트로 보내 다른 세션의 collab(6095)에 붙지 않는다.
5. `/actuator/health` UP·웹 200 을 기다린 뒤, 첫 signup 으로 ADMIN 계정을 만들고 웹 프록시를 거친 브라우저식 로그인(Origin 포함)이 200 인지 확인한다.

상태 파일 `MAIN/.work-loop/state/live-stack-<이름>.env`(work-loop 는 `live-stack-work-loop.env`). `KEY='값'` 줄 — 값은 작은따옴표로 감싸 있어 셸에서 `. ` 로 읽어도 안전하다:
`TARGET` `API_PORT` `WEB_PORT` `DB_PORT` `DB_CONTAINER` `API_PID` `WEB_PID` `ADMIN_USER` `ADMIN_PASSWORD`.
로그는 같은 폴더의 `live-stack-<이름>-api.log`·`live-stack-<이름>-web.log`(down 뒤에도 남고 같은 이름의 다음 up 때 지운다). 실패하면 `up` 이 띄운 것을 스스로 내리고 로그 끝을 보여 준다.

검증할 때:
- 화면은 브라우저로 `http://localhost:<WEB_PORT>` 에(API 의 CORS 가 `localhost` 만 허용한다 — `127.0.0.1` 로 열면 로그인 403) `ADMIN_USER`/`ADMIN_PASSWORD` 로 로그인해 조작한다. 스크린샷은 `MAIN/.work-loop/state/evidence/<이슈 키>/` 에 둔다.
- API 토큰: `curl -s -X POST http://localhost:$API_PORT/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"…","password":"…"}'` 의 `accessToken`.
- 사용자를 더 만들려면 ADMIN 토큰으로 `POST /api/v1/users` `{username(이메일), email, name, password(대·소문자·숫자 8자 이상), role}`. signup 은 첫 계정에만 열린다.
- 이 스택에는 ai-agent·worker·collab 이 없고, API 의 연동(`workplace.{ai-agent,worker,collab}.enabled=false`)과 웹의 collab ws 프록시(닫힌 포트 9)도 끊어 둔다 — 그대로 두면 다른 세션의 6070·6080·6095 에 붙는다. AI 응답·첨부 추출·노트 동시 편집에 기대는 완료 기준은 여기서 확인할 수 없다 — 「로컬에서 검증할 수 없음」과 이유를 근거에 적는다.
- 다 쓰면 `LIVE_STACK_NAME=work-loop scripts/live-stack.sh down`. 내린 뒤 포트가 아직 쓰는 중이라고 경고하면 남의 것일 수 있으니 직접 죽이지 않는다.
- `down` 이 DB 컨테이너를 지우지 못하면(docker 에 닿지 않음 등) 오류로 끝나고 상태 파일을 남긴다 — 그동안 같은 이름의 `up` 은 막힌다. docker 가 돌아오면 같은 `down` 을 다시 한다. docker 는 공유 런타임이라 재시작하지 않고 막힘으로 남긴다.

## 5. 지켜야 할 것

- 다른 세션이 쓰는 포트(6060 API·6070 ai-agent·6080 worker·6090 MCP·6095 collab·6173 웹·6174 admin·5434 dev DB)에 띄우거나 그 프로세스를 끝내지 않는다. 내가 띄운 것(내 이름의 상태 파일에 적힌 것)만 내린다.
- 루트 `pnpm dev` 는 쓰지 않는다 — 시작할 때 위 포트를 듣는 프로세스를 죽인다(`scripts/free-ports.mjs`). `pnpm db:up`·`db:down`·`db:reset` 도 쓰지 않는다(공유 dev DB).
- `docker rm`·`docker stop` 은 내가 띄운 `wl-*-db` 에만 한다(`live-stack.sh down` 이 한다).
- main 작업 폴더(MAIN)에서 브랜치를 만들거나 바꾸지 않는다. 모든 수정은 이슈 워크트리에서 한다.
- `.env` 내용을 출력하거나 로그·이슈 챗에 옮기지 않는다.
- 커밋 메시지는 [docs/COMMIT_CONVENTION.md](../docs/COMMIT_CONVENTION.md), 코드 주석은 [docs/CODING_CONVENTION.md](../docs/CODING_CONVENTION.md)(한국어 주석 필수)를 따른다.

## 6. 대기열 라벨

다른 AI 에게 일을 넘길 때 아래 역할이면 특정 AI 를 담당으로 넣지 않고 그 라벨을 붙인다(`SKILL.md` 「이슈 만들기·담당 바꾸기」). 그 라벨로 도는 AI(`--queue "<라벨>"`) 중 할 일이 없는 AI 가 하나 가져간다. 표에 없는 역할은 지금처럼 설명을 보고 AI 를 고른다. 대기열 라벨 이름은 숫자만으로 짓지 않고 쉼표(,)를 넣지 않는다 — `list_issues` 의 label 필터가 숫자는 라벨 id 로, 쉼표는 구분자로 읽는다.

| 역할 | 라벨 |
|---|---|
| 개발 일(구현·결함 수정) | `AI 개발팀` |

### 선행 관계로 막힌 이슈 (WP-997)

이슈 DONE 은 운영 배포 뒤에 사람이 처리하므로, 서버의 `blocked`(선행이 DONE·CANCELED 가 아님)는 선행이 main 에 들어간 뒤에도 배포 전까지 켜져 있다. 후속 개발은 main 위에서 하므로 배포를 기다리지 않는다 — 내 이슈든 대기열 이슈든 `blocked` 를 아래 기준으로 다시 판정한다.

- 모든 선행(`get_issue_detail` 의 `blockedBy`)이 다음 중 하나면 착수할 수 있다: DONE·CANCELED / 선행 PR(제목이 `<선행 키> ` 로 시작하는 것 중 가장 최근 것 — `process-issue.md` 맨 위 갈래와 같은 조회)이 `MERGED` / 선행의 AI 작업이 「<커밋> 머지 — 검토 대기」(REVIEW).
- 선행 본문이 사람 확인을 확정 조건으로 걸면(예: WP-975 「규칙안은 사람 확인을 받아야 확정」) 그 확인 글(사람이 쓴 이슈 챗·댓글)이 선행 이슈에 있어야 한다. 없으면 착수하지 않는다.
- 후속 본문의 착수 조건 「WP-N 완료」는 이 기준으로 읽는다. 본문이 다른 조건(시안 확인, 같은 파일을 고치는 이슈 대기 등)을 더 걸었으면 그것도 따른다.
- 하나라도 맞지 않으면 대기열에서 가져가지 않는다(가져간 뒤 막혀 있으면 `BLOCKED` + 기다리는 선행). 서버의 `blocked` 표시·DONE 처리 방식은 바꾸지 않는다.

## 7. PR (`process-issue.md` 9번·「PR 리뷰·머지」)

- 원격은 **origin**(`git@github.com:bluleo78/smart-workplace.git`), PR 대상 브랜치는 `main`, 도구는 `gh`(세션의 `GH_TOKEN` — 준비는 플러그인 README 「PR 흐름 준비」). gitlab 원격에는 push 하지 않는다 — 사람이 origin main 을 받아 맞춘다.
- 브랜치: 이슈마다 feature `<커밋 타입>/<소문자 이슈 키>`(예: `feat/wp-123`, `fix/wp-123` — push 하지 않는다), PR 은 기차 `integ/<AI 이름>-<번호>`(3절 「기차」). 커밋 타입은 [docs/COMMIT_CONVENTION.md](../docs/COMMIT_CONVENTION.md) 의 것.
- PR 제목 `통합 <키1>·<키2>·…`, 머지 커밋 제목 `merge: 통합 <키1>·<키2>·…`(`gh pr merge --merge` — 지금 main 이력 모양을 지킨다). 기차가 생기기 전에 올린 이슈 PR(제목 `<이슈 키> <이슈 제목>`, 머지 커밋 `merge: <이슈 키> <이슈 제목>`)은 그대로 리뷰·머지한다.
- **통합 PR 리뷰(WP-1216)**: 이슈 단위로 리뷰하고(이슈 하나 = 커밋 하나 + 그 키를 단 수정 커밋) 게이트 통과·마이그레이션 번호(아래 0번)·합친 상태 검사(아래 1번)를 확인한다. 하나라도 문제면 PR 전체를 반려하고 어느 이슈가 왜 문제인지 적는다 — 개발자는 같은 PR 에 수정 커밋을 더한다. 통과하면 머지하고 실린 이슈마다 검토 대기(REVIEW)로 올린다 — 머지 커밋은 `message` 에.
- 브랜치 push 는 pre-push 게이트(3번 「전체 회귀」와 같은 검사, 생략 규칙 포함)를 거친다. 전체 E2E·api JUnit 은 이 게이트만 돌린다 — 검토자는 origin/main 과 **충돌하는** 브랜치만 개발자에게 rebase 를 요청하고(검토자는 push 하지 않는다), 충돌 없이 main 이 앞서 있기만 한 브랜치는 그대로 머지한다(WP-998 — 낡았다는 이유로 돌려보내면 rebase 마다 게이트를 다시 돌아 머지가 멈춘다). 다만 마이그레이션 번호와, main 이 같은 앱을 고친 경우는 아래 「검토자 머지 판단」대로 머지 전에 본다. 그 밖의 합친 결과의 회귀는 머지 뒤 아래 CI 와 다음 push 게이트가 잡는다.
- **CI(GitHub Actions, WP-993)**: PR(main 대상)·main push 마다 `.github/workflows/ci.yml` 의 `verify`(전체 `pnpm lint`·`pnpm typecheck`·웹 vitest)가 돈다. `main` 브랜치 보호가 `verify` 를 required check 로 건다 — 최신 main 포함 요구(strict)는 끈다(충돌 없는 낡은 브랜치도 머지 — WP-998), PR 필수는 아니고 관리자 직접 push 는 막지 않는다.
  - 검토자는 머지 전에 `gh pr checks <번호>` 로 `verify` 통과를 확인한다(진행 중이면 기다리고, 실패면 실패한 단계·로그 요지를 적어 반려한다).
  - 머지는 **`--admin` 없이** `gh pr merge --merge …` 로만 한다. AI 들이 관리자 계정을 함께 쓰므로 `--admin` 을 붙이면 보호가 뚫린다 — 어떤 경우에도 붙이지 않는다(거절되면 이유를 보고 고치거나 BLOCKED).
  - main push 의 CI 실패는 9절 「할 일 없을 때」에서 확인해 알린다.
- 검토자는 PR 이 더한 E2E 마다 판정 태그가 그 테스트에 맞는지 본다 — 태그가 붙어 있어도 실제로는 payload·권한·문구만 보는 테스트면 vitest 로 옮기라고 반려한다(2절 「웹 테스트를 어디에 쓰나」).
- 마이그레이션(`db/migration/`)이 든 PR 을 rebase 하면 버전 번호(`V<n>__`)가 origin/main 의 마지막보다 큰지 다시 보고(`pnpm check:migrations origin/main`), 겹치면 올린 뒤 `./gradlew generateJooq` 결과를 함께 커밋한다.

### 검토자 머지 판단 (WP-1081)

PR 의 `verify` 는 「그 PR + 갈라진 시점의 main」만 본다 — 줄 충돌은 없지만 함께 들어가면 깨지는 경우(의미 충돌)는 머지 뒤 main CI 에서야 드러난다. 그렇다고 PR 마다 합친 상태로 전체 테스트를 돌리면 머지가 크게 늦어지므로(웹 vitest 전체 약 11분), 위험이 있을 때만 돌린다.

0. **마이그레이션 번호 확인(늘, 머지 직전)**: `git fetch origin main <PR 브랜치>` 뒤 `node scripts/check-migration-versions.mjs origin/main origin/<PR 브랜치>`(`pnpm check:migrations …` 와 같다). PR 이 더한 `V<n>__*.sql` 이 origin/main 의 가장 큰 번호보다 크고 서로·main 과 겹치지 않는지 본다 — 두 PR 이 같은 번호를 각자 더하면 git 충돌도 각 PR 의 `verify` 실패도 없이 합친 main 에서 Flyway 가 깨진다. 실패(종료 코드 1)면 머지하지 않고 겹친 번호를 적어 개발자에게 번호를 옮겨 달라고 돌려보낸다. 마이그레이션을 더한 PR 이 둘 이상이면 묶지 않고 하나씩 머지하며, 앞의 것이 머지된 뒤 다음 PR 을 다시 확인한다. 같은 스크립트가 개발자의 pre-push 게이트(원격 main 기준)와 CI `verify`(머지 커밋의 첫 부모 기준)에서도 돈다 — PR 을 연 뒤 main 이 움직일 수 있어 검토자 확인은 그대로 한다.
1. **조건부 합친 검사**: PR 과 **같은 앱**(`apps/<앱>/` — workplace-web·workplace-api·workplace-admin 등)을 main 이 아래 기준 시점 뒤에 고쳤으면, 최신 main 과 로컬에서 합친 상태(임시 워크트리에서 `git merge --no-ff` — 커밋하지 않고 검사용으로만 쓴다)로 그 앱의 테스트를 돌린다. 다른 앱만 바뀌었으면 지금처럼 바로 머지한다. 합친 상태로 API 전체를 돌리면 부하 속에서 47분까지 걸렸다(PR #952, 6634개) — 아래처럼 범위를 고른다.
   - **웹·admin(lint·typecheck·vitest — CI 가 도는 것)**: `verify` 는 pull_request 의 merge ref(그때 main 과 합친 상태)로 돌았으니 그 결과를 쓴다. **verify 이후** main 이 같은 앱을 고쳤을 때만(`git log --first-parent --since=<verify 시작 시각> --name-only origin/main -- apps/<앱>/`, 시각은 `gh pr checks <번호> --json name,startedAt`) 다시 돌린다 — 웹: `pnpm --filter @smart-workplace/workplace-web test` + `pnpm --filter @smart-workplace/workplace-web typecheck`.
   - **API(CI 에 없고 개발자 push 게이트에서만 돈다 — 합친 검사의 주 대상)**: PR 이 **갈라진 뒤** main 이 api 를 고쳤으면(`git diff --name-only $(git merge-base origin/main <PR>) origin/main -- apps/workplace-api/`) 돌린다. 기본은 양쪽이 바꾼 패키지의 테스트만(`./gradlew test --tests 'com.workplace.<패키지>.*'`, `apps/workplace-api`), 공용 코드(`global`(보안 `global/security` 포함)·DB 스키마 — 마이그레이션·jOOQ)가 바뀌었을 때만 `./gradlew test` 전체.
2. **묶음**: 비슷한 때 준비된 PR 들(그때 함께 준비된 2~4개 — 묶으려고 일부러 기다리지 않는다)이 같은 앱을 고치면, 머지할 순서대로 로컬에서 모두 합쳐 1번 검사를 한 번만 한다. 통과하면 같은 순서로 GitHub 에서 하나씩 머지하고, 실패하면 원인 PR 을 가려 그 PR 만 돌려보낸다.
3. **하나씩**: 같은 파일·영역(DB 마이그레이션, 공통 토큰, 공통 유틸·테스트 헬퍼)을 고치는 PR 은 묶지 않고 하나씩 머지한다.
4. **판단은 검토자 몫**: 1~3 은 기준이고, 바뀐 범위가 작거나 명백히 무관하면 검토자가 범위를 줄일 수 있다(0번은 줄이지 않는다). 무엇을 왜 돌렸는지(또는 건너뛰었는지)를 리뷰 보고에 한 줄 남긴다(예: 「main 이 web 을 고쳐 합친 상태로 web vitest·tsc 통과」, 「main 변경은 api 만 — 합친 검사 생략」).
5. **불안정한 테스트**: 합친 검사에서 실패한 테스트가 해당 PR 들과 무관하고 다시 돌려 통과하면 반려 사유로 삼지 않고, 불안정 테스트 이슈로 등록한다(`SKILL.md` 「이슈 만들기·담당 바꾸기」).
6. 검토자는 여전히 push 하지 않는다 — 로컬에서 합친 상태는 검사용으로만 쓰고 버린다(임시 워크트리 정리).

## 8. 검토자

개발한 PR 을 리뷰·머지하는 AI 팀장(`SKILL.md` 「검토자」). 비어 있으면 PR 을 사람이 리뷰·머지한다.

- username: `teamleader@iacloud.kr`(AI 팀장)

## 9. 할 일 없을 때 (`SKILL.md` 3번 「할 일 없음」)

- **main CI 실패**: `gh run list --branch main --workflow CI --limit 5` 에서 가장 최근 실행이 실패면, 깨뜨린 커밋(실행의 `headSha`) 제목의 이슈 키로 그 이슈 챗에 실패 단계·로그 요지(`gh run view <id> --log-failed` 끝부분)를 알린다(상태가 바뀌지 않으니 `add_issue_chat`). 이슈 키가 없으면 실행 끝 요약에만 적는다. 이미 같은 실행을 알렸으면(그 이슈 챗에 실행 id 가 있으면) 다시 알리지 않는다. 내 이슈면 고친다 — 그 이슈를 이번 부르기의 이슈로 골라 처리한다.
