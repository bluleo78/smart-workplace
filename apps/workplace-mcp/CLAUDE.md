# CLAUDE.md (workplace-mcp)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 workplace-mcp 단독 사항만 다룬다.

## 이 앱의 목적

Smart Workplace 의 **원격 MCP 게이트웨이**. Claude Code 등 외부 MCP 클라이언트가 사용자 PAT(`swp_...`)
로 `POST /mcp` 를 호출하면, 사용자 컨텍스트 도구(이슈/위키/메시징/캘린더/드라이브/메일)를 workplace-api
로 그대로 패스스루한다. Streamable HTTP, stateless(세션 미유지 — 매 요청 새 `McpServer` + `Transport`).

## ⚠️ 무비밀(secretless) 게이트웨이 원칙 — 절대 규칙

이 앱은 **시크릿 환경변수를 갖지 않는다.** `INTERNAL_SERVICE_TOKEN` 류의 서비스 간 공용 시크릿을
**이 앱에 절대 추가하지 않는다.** 인증은 매 호출마다 클라이언트가 보낸 사용자 PAT 를
workplace-api 가 검증한다(`Authorization: Bearer swp_...` → workplace-api 의 PAT 인증 필터).
workplace-mcp 자신은 PAT 를 저장·검증하지 않고 그대로 전달(패스스루)만 한다.

- 필요 env 는 `PORT`, `WORKPLACE_API_BASE_URL` 뿐 (`.env.example` 참고).
- 새 기능이 "서비스 간 신뢰"를 요구하는 것처럼 보이면, workplace-mcp 에 시크릿을 추가하지 말고
  workplace-api 쪽 권한 모델(PAT 스코프 등)로 해결한다. 이 앱이 시크릿을 들고 있으면 탈취 시
  전체 사용자 계정이 위험해지는 단일 실패점이 된다.

## PAT 패스스루 구조

```
클라이언트 --Bearer swp_...--> POST /mcp (workplace-mcp)
                                    │
                          req 마다 새 PatApiClient(token)
                                    │
                                    ▼
                          workplace-api (매 호출 PAT 검증 + 테넌트 바인딩)
```

- `src/mcp/server.ts`: `handleMcpPost` 가 `Authorization: Bearer swp_...` 를 파싱 → `initialize`
  요청이면 `GET /auth/me` 로 조기 검증(연결 시점 401 UX) → `buildMcpServer(apiBaseUrl, token)` 로
  요청별 `McpServer` 구성.
- `src/clients/workplace-api.ts`: `createPatApiClient({ baseURL, token })` — 토큰을 클로저로 잡은
  axios 클라이언트. 도구 핸들러는 이 클라이언트만 통해 workplace-api 를 호출한다.
- 401 은 그대로 클라이언트에 요약 전달(`summarizeError`) — "토큰 만료·폐기" 를 사용자가 바로 알 수
  있게 한다.

## 도구 추가 방법

1. `src/tools/<domain>.ts` 에 `build<Domain>Tools(client: PatApiClient): McpTool[]` 함수 추가.
   기존 파일(`calendar.ts`, `drive.ts`, `issue.ts`, `mail.ts`, `messaging.ts`, `wiki.ts`) 패턴을
   따른다: zod 로 입력 스키마 정의 → `handler(args)` 에서 `schema.parse(args)` 후 `client.xxx()`
   호출 → 결과를 `JSON.stringify` 해 문자열로 반환.
2. `src/tools/index.ts` 의 `buildUserTools()` 에 `...build<Domain>Tools(client)` 를 추가해 집계.
   여기 등록된 도구만 `POST /mcp` 를 통해 실제로 노출된다(단일 진실원천).
3. `<domain>.test.ts` 에 각 도구별 성공/검증실패 케이스를 추가한다(`test-support.ts` 의
   `mockPatApiClient` 사용).
4. workplace-api 쪽에 대응하는 클라이언트 메서드가 없다면 `src/clients/workplace-api.ts` 에 먼저
   추가한다.

## 에이전트 전용 도구 노출 금지

이 게이트웨이는 **사람이 자기 권한으로 직접 실행하는 도구만** 노출한다. workplace-ai-agent 의
인-프로세스 MCP 서버(`apps/workplace-ai-agent/src/agent/sdk-mcp-server.ts`)에 존재하는
에이전트 전용/위임 흐름 도구는 여기서 **절대 등록하지 않는다**:

- `propose_*` (제안 생성 — 사람 승인 전 중간 상태를 만드는 도구)
- `submit_response` (에이전트 응답 제출 흐름 전용)
- `unassign_self` (AI 담당자 자진 해제)
- `show_*` (홈/채팅 위젯 렌더링 트리거 — UI 컴포즈 컨텍스트 전용, REST 의미론 아님)

새 도구를 추가할 때 이름이 위 패턴에 해당하면 workplace-mcp 가 아니라 ai-agent 쪽에 두어야
한다는 신호다. `src/tools/index.ts` 상단 주석에도 이 원칙이 명시되어 있다.

## Commands

```bash
pnpm dev          # tsx watch (포트 6090)
pnpm build        # tsc → dist/
pnpm start        # node dist/index.js
pnpm test         # Vitest
pnpm typecheck
pnpm lint
```

## Stack

Node.js 22 + TypeScript(ES2022/NodeNext), Express 4, `@modelcontextprotocol/sdk`(Streamable HTTP
서버), Zod 4, axios, dotenv, Vitest 4 + supertest + nock.

## Ports

- 로컬: 6090 (`PORT` env, 기본값도 6090)
- 운영: 호스트 공개 포트 10002 → 컨테이너 7090 (`docker-compose.prod.yml` 의 `mcp` 서비스,
  web 10000 / admin 10001 다음 번호)

## Conventions

- **한국어 주석 필수** (루트 코딩 컨벤션 참고)
- ESM(`"type": "module"`), import 시 `.js` 확장자 명시
- 테스트는 대상 파일과 같은 디렉토리에 `.test.ts` 로 둔다
