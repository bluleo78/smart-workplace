# ai-driven 스킬 — 프로젝트 프로필 (Smart Workplace)

> 사람용 참고 문서. `ai-driven-explorer` / `ai-driven-solver` / `ai-driven-pilot` 스킬 본문에는
> 아래 값들이 이미 baked 되어 있다(스킬이 런타임에 이 파일을 읽지는 않는다).
> 환경(포트·자격증명·보드 ID)이 바뀌면 **이 표를 갱신하고 세 SKILL.md + scripts/*.sh 도 함께 고친다.**

## dev_url
- **Web**: `http://localhost:6173` (workplace-web, Vite). `pnpm dev`로 기동 전제.
- **API**: `http://localhost:9090` (workplace-api, Spring Boot). web vite가 `/api` → 9090 프록시(`/api/v1` 포함, SSE 버퍼링 없음).
- api_base: `/api/v1` (예: `/api/v1/auth/login`, `/api/v1/projects`).
- **AI Agent**: `http://localhost:7070` (workplace-ai-agent, Claude Agent SDK — 이슈 컨텍스트 챗/비서).

## auth
- **scheme: `bearer`** — 로그인 응답 body의 `accessToken`(JWT HS384, 30분). refreshToken은 HttpOnly 쿠키(`/api/v1/auth`, 7일).
- login_endpoint: `POST /api/v1/auth/login`
- login_body: `{"username":"<이메일>","password":"<pw>"}` — 필드명은 **`username`**(값은 이메일). 400이면 소스 확인.
- 토큰 추출:
  ```bash
  TOKEN=$(curl -s -X POST http://localhost:6173/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${EXPLORER_USER:-bluleo78@gmail.com}\",\"password\":\"${EXPLORER_PASS:-Workplace1}\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken',''))")
  ```
- credentials: `$EXPLORER_USER`/`$EXPLORER_PASS` 우선, 미설정 시 dev 기본값 `bluleo78@gmail.com` / `Workplace1`.
  > ⚠️ 자격증명 평문 하드코딩 지양 — env 우선. (현재 dev HUMAN 계정 2명뿐: 본인 + 양동희2(email 없음). AGENT 2개는 로그인 불가.)
- UI 로그인 셀렉터: 아이디 `#username`(placeholder `email@example.com`), 비번 `#password`, 버튼 `button:has-text('로그인')`.
- state_setup: 전용 헬퍼 없음. UI 수동 로그인 후 `state-save`. React controlled input 주의 → `references/pitfalls.md` #17.

## session_prefix
- explore: `pe` · crosscheck: `pc` · solver: `ps` (pilot subagent 모드). 사용자 직접 호출은 `explorer#`/`crosscheck#`/`solver#` + random hex.
- 짧게 유지하는 이유: macOS Unix 소켓 경로 104바이트 한도 → 좀비 세션 방지.

## source_paths
- frontend: `apps/workplace-web/src` (라우팅=`App.tsx`, react-router v7). 주요 라우트: `/projects`,`/projects/:key`,`/chat`,`/drive`,`/mail`,`/contacts`,`/settings`,`/me/tasks`.
- backend: `apps/workplace-api` (Java/Gradle, Spring Modulith). 보안 정적 점검: `apps/workplace-api/src`.
- ai-agent: `apps/workplace-ai-agent` (TS, Claude Agent SDK).
- 스택 특이: Tiptap(리치 에디터, unsaved-change 가드 → pitfalls #16), @dnd-kit(이슈 보드 드래그), TanStack Query.

## db.access
- **docker psql** (로컬 Docker Compose, dev DB 포트 5434):
  ```bash
  docker exec smart-workplace-db-1 psql -U app -d workplace -c "SELECT ..."
  ```
- test DB: 상시 컨테이너 없음 — Testcontainers 가 테스트 실행 시마다 격리 DB 를 자동 기동(랜덤 포트, db `workplace_test`). 탐색은 dev DB 사용.

## security_policy
- **read_only: 없음** — 격리된 로컬 DB 기준 destructive 보안 테스트 가능. 단 실제 API 경로를 소스에서 먼저 확인(존재하지 않는 경로는 404 → 무의미). explorer §3 참조.
- security_label: **`solver-eligible`** — `security` 라벨은 solver Step 0 자동 차단 대상 아님. 코드 레벨 fix 가능 시 Step 2.1 종합 판단으로 분기.
- 체크리스트(issue-tracker 도메인): IDOR(타 사용자/멤버 아닌 프로젝트), 권한 경계(일반 토큰 → admin 엔드포인트), 대량 할당(role 주입), 미인증(401), AGENT 할당/멘션 오남용.

## area_labels
- **없음** — `bug,severity:*` (+ 보안 시 `security`)로만 등록. (모노레포지만 area 라벨 미사용.)

## design_autonomous_track
- **없음** — 모든 design 결함은 `design` 라벨(사람 큐). 레이아웃 자율 수정 트랙 비활성.

## ai_agent_boundary
- workplace-ai-agent(이슈 컨텍스트 챗/비서)의 **응답 생성 로직 결함**(사실 오류·환각·도구 호출·위임 위반·요약 누락)은 코드 fix가 아니라 프롬프트/규칙 판단(사람 영역) → explorer가 버그로 자동 등록하지 않고 `needs-decision`(사람 큐)에만 남긴다. inspector 스킬은 이 프로젝트에 없음.
- explorer가 등록 가능한 채팅 결함은 **UI 자체 문제만**: 입력창 동작, 메시지 렌더/스크롤, 첨부 업로드, 세션 ID 표시, SSE 끊김 시 UI 반응.

## heavy_pages (perf/design perspective용)
- 이슈 목록/보드(@dnd-kit 칸반), 팀 채팅 SSE 스트림, 메일 목록, 드라이브. 데스크탑 지향 — 모바일 시뮬 제외, 좁은 노트북(1280px)만.

## github_board
- Projects v2 **#4**: https://github.com/users/bluleo78/projects/4 — owner `bluleo78`, repo `smart-workplace`.
- project node `PVT_kwHOAE-_Hc4BYXS5`; Status field `PVTSSF_lAHOAE-_Hc4BYXS5zhTdrRo`(Backlog `f75ad846`·Ready `e18bf179`·In progress `47fc9ee4`·In review `aba860b9`·Done `98236657`); Iteration field `PVTIF_lAHOAE-_Hc4BYXS5zhTdrfg`(14일 주기, 2026-05-21 시작).
- 위 ID는 `.claude/skills/ai-driven-pilot/scripts/{add-to-board,board-status,sweep-iteration}.sh`에 baked. 보드 재생성 시 동기화 필요.

## doc_refs
- issue_lifecycle: `.claude/docs/issue-lifecycle.md` (ai-fix 게이트 모델)
- 앱별 컨벤션: `apps/workplace-web/CLAUDE.md`, `apps/workplace-api/CLAUDE.md`, `apps/workplace-ai-agent/CLAUDE.md`
- pre-commit: `scripts/husky/pre-commit.sh` (lint-staged → 변경영역 선택적 E2E → gradle test -x generateJooq; 풀 회귀는 pre-push)
