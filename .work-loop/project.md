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
| `apps/workplace-web/` | `cd apps/workplace-web && pnpm test`(vitest 전체, 수 초) · `pnpm test:e2e e2e/<바꾼 화면 spec>` · `pnpm typecheck` |
| ↳ `vite.config.ts`·`src/App.tsx`·`src/main.tsx`·`e2e/fixtures/` 등 공유 설정 | `E2E_SERVER=preview pnpm test:e2e`(E2E 전체) |
| `apps/workplace-admin/` | `cd apps/workplace-admin && pnpm test && pnpm test:e2e` |
| `packages/mcp-tools-shared/` | `pnpm --filter @smart-workplace/mcp-tools-shared test` → `… build` → 쓰는 쪽 `pnpm --filter @smart-workplace/workplace-mcp test`·`pnpm --filter @smart-workplace/workplace-ai-agent test`·`cd apps/workplace-web && pnpm test` |
| `packages/wiki-editor-schema/` | `pnpm --filter @smart-workplace/wiki-editor-schema test` · `pnpm --filter @smart-workplace/workplace-collab test` · `cd apps/workplace-web && pnpm test` |
| `apps/workplace-mcp/`·`apps/workplace-ai-agent/`·`apps/workplace-collab/` | `pnpm --filter @smart-workplace/<앱 이름> test` (mcp·ai-agent 는 먼저 mcp-tools-shared build) |
| `apps/workplace-worker/` | `cd apps/workplace-worker && uv run pytest -q` |
| `plugins/genia-works/` | `pnpm test:plugin` · mod(`hooks/`)를 바꿨으면 `claude plugin test plugins/genia-works` |
| `scripts/live-stack.sh` | `sh scripts/live-stack.test.sh` |
| 문서(`*.md`·`docs/`)만 | 테스트 없음 |

- JS·TS 를 바꿨으면 `pnpm lint`·`pnpm typecheck` 도 돌린다.
- api 테스트는 Testcontainers 가 격리 DB 를 스스로 띄운다(Docker 데몬만 필요). dev DB(5434)는 쓰지 않는다.
- E2E 는 런마다 20000번대 랜덤 포트로 자체 Vite 를 띄우고 API 를 모킹한다 — 6173 dev 서버를 확인하거나 끄지 않는다.

## 3. 전체 회귀

여러 앱에 걸치거나 공유 영역(위 표의 「공유 설정」, `packages/`, 마이그레이션, 보안 설정)을 바꿨으면 머지 전에 돌린다.

```sh
pnpm lint && pnpm typecheck && pnpm test:plugin
pnpm test:full   # web vitest → web E2E 전체(preview) → admin E2E → api gradle 전체. push 게이트와 같다(10분 이상)
```

- 통과하면 그 커밋 트리를 「검증 완료」로 기록해, 같은 트리(스쿼시·`--no-ff` 머지 결과가 같을 때)를 push 할 때 pre-push 가 회귀를 다시 돌지 않는다 — 커밋한 상태에서 돌려야 기록된다.
- `test:full` 은 저장소 전역 락을 잡는다 — 다른 세션의 게이트가 돌고 있으면 기다린다. 락 파일을 지우거나 그 프로세스를 끝내지 않는다.
- 병렬·부하에서만 깨지는 테스트는 제외하지 말고 원인을 고친다(시간 단언·실시간 데드라인을 없애 결정적으로).

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

## 7. PR (`process-issue.md` 9번·「PR 리뷰·머지」)

- 원격은 **origin**(`git@github.com:bluleo78/smart-workplace.git`), PR 대상 브랜치는 `main`, 도구는 `gh`(세션의 `GH_TOKEN` — 준비는 플러그인 README 「PR 흐름 준비」). gitlab 원격에는 push 하지 않는다 — 사람이 origin main 을 받아 맞춘다.
- 브랜치: `<커밋 타입>/<소문자 이슈 키>`(예: `feat/wp-123`, `fix/wp-123`). 커밋 타입은 [docs/COMMIT_CONVENTION.md](../docs/COMMIT_CONVENTION.md) 의 것.
- PR 제목 `<이슈 키> <이슈 제목>`, 머지 커밋 제목 `merge: <이슈 키> <이슈 제목>`(`gh pr merge --merge` — 지금 main 이력 모양을 지킨다).
- 브랜치 push 는 pre-push 게이트(3번 「전체 회귀」와 같은 검사, 생략 규칙 포함)를 거친다. GitHub Actions 가 없으므로 이 게이트가 머지 전 유일한 회귀다 — 검토자는 최신 origin/main 위로 rebase 해 다시 push 한 뒤에만 머지한다.
- 마이그레이션(`db/migration/`)이 든 PR 을 rebase 하면 버전 번호(`V<n>__`)가 origin/main 의 마지막보다 큰지 다시 보고, 겹치면 올린 뒤 `./gradlew generateJooq` 결과를 함께 커밋한다.

## 8. 검토자

개발한 PR 을 리뷰·머지하는 AI 팀장(`SKILL.md` 「검토자」). 비어 있으면 PR 을 사람이 리뷰·머지한다.

- username: `teamleader@iacloud.kr`(AI 팀장)
