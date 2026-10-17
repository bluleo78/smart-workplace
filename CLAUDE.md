# Smart Workplace

AI Native 워크플레이스 — 사람과 AI가 함께 일하는 협업 플랫폼.

v1: AI를 Assignee로 둘 수 있는 이슈 트래커(+이슈 컨텍스트 chat). 팀 채팅(messaging)·알림(notify) 확장 중 — 향후 노트 / drive.

## Commands

- `pnpm install` / `pnpm build` / `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck`
- `pnpm db:up` / `pnpm db:down` / `pnpm db:reset` / `pnpm db:logs`

## Key Files

- 앱별 상세: `apps/workplace-api/CLAUDE.md`, `apps/workplace-web/CLAUDE.md`, `apps/workplace-ai-agent/CLAUDE.md`
- 커밋 컨벤션: [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)
- 코딩 컨벤션: [docs/CODING_CONVENTION.md](docs/CODING_CONVENTION.md)
- 로컬 DB: 포트 5434(dev). 컨테이너 `smart-workplace-db-1`. 테스트는 Testcontainers 가 격리 DB 를 자동 기동(Docker 데몬만 필요, 별도 컨테이너 상시 기동 불요)
- 로컬 서버 포트는 6000번대로 통일: API 6060 · AI Agent 6070 · Worker 6080 · Converter 6085 · MCP 6090 · Web 6173 · Admin 6174
- (운영은 Helm 차트 `deploy/helm` 이 컨테이너 포트를 따로 정한다 — 로컬 포트 변경과 무관. 릴리스·반영 절차는 `docs/ops/release.md`)

## 이슈 관리

- 이슈/작업 관리는 **GitHub Projects v2 #4** 에서 진행: https://github.com/users/bluleo78/projects/4
- 새 작업은 착수 전 이슈로 등록(에픽-하위 구조 사용). 현재/예정 작업은 **현재 이터레이션**에 할당.
- **이슈 제목 컨벤션**: `Phase N` 같은 단계 번호 문구를 제목에 쓰지 않는다. 작업 내용으로 기술하고, 순서는 에픽 본문/이슈 정렬로 표현.
- **특정 이슈에 착수할 때**: 해당 이슈의 Status 를 진행 단계로 변경(`In progress` 등)하고, **현재 이터레이션에 미할당이면 할당**한다.
- 조작은 `gh` CLI(Projects v2 GraphQL) 사용. 필드/옵션/이터레이션 ID 는 자동 메모 참조.

## Rules

- **한국어 주석 필수**: 클래스·메서드·주요 로직에 무엇을·왜. 상세는 [코딩 컨벤션](docs/CODING_CONVENTION.md)
- **커밋/배포 금지**: 사용자 명시적 승인 후에만 실행
- **테스트 필수**: backend → JUnit 통합 테스트, frontend → Playwright E2E(브라우저가 필요 없는 순수 로직은 vitest 단위 테스트 — `apps/workplace-web/CLAUDE.md` 참조)
- **이슈 관리**: 작업 착수 시 GitHub Projects #4 이슈 상태 변경 + 현재 이터레이션 할당 (위 "이슈 관리" 참조)
- **스크린샷**: 탐색 → `test-results/exploratory/<기능>/<timestamp>/screenshots/`, TC → `test-results/tc/<suite>/`

## work-loop 로 도는 AI 세션

`/genia-works:work-loop` 로 할당 이슈를 혼자 처리하는 AI 세션(AI 신원, 사람이 지켜보지 않음)에는 아래가 위 Rules·사용자 메모리의 규칙보다 먼저다. 사람과 함께 일하는 세션에는 해당하지 않는다.

- **work-loop 실행 = 커밋·main 머지 승인이다.** 「커밋/배포는 승인 뒤」의 커밋, 「main 머지는 의견 들은 뒤」, 「수정 전 설명·승인」은 사람과 함께 일하는 세션의 규칙이라 적용하지 않는다.
- **묻는 때는 UI/UX·아키텍처·설계·접근 방안에서 명확하지 않은 부분이 있을 때뿐이다**(스킬 `process-issue.md` 4번 기준). 그 밖의 결정은 스스로 내리고 「내가 정한 것」으로 기록한다.
- **여전히 하지 않는다**: push, 태그, 운영 배포(이미지 빌드·rollout), 이슈 DONE 처리, 이슈 생성(필요하면 이슈 챗에 제안만).
- 테스트·라이브 검증 방법은 [`.work-loop/project.md`](.work-loop/project.md) 를 따른다. 실행 상태는 `.work-loop/state/`(git 무시).

## Architecture (목표)

- **모노레포**: pnpm workspaces + Turborepo
- **백엔드**: 모듈러 모놀리스 (Spring Boot — Spring Modulith 는 쓰지 않음. 모듈은 패키지로 나누고 ArchUnit 으로 일부 규칙을 검증)
  - core: identity / thread / search / file / notify / ai
  - domain: issue(v1, 완료) · chat(이슈 컨텍스트, 완료) · messaging(팀 채팅 — Phase 1·2 완료, 3~7 백로그 #60–64) · notify(인박스/알림, 진행 중 #54) → 노트 / drive (이후)
- **프론트엔드**: Vite + React 19 + TS + Tailwind 4 + shadcn/ui
- **별도 서비스**: workplace-ai-agent (Claude Agent SDK, 스캐폴딩 완료 — 5b/5c 에서 로직 채움), workplace-converter (문서 → PDF/텍스트 변환, Python/FastAPI, WP-430), workplace-channel (실시간, 향후 추가)

## Conventions

- 커밋 컨벤션: [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)
- 코딩 컨벤션: [docs/CODING_CONVENTION.md](docs/CODING_CONVENTION.md)
