# Smart Workplace

AI Native 워크플레이스 — 사람과 AI가 함께 일하는 협업 플랫폼.

제품명 **Gen:iA Works**. AI 에이전트를 담당자로 지정할 수 있는 이슈 트래커를 중심으로 대화·메일·캘린더·노트·드라이브·연락처를 한 곳에서 제공한다.

고객용 제품 소개 자료(화면 중심 PDF)와 재생성 절차는 [docs/intro](docs/intro/README.md) 참조.

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
  workplace-web/        # 사용자 웹(데스크톱·모바일 PWA) — Vite + React
  workplace-admin/      # 운영자 콘솔
  workplace-api/        # 백엔드 — Spring Boot 모듈러 모놀리스
  workplace-ai-agent/   # AI 에이전트 서비스 — 이슈 위임·대화·요약 등 AI 실행
  workplace-mcp/        # 외부 AI 도구용 원격 MCP 게이트웨이(개인 API 토큰)
  workplace-worker/     # 파일 텍스트 추출·임베딩 Python 워커
packages/
  mcp-tools-shared/     # MCP 도구 정의 공유(workplace-mcp · workplace-ai-agent)
docs/
  intro/                # 제품 소개 자료(촬영·PDF 빌드 스크립트)
```
