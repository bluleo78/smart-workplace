# workplace-ai-agent 스캐폴딩 — 설계

> issue: #32
> 작성일: 2026-05-25

## 배경

Phase 5b (이슈 이벤트 발행 → ai-agent 수신) 와 5c (ai-agent → workplace-api 응답) 는
양방향 통합이 핵심이라 **수신자/송신자가 실물로 존재해야** 계약(payload 형태·인증·응답 경로)
이 종이 위에서 굳지 않는다. 본 epic 은 5b/5c 가 살을 붙일 **빈 골격** 만 세운다.

LLM 호출·MCP 도구·실제 로직은 본 epic 범위 밖. `firehub-ai-agent` 패턴을 최대한 차용한다.

## 목표

- `apps/workplace-ai-agent/` 신규 — pnpm workspace 멤버, Turbo 파이프라인 편입
- `POST /events` 이벤트 수신 엔드포인트 (envelope 검증만, type 분기 0개)
- `GET /health` liveness
- workplace-api 호출용 axios client 의 메서드 시그니처 (호출은 throw)
- `@anthropic-ai/claude-agent-sdk` 의존성 + import (실제 호출 X)
- `apps/workplace-ai-agent/CLAUDE.md` + 루트 `CLAUDE.md` 갱신

## 비목표 (YAGNI)

- LLM 호출 / 시스템 프롬프트 / MCP 도구 정의
- workplace-api 실제 호출 (5c 에서 contract 확정 후)
- 큐 / 재시도 / 영속화
- HMAC 서명 (Internal token 으로 충분, 외부 webhook 도입 시 별도)
- Docker Compose 통합 (Dockerfile 만 마련, compose 편입은 후속)
- 종단 통합 테스트 (workplace-api ↔ ai-agent 는 5b 에서)

## 아키텍처

```
workplace-api  ──── POST /events {type, payload} ───▶  workplace-ai-agent
        ▲                                                    │
        │                                                    │
        └──── (5c) AGENT API key 로 코멘트/상태 변경 ─────────┘
              (이 호출 client 는 stub 메서드만, 본 epic 에서 호출 X)
```

본 epic 산출물: 빈 receiver + workplace-api 호출용 stub client + Agent SDK 의존성.

## 스택

| 항목 | 선택 |
|---|---|
| 런타임 | Node.js 22 (alpine) |
| 언어 | TypeScript (ES2022, NodeNext) |
| HTTP | Express 4 |
| 검증 | Zod 4 |
| AI | `@anthropic-ai/claude-agent-sdk` (의존성만) |
| HTTP 클라이언트 | axios (workplace-api 호출용 stub) |
| 테스트 | Vitest + v8 커버리지 + supertest |
| 빌드/실행 | `tsx watch` (dev), `tsc` → `node dist/index.js` (prod) |
| Lint/Format | ESLint flat config + Prettier (firehub 설정 차용) |
| 환경변수 | dotenv + `.env.example` |
| 패키지명 | `@smart-workplace/workplace-ai-agent` |

## 디렉토리

```
apps/workplace-ai-agent/
├── package.json
├── tsconfig.json
├── eslint.config.js
├── vitest.config.ts
├── .prettierrc
├── .env.example
├── Dockerfile               # firehub 2단계 빌드 차용
├── README.md
├── CLAUDE.md                # 앱 가이드
└── src/
    ├── index.ts             # Express 부트스트랩, 라우트 등록, graceful shutdown
    ├── constants.ts         # PORT(7070), DEFAULT_API_BASE_URL, INTERNAL_AUTH_HEADER
    ├── middleware/
    │   ├── internal-auth.ts # Authorization: Internal {token} 검증 (timingSafeEqual)
    │   └── internal-auth.test.ts
    ├── routes/
    │   ├── events.ts        # POST /events
    │   ├── events.test.ts
    │   ├── health.ts        # GET /health
    │   └── health.test.ts
    ├── clients/
    │   └── workplace-api.ts # axios instance + addComment/updateIssueStatus 시그니처 (throw 'not implemented')
    └── agent/
        └── index.ts         # @anthropic-ai/claude-agent-sdk import 만, 빈 export
```

## 포트·환경변수

**포트:** `7070` (workplace-api 9090 / workplace-web 6173 / firehub-api 8090 과 분리)

**`.env.example`:**
```
PORT=7070
INTERNAL_SERVICE_TOKEN=changeme-local
WORKPLACE_API_BASE_URL=http://localhost:9090/api/v1
WORKPLACE_AGENT_API_KEY=changeme-local
ANTHROPIC_API_KEY=
```

## 데이터 흐름

`POST /events` 처리 순서:

1. Express 가 요청 수신
2. `internalAuth` 미들웨어
   - `Authorization` 헤더 파싱 → `"Internal {token}"` 형식 검증
   - `crypto.timingSafeEqual` 로 `INTERNAL_SERVICE_TOKEN` 비교
   - 실패 → `401 { error: 'unauthorized' }`
3. zod 스키마 검증
   - envelope: `{ type: string, payload: unknown }`
   - 실패 → `400 { error: 'invalid_payload', issues: [...] }`
4. type 디스패치 (switch)
   - 본 epic 에서는 분기 0개
   - 알 수 없는 type → `400 { error: 'unsupported_event_type', type }`
5. 핸들러: `console.log('event received', { type })` 후 `202 { received: true }`

## 검증 정책

- envelope 만 검증, payload 내부 스키마는 5b 에서 type 별로 정의 (`zod.discriminatedUnion` 자리)
- 본 epic 에서는 payload 가 `z.unknown()` — 통과만 시킴

## 에러 처리

- Express 전역 핸들러: 미처리 throw → `500 { error: 'internal_error' }`, stack 은 `console.error`
- zod 에러는 라우트 핸들러에서 try/catch 로 변환 (전역 핸들러 거치지 않음)
- workplace-api client stub 메서드 호출은 모두 `throw new Error('not implemented in scaffolding')`
  — 본 epic 의 어떤 코드도 stub 메서드를 부르지 않음

## 로깅

firehub 따라 `console.log/error`. 구조화 로거는 도입하지 않음.

## Graceful Shutdown

SIGTERM/SIGINT 수신 시:
- 새 요청 거부
- 진행 중 요청 5초 대기
- 타임아웃 시 강제 종료

firehub `index.ts` 패턴 차용.

## 테스트 (Vitest + supertest)

| 파일 | 검증 |
|---|---|
| `middleware/internal-auth.test.ts` | ① 헤더 없음 → 401 ② 잘못된 스킴 → 401 ③ 잘못된 토큰 → 401 ④ 올바른 토큰 → next() |
| `routes/events.test.ts` | ① 인증 없음 → 401 ② envelope 누락(type 없음) → 400 ③ payload 필드 누락 → 400 ④ 알 수 없는 type → 400 (`unsupported_event_type`). 본 epic 은 분기 0개라 모든 type 이 ④에 해당. |
| `routes/health.test.ts` | GET /health → 200 + `{ status: 'ok' }` |

Express 앱은 supertest 로 in-process 테스트 (서버 listen 없이).

## 루트 통합

- `pnpm-workspace.yaml` — `apps/*` 글롭이면 자동 포함 (확인만)
- `turbo.json` — `dev`/`build`/`lint`/`typecheck`/`test` 파이프라인에 자동 편입
- 루트 `CLAUDE.md`:
  - "별도 서비스" 줄에서 workplace-ai-agent 를 "스캐폴딩 완료, 5b/5c 에서 로직 채움" 으로 갱신
  - "로컬 API 9090, Web 6173" 옆에 "로컬 AI Agent 7070" 추가

## CLAUDE.md (앱 가이드)

firehub-ai-agent `CLAUDE.md` 섹션 구조 그대로 — 목적 / Commands / Stack / Layered Structure / Key Patterns / Conventions / Testing. 본 epic 시점에서는 "에이전트 로직 미구현, 이벤트 수신만" 명시.

## 완료 기준 (DoD)

- `pnpm install` → 워크스페이스에 workplace-ai-agent 등장
- `pnpm --filter @smart-workplace/workplace-ai-agent dev` → 7070 포트 기동
- `curl http://localhost:7070/health` → 200
- `curl -X POST http://localhost:7070/events -H 'Authorization: Internal changeme-local' -H 'Content-Type: application/json' -d '{"type":"issue.created","payload":{}}'` → 400 (`unsupported_event_type`)
- 루트에서 `pnpm test` / `pnpm lint` / `pnpm typecheck` / `pnpm build` 전체 통과
- 루트 CLAUDE.md 갱신 반영

## 영향 범위

- 추가: `apps/workplace-ai-agent/` 전체
- 수정: 루트 `CLAUDE.md` (서비스 섹션·포트 섹션)
- 백엔드 (workplace-api): 변경 없음
- 프론트엔드 (workplace-web): 변경 없음
- DB 마이그레이션: 없음

## 의존성

- 없음. 단, Phase 5a (AGENT 유저 + API key) 가 끝나 인증 방식이 정해진 상태.

## 후속

- Phase 5b: 이 receiver 가 받을 type 별 payload 계약 확정 + workplace-api 측 발사 구현
- Phase 5c: workplace-api client stub 메서드의 실제 구현 + AGENT API key 호출 흐름

## 커밋

단일 commit, 한국어 메시지:
```
feat(ai-agent): workplace-ai-agent 스캐폴딩 — #32
```
