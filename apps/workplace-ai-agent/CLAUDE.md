# CLAUDE.md (workplace-ai-agent)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 ai-agent 단독 사항만 다룬다.

## 이 앱의 목적

Smart Workplace 의 **AI Agent 서비스**. `@anthropic-ai/claude-agent-sdk` 를 **인-프로세스로 구동**해 구독 OAuth 토큰으로 LLM 응답을 수행한다(#462 CLI→SDK 전환 완료). 이슈 이벤트 envelope 과 홈/메일/채팅/노트 컴포즈 요청을 받아 `query()` 를 우리 Node 서버 안에서 직접 실행하고, workplace-api 호출 도구는 `createSdkMcpServer` 로 **인-프로세스 MCP 서버**(`agent/sdk-mcp-server.ts`)에 등록한다 — 별도 CLI/MCP 자식 프로세스 spawn 없음.

## Commands

```bash
pnpm dev          # tsx watch (포트 6070)
pnpm build        # tsc → dist/
pnpm start        # node dist/index.js
pnpm test         # Vitest (in-process supertest)
pnpm test:watch
pnpm lint
pnpm typecheck
```

## Stack

Node.js 22 + TypeScript (ES2022, NodeNext), Express 4, Zod 4, axios, dotenv, `@anthropic-ai/claude-agent-sdk` (LLM 구동 + 인-프로세스 MCP), Vitest 4 + supertest + nock. `@modelcontextprotocol/sdk` 는 opencode 러너(별도 프로세스, Task9)용 stdio MCP 엔트리포인트(`mcp/stdio-entry.ts`)에서 사용 — Claude SDK 경로는 여전히 인-프로세스(`agent/sdk-mcp-server.ts`). 런타임 의존: `@anthropic-ai/claude-agent-sdk` 가 내부적으로 Claude Code 실행파일을 사용하므로 이미지에 `@anthropic-ai/claude-code` 설치 필요 + `CLAUDE_CODE_OAUTH_TOKEN` 구독 토큰(우리가 직접 CLI 를 spawn 하지는 않음).

## Layered Structure

```
src/
  agent/
    event-handler         # envelope → runAgent fire-and-forget
    run-agent             # 이슈 이벤트 → 인-프로세스 SDK 실행 (runSdkCollect)
    sdk-runner            # Agent SDK query() 러너 (buildSdkOptions / runSdkStream / runSdkCollect)
    sdk-mcp-server        # 인-프로세스 MCP 서버 (createSdkMcpServer + buildTools 어댑트, Claude SDK 경로)
    bridge-registry       # runId → HostBridge 인메모리 Map (opencode HTTP 콜백 라우팅용)
    subagent-loader       # 코드정의 서브에이전트 로드 → options.agents
    tool-allowlist        # built-in 도구 차단 정책 (computeToolPolicy)
    system-prompt         # LLM 시스템 프롬프트 상수
    user-message          # 4 type 별 user message 빌더
  mcp/
    tools                 # 프로필별 buildTools — 공유 도구(packages/mcp-tools-shared, workplace-mcp 와 같은 정의)를 이름으로 골라 쓰고, 에이전트 전용 도구(propose_*/show_*/submit_response/chat 등)만 직접 정의. 이슈 챗 첨부: `collectAttachments` 가 이슈 첨부(스레드 경유 `GET /chat/threads/{id}/issue-attachments` — 멘션된 AGENT 는 프로젝트 비멤버라 이슈 첨부 API 가 403)·스레드 메시지 첨부와 추출 상태를 모은 뒤 → `presentAttachments(reader, …)` 가 러너·모델별로 표현(Claude: 임시폴더에 받아 Read·PDF 이미지, 그 외 텍스트 도구 / opencode: 비전 모델(`resolveOpencodeVision`)이면 이미지만 받아 빌트인 `read`, 그 외 텍스트 도구·이미지 불가 안내) → 모델은 chat 프로필 MCP 도구 `read_chat_thread_attachment({threadId, fileId, offset?, limit?})` 로 추출 텍스트를 구간 단위로 읽음(이슈·챗 첨부 공통). chat 도구(list_chat_messages·read_chat_thread_attachment·add_chat_message)는 실행 스레드에 묶여(`chatThreadId`, opencode 는 env `MCP_CHAT_THREAD_ID`) 다른 threadId 를 거부.
    home-attachment-tool  # WP-234 메인 AI 채팅 첨부 읽기(read_chat_attachment) — 세션 바인딩(homeSessionId)
    stdio-entry            # stdio MCP 엔트리포인트 — opencode 러너(별도 프로세스, Task9)가 spawn
  clients/              # workplace-api 호출용 axios client (코멘트/상태/담당자/조회 4 메서드)
  middleware/           # internal-auth (Authorization: Internal {token})
  routes/               # health, events, internal-bridge(opencode HostBridge HTTP 콜백)
  constants.ts          # DEFAULT_PORT, INTERNAL_AUTH_SCHEME, DEFAULT_API_BASE_URL
  index.ts              # Express 부트 + 종료 신호 처리
  graceful-shutdown.ts  # 무중단 종료 — 진행 중 HTTP·백그라운드 실행(trackInflight) 대기 후 정리(WP-167)
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
| `SHUTDOWN_DRAIN_MS` | 종료 시 진행 중 HTTP·에이전트 실행 대기 상한(기본 330000). 운영 차트 `terminationGracePeriodSeconds` 는 preStop + 이 값보다 커야 함(WP-167) | 아님 |

**대행 AGENT 식별**: 대행할 AGENT 는 workplace-api 가 정한다(WP-371). API 는 서버 실행(INTERNAL) 에이전트가 있을 때만
이벤트를 보내고 payload 의 `actingAgentId` 에 그 id 를 싣는다. ai-agent 는 직접 고르지 않으며 assignees/mentions 폴백도 없다 —
`actingAgentId` 는 이슈 이벤트·`chat.message.posted` 모두 필수(양의 정수)이고, 없으면 zod 검증에서 400 `invalid_payload` 로 거절(fail-closed).
배포 순서: ai-agent 를 먼저 올려도 안전하다(구버전 API 이벤트는 거절될 뿐 오실행되지 않음). 다만 ai-agent 새 버전~API 새 버전 사이의
짧은 구간에는 구버전 API 의 이슈·chat 이벤트가 400 으로 거절되어 AI 실행이 일시 누락된다.
workplace-api 호출 시 `Authorization: Internal <token>` + `X-On-Behalf-Of: <agentId>` 헤더로
그 AGENT 자격을 부여받는다. 5a 의 AGENT API key 는 ai-agent 부트스트랩과 무관 — 외부 서비스가
AGENT 자격으로 workplace-api 를 직접 호출할 때만 사용.

## AI 화면 컨텍스트 (WP-54)

`screenContext`(`routes/home.ts` chatSchema) → `formatScreenContext`(`src/agent/screen-context.ts`) 가 user 메시지 앞에 `## 현재 화면` 블록을 붙인다. 라우터 규칙은 `assistant-system-prompt.ts` 의 `## 현재 화면 맥락`(subagent 위임 시 식별자 복사)에 있다.

## AI Chat 라우터 도구 (WP-351)

- assistant 프로필 MCP 서버는 전 도구 union 을 등록한다(서브에이전트가 같은 서버를 쓴다). 라우터(메인 스레드)는 `ASSISTANT_ROUTER_TOOLS`(`mcp/tools.ts` — 읽기·`show_*`·알림·첨부 읽기)만 싣고, 쓰기·`propose_*`·`submit_response` 는 담당 서브에이전트 frontmatter 에만 있다.
- Claude: 메인 스레드를 `Options.agent`(`ROUTER_AGENT_NAME`, `toRouterAgentDefinition`)로 돌려 그 `tools` 로 좁힌다. SDK 는 서브에이전트 도구를 메인 스레드 tools 가 아니라 서버 전체에서 고른다(실측). 위임은 `Agent(issue-agent, …)` 로 우리 서브에이전트만 허용한다 — 내장 에이전트(general-purpose 등)는 서버 전 도구를 상속해 경계를 우회한다. 자기 위임은 `Agent(<이름>)` 거부로도 막는다.
- opencode 는 좁히지 않는다: primary `tools` 의 `'*': false` 가 위임 도구 `task` 까지 꺼서(`opencode debug agent` 실측 `task:false`) opencode 라우터는 쓰기를 직접 한다.
- SDK 0.3.x 주의(실측): 위임 도구가 `Task` 로도 불려 `Task` 거부가 Agent 를 숨긴다 → `allowSubagents` 면 Task 도 푼다(`tool-allowlist`). Agent 위임은 기본 백그라운드라 위임하는 실행은 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` 로 동기 실행한다(`sdk-runner`).
- 라우터 프롬프트는 러너별(`assistantSystemPrompt('claude'|'opencode')`): Claude 는 위임 전용 규칙, opencode primary 는 직접 제안 규칙(#842 고쳐 재제안·#843 재제안)을 받는다.

## 메인 AI 채팅 첨부 (WP-234)

- 요청: `chatSchema` 의 `sessionId`(UUID, 선택)·`attachments`(세션 전체 첨부 + `current`, 생략 시 `[]`). 빈 `query` 는 이번 메시지 첨부가 있을 때만 허용하고 `DEFAULT_ATTACHMENT_QUERY` 로 대체. ai-agent 를 먼저 재기동하므로 구 API 요청(필드 없음)도 받는다.
- 프롬프트: `formatHomeAttachmentsBlock`(`agent/home-attachments.ts`)이 매 턴 `## 이 대화의 첨부` 를 현재 요청 앞에 고정 주입(요약 후에도 연속성 유지). 문구는 비전 판단(`opencodeVisionFor`, 실행당 1회 → `RunnerInput.opencodeVision` 과 같은 값)에 따라 다르다.
- 도구: assistant 프로필 `read_chat_attachment({fileId, offset?, limit?})`(`mcp/home-attachment-tool.ts`). 세션은 실행 단위 바인딩 — Claude 는 `RunnerMcpConfig.homeSessionId`, opencode 는 env `MCP_HOME_SESSION_ID`(이 실행은 웜 풀 제외). 바인딩이 없으면 오류. 문서는 추출 텍스트 구간, 이미지(jpeg/png/gif/webp, ≤3.75MB)는 이미지 블록, 그 외는 사유 안내. 하위 에이전트는 이 도구가 없으므로 라우터가 읽어 위임 prompt 에 옮겨 적는다.
- 이슈 첨부·드라이브 파일 본문(WP-346): 공유 도구 `read_file({source:'issue', issueKey, attachmentId} | {source:'drive', driveFileId}, offset?, limit?)` 를 assistant·issue-agent·drive-agent 가 쓴다(요청자 신원). 범위·기본 길이·이미지 형식/크기 기준은 `@smart-workplace/mcp-tools-shared` 의 `attachment-read` 를 세 첨부 도구(read_file·read_chat_attachment·read_chat_thread_attachment)가 함께 쓴다.
- 드라이브 전송(WP-369): drive-agent 는 공유 `create_drive_file` 을 **content 모드만** 쓴다 — 웹 AI Chat 사용자에게는 셸이 없어 업로드 링크(`curl -T`)를 쓸 수 없으므로, `mcp/tools.ts` 가 공유본을 펼쳐 content 없는 호출(새 파일·`driveFileId` 모두)을 API 없이 오류로 막는다(스키마는 공유본 그대로라 패리티 유지, 설명은 한국어 머리말 + 공유 `CREATE_DRIVE_FILE_CONTENT_DESCRIPTION` — 링크 안내를 뺀 content 모드 부분). 드라이브의 기존 텍스트 파일은 `read_file` 로 읽고 `create_drive_file(driveFileId, content)` 로 새 버전을 저장한다(이름·폴더 그대로, 텍스트가 아닌 파일은 서버 409). 로컬·첨부 파일 업로드는 웹 드라이브로 안내한다. `create_drive_download_link` 는 다운로드 요청에 10분·한 번만 쓰는 링크를 보여 줄 때 쓴다. 둘 다 write 라 라우터가 아니라 drive-agent 에만 있다. 이름변경·이동은 `rename_drive_item`·`move_drive_item`(파일·폴더 통합), 첨부·파일 읽기는 `read_file`(옛 `read_attachment`).
- 추출 대기: 이번 메시지 문서가 PENDING 이면 실행 전 최대 20초(2초×10회) 세션 목록을 재조회(`awaitHomeExtraction`), 대기 중 progress 라벨 1회.
- 테넌트: Claude 는 `withOnBehalfOfTenant` 로 스코프한 client 를 쓰고, opencode stdio MCP 는 `RunnerMcpConfig.onBehalfOfTenantId` → env `MCP_ON_BEHALF_OF_TENANT` 로 받아 같은 `X-On-Behalf-Of-Tenant` 를 싣는다(웜 풀 키에도 포함, WP-259).
