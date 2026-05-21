# Smart Workplace

AI Native 워크플레이스 — 사람과 AI가 함께 일하는 협업 플랫폼.

v1: AI를 Assignee로 둘 수 있는 이슈 트래커. 향후 chat / wiki / drive로 확장.

## Commands

- `pnpm install` / `pnpm build` / `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck`
- `pnpm db:up` / `pnpm db:down` / `pnpm db:reset` / `pnpm db:logs`

## Key Files

- 앱별 상세 (예정): `apps/workplace-api/CLAUDE.md`, `apps/workplace-web/CLAUDE.md`
- 커밋 컨벤션: [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)
- 코딩 컨벤션: [docs/CODING_CONVENTION.md](docs/CODING_CONVENTION.md)
- 로컬 DB: 포트 5434(dev), 5435(test). 컨테이너 `smart-workplace-db-1`, `smart-workplace-db-test-1`
- 로컬 API: 포트 9090 (firehub-api 8090 과 분리)
- 로컬 Web: 포트 6173 (firehub-web 5173 과 분리)

## Rules

- **한국어 주석 필수**: 클래스·메서드·주요 로직에 무엇을·왜. 상세는 [코딩 컨벤션](docs/CODING_CONVENTION.md)
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

## Conventions

- 커밋 컨벤션: [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)
- 코딩 컨벤션: [docs/CODING_CONVENTION.md](docs/CODING_CONVENTION.md)
