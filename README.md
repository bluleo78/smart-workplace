# Smart Workplace

AI Native 워크플레이스 — 사람과 AI가 함께 일하는 협업 플랫폼.

v1: AI를 Assignee로 둘 수 있는 이슈 트래커.

## Stack

- 모노레포: pnpm workspaces + Turborepo
- Web: Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui
- API: Spring Boot (Java) + jOOQ + Flyway + PostgreSQL
- DB: PostgreSQL (docker-compose)

## Commands

```bash
pnpm install        # 의존성 설치
pnpm build          # 전체 빌드
pnpm dev            # 전체 개발 서버
pnpm test           # 전체 테스트
pnpm lint           # 린트
pnpm typecheck      # 타입체크
```

## Structure

```
apps/
  workplace-web/    # 프론트엔드 (예정)
  workplace-api/    # 백엔드 (예정)
packages/           # 공용 패키지 (예정)
```
