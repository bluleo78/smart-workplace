# workplace-ai-agent

Smart Workplace 의 AI Agent 서비스. 현재는 **스캐폴딩 단계** — 이벤트 수신 + 의존성 골격만 마련되어 있으며 실제 LLM 호출 / MCP 도구 / workplace-api 호출은 미구현. Phase 5b/5c 에서 채워진다.

## Commands

```bash
pnpm dev          # tsx watch — 포트 6070
pnpm build        # tsc
pnpm start        # node dist/index.js
pnpm test         # Vitest
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
```

## 환경변수

`.env.example` 참고. 로컬에서는 `.env.local` 사용.

## 엔드포인트

- `POST /events` — Internal token 인증, envelope 검증 후 type 디스패치. 본 시점 분기 0개 → `unsupported_event_type` 응답.
- `GET /health` — liveness, `{ status: 'ok' }`

## 자세한 가이드

`CLAUDE.md` 참고.
