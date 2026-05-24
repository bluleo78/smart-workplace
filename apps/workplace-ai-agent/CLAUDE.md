# CLAUDE.md (workplace-ai-agent)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 ai-agent 단독 사항만 다룬다.

## 이 앱의 목적

Smart Workplace 의 **AI Agent 서비스**. 현재는 **스캐폴딩 단계** — 이벤트 수신 엔드포인트와 의존성 골격만 마련. 실제 LLM 호출 / MCP 도구 / workplace-api 호출은 미구현. Phase 5b (이벤트 수신 처리) / 5c (workplace-api 응답) 에서 채워진다.

## Commands

```bash
pnpm dev          # tsx watch (포트 7070)
pnpm build        # tsc → dist/
pnpm start        # node dist/index.js
pnpm test         # Vitest (in-process supertest)
pnpm test:watch
pnpm lint
pnpm typecheck
```

## Stack

Node.js 22 + TypeScript (ES2022, NodeNext), Express 4, Zod 4, axios, dotenv, `@anthropic-ai/claude-agent-sdk` (의존성만), Vitest 4 + supertest.

## Layered Structure

```
src/
  agent/                # Claude Agent SDK import (현 시점 빈 export)
  clients/              # workplace-api 호출용 axios client (현 시점 throw stub)
  middleware/           # internal-auth (Authorization: Internal {token})
  routes/               # health, events
  constants.ts          # DEFAULT_PORT, INTERNAL_AUTH_SCHEME, DEFAULT_API_BASE_URL
  index.ts              # Express 부트 + graceful shutdown
```

## Key Patterns

- **인증**: 사내 서비스 간 호출은 `Authorization: Internal {token}` + `timingSafeEqual`. 토큰은 `INTERNAL_SERVICE_TOKEN` 환경변수.
- **이벤트 수신**: 단일 `POST /events` + `{ type, payload }` envelope. type 별 분기는 Phase 5b 가 채움. 본 시점 모든 type 은 `unsupported_event_type` 응답.
- **검증**: envelope 만 zod 로 검증. payload 내부 스키마는 5b 에서 `discriminatedUnion` 으로.
- **응답 계약**: 처리 성공 시 `202 { received: true }` (비동기 처리 약속). 본 시점은 모든 분기가 4xx.
- **에러 처리**: 라우트 try/catch + 전역 핸들러 500 안전망. 로깅은 `console.log/error`.

## Conventions

- **한국어 주석 필수** (루트 코딩 컨벤션 참고)
- ESM (`"type": "module"`), import 시 `.js` 확장자 명시
- 새 라우트는 `src/routes/`, 새 middleware 는 `src/middleware/`, 새 external client 는 `src/clients/`
- 테스트: 라우트는 supertest 로 in-process, 단순 함수는 직접 호출. 모든 신규 코드에 vitest 테스트 동반.

## Testing

```bash
pnpm test                              # 전체
pnpm test src/routes/events.test.ts    # 단일 파일
pnpm test --coverage                   # 커버리지 (./coverage)
```

`.test.ts` 는 대상 파일과 같은 디렉토리에 둔다.

## 환경변수

`.env.example` 참고. 로컬은 `.env.local` 사용 (dotenv 가 `.env.local` 먼저, `.env` 후순위로 로드).
