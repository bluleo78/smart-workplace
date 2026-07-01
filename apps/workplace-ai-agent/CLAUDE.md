# CLAUDE.md (workplace-ai-agent)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 ai-agent 단독 사항만 다룬다.

## 이 앱의 목적

Smart Workplace 의 **AI Agent 서비스**. `@anthropic-ai/claude-agent-sdk` 를 **인-프로세스로 구동**해 구독 OAuth 토큰으로 LLM 응답을 수행한다(#462 CLI→SDK 전환 완료). 이슈 이벤트 envelope 과 홈/메일/채팅/노트 컴포즈 요청을 받아 `query()` 를 우리 Node 서버 안에서 직접 실행하고, workplace-api 호출 도구는 `createSdkMcpServer` 로 **인-프로세스 MCP 서버**(`agent/sdk-mcp-server.ts`)에 등록한다 — 별도 CLI/MCP 자식 프로세스 spawn 없음.

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

Node.js 22 + TypeScript (ES2022, NodeNext), Express 4, Zod 4, axios, dotenv, `@anthropic-ai/claude-agent-sdk` (LLM 구동 + 인-프로세스 MCP), Vitest 4 + supertest + nock. (`@modelcontextprotocol/sdk` 는 stdio MCP 서버 제거로 vestigial — 후속 제거 후보.) 런타임 의존: `@anthropic-ai/claude-agent-sdk` 가 내부적으로 Claude Code 실행파일을 사용하므로 이미지에 `@anthropic-ai/claude-code` 설치 필요 + `CLAUDE_CODE_OAUTH_TOKEN` 구독 토큰(우리가 직접 CLI 를 spawn 하지는 않음).

## Layered Structure

```
src/
  agent/
    event-handler         # envelope → runAgent fire-and-forget
    run-agent             # 이슈 이벤트 → 인-프로세스 SDK 실행 (runSdkCollect)
    sdk-runner            # Agent SDK query() 러너 (buildSdkOptions / runSdkStream / runSdkCollect)
    sdk-mcp-server        # 인-프로세스 MCP 서버 (createSdkMcpServer + buildTools 어댑트)
    subagent-loader       # 코드정의 서브에이전트 로드 → options.agents
    tool-allowlist        # built-in 도구 차단 정책 (computeToolPolicy)
    system-prompt         # LLM 시스템 프롬프트 상수
    user-message          # 4 type 별 user message 빌더
  mcp/
    tools                 # 도구 정의 단일 진실원천 (프로필별 buildTools — 이슈/채팅/홈/메시징/어시스턴트)
  clients/              # workplace-api 호출용 axios client (코멘트/상태/담당자/조회 4 메서드)
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

**Claude CLI OAuth 토큰**: workplace-api DB 에 AGENT 별로 암호화 저장 (#33). 호스트 `~/.claude/` 의존 없음. workplace-web 의 AGENT 관리 화면에서 등록.

| 변수 | 의미 | 필수 |
|---|---|---|
| `INTERNAL_SERVICE_TOKEN` | 인바운드 /events + 아웃바운드 호출 (Authorization: Internal) 공용 | 예 |
| `WORKPLACE_API_BASE_URL` | workplace-api URL | 예 |
| `WORKPLACE_AI_MODEL` / `WORKPLACE_AI_MAX_TURNS` / `WORKPLACE_AI_TIMEOUT_MS` | 선택 override | 아님 |

**대행 AGENT 식별**: ai-agent 는 이벤트 envelope 의 assignees 중 첫 AGENT 를 대행 (#34).
workplace-api 호출 시 `Authorization: Internal <token>` + `X-On-Behalf-Of: <agentId>` 헤더로
그 AGENT 자격을 부여받는다. 5a 의 AGENT API key 는 ai-agent 부트스트랩과 무관 — 외부 서비스가
AGENT 자격으로 workplace-api 를 직접 호출할 때만 사용.
