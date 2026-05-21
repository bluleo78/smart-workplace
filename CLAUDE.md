# Smart Workplace

AI Native 워크플레이스 — 사람과 AI가 함께 일하는 협업 플랫폼.

v1: AI를 Assignee로 둘 수 있는 이슈 트래커. 향후 chat / wiki / drive로 확장.

## Commands

- `pnpm install` / `pnpm build` / `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck`
- `pnpm db:up` / `pnpm db:down` / `pnpm db:reset` / `pnpm db:logs`

## Key Files

- 앱별 상세 (예정): `apps/workplace-api/CLAUDE.md`, `apps/workplace-web/CLAUDE.md`
- 커밋 컨벤션: [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)
- 로컬 DB: 포트 5434(dev), 5435(test). 컨테이너 `smart-workplace-db-1`, `smart-workplace-db-test-1`

## Rules

- **한국어 주석 필수**: 클래스·메서드·주요 로직에 무엇을·왜
- **커밋/배포 금지**: 사용자 명시적 승인 후에만 실행
- **테스트 필수**: backend → JUnit 통합 테스트, frontend → Playwright E2E
- **스크린샷**: 탐색 → `test-results/exploratory/<기능>/<timestamp>/screenshots/`, TC → `test-results/tc/<suite>/`

## Architecture (목표)

- **모노레포**: pnpm workspaces + Turborepo
- **백엔드**: 모듈러 모놀리스 (Spring Boot + Spring Modulith)
  - core: identity / thread / search / file / notify / ai
  - domain: issue (v1) → chat / wiki / drive (v2+)
- **프론트엔드**: Vite + React 19 + TS + Tailwind 4 + shadcn/ui
- **별도 서비스**: workplace-channel (실시간), workplace-ai-agent (Claude Agent SDK) — 향후 추가

## Serena MCP 활용 지침

코드 탐색·편집 시 Serena의 시맨틱 도구를 우선 사용한다. 전체 파일을 무작정 읽지 말고, 필요한 심볼·라인만 점진적으로 획득한다.

- **세션 시작**: `activate_project`로 `smart-workplace` 활성화, `check_onboarding_performed`로 온보딩 상태 확인. 온보딩 메모리(`project_overview`, `suggested_commands`, `code_style_conventions`, `task_completion_checklist`)는 `list_memories` / `read_memory`로 참조.
- **코드 탐색 우선순위** (위에서 아래로):
  1. `get_symbols_overview` — 파일의 심볼 목록만 빠르게 파악
  2. `find_symbol` (`include_body=false`, `depth=1`) — 구조 파악
  3. `find_symbol` (`include_body=true`) — 필요한 심볼 본문만 읽기
  4. `find_referencing_symbols` — 호출/참조 관계 추적
  5. `search_for_pattern` — 심볼명 불명확 시 패턴 검색
  6. `read_file` 전체 읽기는 마지막 수단
- **편집 우선순위**:
  - 심볼 단위 교체: `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol`
  - 일부 라인만 수정: `replace_content` (regex)
  - 전체 재작성은 회피 (작은 변경은 diff-only)
- **참조 정합성**: 심볼 수정 시 `find_referencing_symbols`로 호출처 확인 후 일괄 업데이트
- **라인 번호**: Serena 도구가 반환하는 라인 번호는 **0-based**
- **메모리 관리**: 의미 있는 새 규칙·아키텍처 발견 시 `write_memory`로 저장. 잘못된/낡은 메모리는 `delete_memory` 또는 `edit_memory`
- **언어 서버**: TypeScript / Java 모두 활성화 — `find_declaration`, `find_implementations`, `get_diagnostics_for_file` 사용 가능
- **금지**: 시맨틱 검색이 가능한 작업에 `grep`/`find` 우선 사용, 이미 전체 읽은 파일을 다시 심볼 도구로 분석

## Conventions

- 커밋 컨벤션: [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)
