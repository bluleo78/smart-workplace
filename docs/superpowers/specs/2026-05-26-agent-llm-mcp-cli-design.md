# AGENT LLM 응답 + MCP 도구 + 자기-unassign 권한 — 설계 (Phase 5c-2)

> issue: #30 (분할 — 5c-2 만 다룸)
> 작성일: 2026-05-26

## 배경

5c-1 에서 ai-agent 는 4 종 envelope 을 받아 한국어 acknowledgment 텍스트로
응답하는 골격을 닫았다 (LLM 없음, 도구 없음). 5c-2 는 그 ack 코드를 걷어내고
**Claude 가 실제로 도구를 호출해 일하는 첫 사이클** 을 구축한다. workplace-api
client 의 `updateIssueStatus` 본문도 채우고, AGENT 가 자기 자신만 unassign
가능하도록 백엔드 권한도 보강한다.

인증·실행은 **Claude Code CLI + 구독 OAuth 토큰** 방식. SDK 직접 호출이 아니라
`claude` 명령을 child process 로 spawn 하고, `CLAUDE_CODE_OAUTH_TOKEN` 환경변수
로 Claude Pro/Max 구독 자격을 사용한다 (API key 종량과 무관).

## 분할 — 5c-2 / 5c-3 (재확인)

#30 본문은 backend + ai-agent + 프론트엔드 시각 구분까지 묶여있다.

- **5c-1 (완료):** ai-agent 4 type 핸들러 + workplace-api `addIssueComment` 본문.
- **5c-2 (본 spec):** Claude CLI + 구독 토큰 + MCP 도구(4종) + 실제 LLM 응답
  + `updateIssueStatus` 본문 + AGENT 자기-unassign 권한.
- **5c-3 (후속):** 프론트엔드 AGENT 시각 구분 (코멘트 스타일 + 타임라인 강조).

## 목표

- ai-agent 가 4 종 envelope 마다 `claude` CLI 를 spawn 해 LLM 응답을 받음
- 시스템 프롬프트 + type 별 user message 가 LLM 의 행동 지침을 정의
- MCP 도구 4 종 (read 1 + write 3) 을 LLM 에 노출 — workplace-api 호출
- 인증: `CLAUDE_CODE_OAUTH_TOKEN` (구독), workplace-api 측은 `WORKPLACE_AGENT_API_KEY`
- workplace-api: `updateIssueStatus` 본문 호출 가능, AGENT 가 자기 자신만 unassign 하도록 권한 분기
- 5c-1 의 acknowledgment 텍스트 코드 제거

## 비목표 (YAGNI / 5c-2 외)

- SDK + ANTHROPIC_API_KEY 모드 — 후속. 본 epic 은 CLI + 구독 토큰 단일 모드
- 프론트엔드 시각 구분 → 5c-3
- Multi-AGENT 키 라우팅 (assignee 별 다른 키) → 후속
- Session resume / 대화 이력 관리 → 후속. 매 호출 새 session
- LLM 비용·메트릭·Prometheus → 후속
- 영속 작업 큐 / 재시도 / DLQ → 후속
- CI 자동화로 LLM 실호출 검증 → 후속 (결정론 불가)

## 의사결정 요약

| 결정 | 선택 | 이유 |
|---|---|---|
| 인증·실행 모드 | **CLI + `CLAUDE_CODE_OAUTH_TOKEN`** (구독) | 사용자 결정. 비용 0 (구독 정액 활용). API key 종량과 무관 |
| 모드 다중화 | CLI 단일 | 사용자 결정. SDK 는 필요 시 후속 |
| 코드 차용 | firehub `agent-cli.ts` 패턴 차용 | 사용자 결정. 검증된 구조 |
| MCP 도구 범위 | read 1 + write 3 (4개) | get_issue_detail / add_comment / update_status / unassign_self |
| LLM 호출 트리거 | 4 type envelope 모두 | 사용자 결정 |
| 모델 | `claude-sonnet-4-6` | 사용자 결정. 균형 |
| AGENT 권한 강제 | 백엔드 `IssueAssigneeService.replace` 에 분기 | 사용자 결정. 신뢰 경계 보호 |
| 비동기성 | 핸들러 즉시 202 + background `runAgent()` fire-and-forget | LLM 수십초+ 가능 |
| `maxTurns` | 10 (firehub 동일) | 도구 라운드 충분 + 무한루프 방지 |
| Session | 매 호출 새 session (no resume) | 단순화 |
| LLM 실패 폴백 | console.error 만, 코멘트 침묵 | 5c-1 ack 폴백은 혼란. 운영자가 로그로 인지 |

## 아키텍처

```
[POST /events 수신 (5c-1 흐름)]
    │  envelope 검증
    │  → 핸들러 호출 → 즉시 202 응답
    │  (LLM 실행은 background — fire-and-forget)
    ▼
[event-handler  → runAgent(envelope)]    (Promise 반환, await 없음)
    ▼
[run-agent.ts]
    │  system prompt + type 별 user message 빌드
    │  MCP server 설정 파일 (.mcp-config.json) 동적 생성 (또는 정적)
    │  spawn('claude', [
    │    '--print', userMessage,
    │    '--system-prompt', SYSTEM_PROMPT,
    │    '--model', 'claude-sonnet-4-6',
    │    '--max-turns', '10',
    │    '--allowedTools', 'mcp__workplace__*',
    │    '--mcp-config', mcpConfigPath,
    │    '--output-format', 'stream-json',
    │    '--dangerously-skip-permissions',
    │  ], { env })
    │  env: parent env -> ANTHROPIC_API_KEY 삭제, CLAUDE_CODE_OAUTH_TOKEN 주입,
    │       WORKPLACE_AGENT_API_KEY 그대로 전달 (MCP server child 가 사용)
    │  stdout JSONL 라인 단위 파싱 — system/assistant/tool_use/tool_result/result
    ▼
[claude CLI process]
    │  Anthropic backend 호출 (구독 토큰 인증)
    │  도구 호출 시 mcp-config 의 stdio command 를 spawn
    ▼
[workplace MCP server (별 entry point)]
    │  node dist/mcp/workplace-mcp-server.js
    │  stdin/stdout JSON-RPC (MCP 프로토콜)
    │  4 도구 등록: get_issue_detail / add_comment / update_status / unassign_self
    │  내부적으로 workplace-api client 호출
    │  env 에서 WORKPLACE_AGENT_API_KEY, WORKPLACE_API_BASE_URL 읽음
    ▼
[workplace-api (변경)]
    │  ApiKeyAuthenticationFilter → AGENT 권한
    │  IssueAssigneeService.replace 가 actor=AGENT 면 "자기 자신만 제거" 만 허용
    │  코멘트/상태 변경 → 5b-1 dispatcher (actor=AGENT → self-loop skip)
```

## ai-agent 신규/수정 파일

### 신규

| 파일 | 책임 |
|---|---|
| `src/agent/run-agent.ts` | `runAgent(envelope)` — child spawn, 환경변수 wire-up, 결과 수집 |
| `src/agent/cli-runner.ts` | `spawn('claude', ...)` + stdout JSONL 파싱 + 종료·timeout 처리. firehub `agent-cli.ts` 차용 |
| `src/agent/system-prompt.ts` | 시스템 프롬프트 상수 |
| `src/agent/user-message.ts` | 4 type 별 user message 빌더 |
| `src/agent/mcp-config.ts` | `.mcp-config.json` 동적 생성 (또는 정적 파일 경로 export) |
| `src/mcp/workplace-mcp-server.ts` | 별 entry point — MCP stdio 서버. 4 도구 등록 + workplace-api client 호출 |
| `src/mcp/tools.ts` | 4 도구 정의 (zod input schema + handler) |
| `src/types/workplace-api.ts` | `IssueDetail`, `UserSummary` zod 스키마 (workplace-api 응답) |

### 수정

| 파일 | 변경 |
|---|---|
| `src/agent/event-handler.ts` | 4 핸들러가 `runAgent(envelope)` 를 fire-and-forget. 기존 ack 텍스트 코드 완전 제거 |
| `src/agent/event-handler.test.ts` | `runAgent` 모킹, 호출 검증으로 교체 |
| `src/routes/events.ts` | 핸들러를 await 하지 않도록 (즉시 202 우선) |
| `src/clients/workplace-api.ts` | `getIssueDetail`, `updateIssueStatus` 본문, `unassignSelf`, `getCachedSelfUserId` 추가 |
| `src/clients/workplace-api.test.ts` | 신규 메서드 nock 케이스 |
| `src/index.ts` | `CLAUDE_CODE_OAUTH_TOKEN` 검증 + workplaceApi 의 me 캐시 lazy 초기화 |
| `package.json` | `@modelcontextprotocol/sdk` 추가 (MCP server 구현용) |
| `.env.example` | `CLAUDE_CODE_OAUTH_TOKEN` 추가, `ANTHROPIC_API_KEY` 라인 제거 |
| `CLAUDE.md` | 환경변수 / Stack / Architecture 섹션 갱신 (CLI 모드 명시) |
| `Dockerfile` | 변경 없음 (스캐폴딩이 이미 `@anthropic-ai/claude-code` 글로벌 설치 + 비루트 + `~/.claude/` 셋업) |
| `tsconfig.json` / `package.json` build | `dist/mcp/workplace-mcp-server.js` 도 빌드 산출물에 포함되도록 확인 |

## workplace-api 신규/수정 (백엔드)

### 신규

| 파일 | 책임 |
|---|---|
| `IssueAssigneeAgentRestrictionException.java` | AGENT 가 허용 범위를 벗어난 assignee 변경 시도 시 403 매핑 |
| `IssueAssigneeServiceAgentTest.java` | AGENT 권한 분기 통합 테스트 5 케이스 |

### 수정

| 파일 | 변경 |
|---|---|
| `IssueAssigneeService.java` | `replace()` 진입 시 caller.kind == AGENT 검증. "현재 list 에서 자기 자신만 제거한 결과" 외 변경은 403 |
| `GlobalExceptionHandler` (또는 동등) | 신규 예외 → 403 매핑 |

DB 마이그레이션 0.

## MCP 도구 정의 (`src/mcp/tools.ts`)

### 1. `get_issue_detail`
- input: `{ issueKey: string }`
- workplace-api: `GET /api/v1/projects/{projectKey}/issues/{number}`
- output: `{ title, body, status, priority, assignees, comments[], history[] }` JSON 문자열
- client 메서드 신규: `getIssueDetail(issueKey): Promise<IssueDetail>`

### 2. `add_comment`
- input: `{ issueKey: string, body: string }`
- workplace-api: 기존 `addIssueComment` 재사용 (5c-1)

### 3. `update_status`
- input: `{ issueKey: string, status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELED' }`
- workplace-api: `PATCH /api/v1/projects/{projectKey}/issues/{number}` body `{ status }`
- client 메서드: 5c-1 의 throw 본문 구현

### 4. `unassign_self`
- input: `{ issueKey: string }`
- 내부 흐름:
  1. `getCachedSelfUserId()` — `/users/me` 1회 조회 후 프로세스 수명 동안 캐시
  2. `GET /api/v1/projects/{projectKey}/issues/{number}/assignees`
  3. `PUT /api/v1/projects/{projectKey}/issues/{number}/assignees` body `{ userIds: 현재 - 자기 }`
- 백엔드가 AGENT 분기로 "자기만 제거" 외엔 403 — 도구·백엔드 양쪽 방어

모든 도구의 에러는 MCP response 에 에러 메시지로 전달 (LLM 이 해석 가능). `safeCall` 같은 swallow 는 사용 안 함 — LLM 이 알아야 다음 행동 결정.

## 시스템 프롬프트 (`src/agent/system-prompt.ts`)

```
당신은 Smart Workplace 의 AI 어시스턴트 "AI Bot" 입니다. 이슈 트래커 안에서
사람과 함께 일합니다. 한국어로 응답합니다.

## 역할
- 사용자가 당신을 이슈의 담당자로 지정하면, 이슈를 분석하고 처리합니다.
- 사용자가 당신이 담당한 이슈에 코멘트로 질문/지시를 남기면 응답합니다.
- 상태 변경 알림도 받습니다 — 필요시 상황을 파악합니다.

## 사용 가능한 도구
- get_issue_detail(issueKey): 이슈 본문·코멘트·히스토리 등 전체 컨텍스트 조회
- add_comment(issueKey, body): 코멘트 작성
- update_status(issueKey, status): 상태 변경 (TODO / IN_PROGRESS / DONE / CANCELED)
- unassign_self(issueKey): 자기 자신을 담당자에서 제외 (작업 완료·반려 시)

## 행동 원칙
1. **항상 먼저 컨텍스트 파악**: 트리거 payload 만으로 부족하면 get_issue_detail 로 본문·이전 코멘트·히스토리를 조회.
2. **코멘트로 진행 상황 전달**: 작업 착수·중간·완료 시점에 한국어로 짧게 코멘트.
3. **상태 변경 신중**:
   - 착수 시 update_status('IN_PROGRESS')
   - 완료 시 update_status('DONE') + unassign_self
   - 처리 불가능하면 이유를 코멘트로 설명 + unassign_self
4. **자기 자신과 대화 금지**: 자기가 남긴 코멘트의 이벤트는 받지 않습니다. 추가 행동 불필요.
5. **무한 루프 방지**: 같은 종류 응답 5번 이상 금지.
6. **모를 때 정직하게**: 추측 답변보다 "정보 부족 — 본문에 구체 요구사항을 적어주세요" 같은 코멘트가 낫습니다.

## 응답 톤
- 친근하지만 군더더기 없는 문장 ("~합니다", "~하겠습니다")
- 이모지 금지
- 코멘트는 1-3 문장. 긴 분석이 필요하면 마크다운 단락으로.
```

## Type 별 user message (`src/agent/user-message.ts`)

| Type | user message |
|---|---|
| `issue.created` | `[이벤트: issue.created]\n이슈가 새로 생성됐고 당신이 담당자입니다.\n이슈키: {issueKey}\n제목: {title}\n생성자: @{actor.username}\n\n필요시 get_issue_detail 로 본문을 확인하고 작업 방향을 코멘트로 알려주세요.` |
| `issue.assigned` | `[이벤트: issue.assigned]\n당신이 이 이슈의 담당자로 지정됐습니다.\n이슈키: {issueKey}\n제목: {title}\n지정자: @{actor.username}\n\nget_issue_detail 로 컨텍스트 파악 후 작업 시작. update_status('IN_PROGRESS') 와 시작 코멘트.` |
| `issue.commented` | `[이벤트: issue.commented]\n담당한 이슈에 사용자가 코멘트를 남겼습니다.\n이슈키: {issueKey}\n작성자: @{actor.username} ({actor.kind})\n코멘트: "{commentBody}"\n\n적절히 응답. 추가 컨텍스트 필요시 get_issue_detail.` |
| `issue.status_changed` | `[이벤트: issue.status_changed]\n담당한 이슈의 상태가 변경됐습니다: {previousStatus} → {newStatus} (by @{actor.username}).\n이슈키: {issueKey}\n\n필요한 대응이 있으면 진행. 단순 알림이면 무시.` |

## CLI 실행 정책 (`src/agent/cli-runner.ts`)

firehub `agent-cli.ts` 패턴 차용. 핵심:

- `spawn('claude', cliArgs, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })`
- childEnv:
  - parent env 복사
  - `delete childEnv.ANTHROPIC_API_KEY` (구독 모드 강제)
  - `childEnv.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN`
  - `WORKPLACE_AGENT_API_KEY`, `WORKPLACE_API_BASE_URL` 그대로 전달 (MCP server child 가 사용)
- cliArgs (예):
  ```
  --print {userMessage}
  --system-prompt {SYSTEM_PROMPT}
  --model claude-sonnet-4-6
  --max-turns 10
  --allowedTools mcp__workplace__*
  --mcp-config {mcpConfigPath}
  --output-format stream-json
  --dangerously-skip-permissions
  ```
- stdout: line-by-line JSONL 파싱. 메시지 type 별 처리 (system/assistant/user/result). result type 도달 시 종료.
- timeout: 5분 (300_000ms). 초과 시 SIGTERM → 5초 후 SIGKILL.
- child 실패·timeout·non-zero exit → console.error 로 type+issueKey 와 함께 로그
- unhandled rejection / 'aborted' 메시지는 process-level handler 가 swallow (firehub 패턴 차용)

## MCP server entry point (`src/mcp/workplace-mcp-server.ts`)

- 별 entry point — `node dist/mcp/workplace-mcp-server.js` 로 실행
- `@modelcontextprotocol/sdk` 의 stdio transport 사용
- 시작 시 env 에서 `WORKPLACE_API_BASE_URL` + `WORKPLACE_AGENT_API_KEY` 읽음
- `createWorkplaceApiClient(...)` 인스턴스 생성, 4 도구가 그걸 호출
- 빌드 산출물에 포함되도록 `tsconfig` 의 `include` 와 `package.json` 의 `build` 확인

## MCP config (`src/agent/mcp-config.ts`)

`.mcp-config.json` 예:
```json
{
  "mcpServers": {
    "workplace": {
      "command": "node",
      "args": ["dist/mcp/workplace-mcp-server.js"],
      "env": {
        "WORKPLACE_API_BASE_URL": "<inherit>",
        "WORKPLACE_AGENT_API_KEY": "<inherit>"
      }
    }
  }
}
```

런타임에 정적 파일을 디스크에 두거나 (`apps/workplace-ai-agent/mcp-config.json`), `runAgent` 가 매번 임시 파일을 만들어 경로를 CLI 인자로 전달. 정적 파일이 단순.

## 환경변수

| 변수 | 의미 | 기본값 | 필수 |
|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | 구독 인증 토큰 (`claude setup-token` 으로 발급) | (없음) | **예** (부트 fail-fast) |
| `WORKPLACE_AI_MODEL` | 모델 ID override | `claude-sonnet-4-6` | 아님 |
| `WORKPLACE_AI_MAX_TURNS` | maxTurns override | `10` | 아님 |
| `WORKPLACE_AI_TIMEOUT_MS` | CLI 호출 timeout | `300000` (5분) | 아님 |
| `INTERNAL_SERVICE_TOKEN` | 인바운드 /events 인증 | (스캐폴딩 기존) | 예 |
| `WORKPLACE_API_BASE_URL` | workplace-api URL | (스캐폴딩 기존) | 예 |
| `WORKPLACE_AGENT_API_KEY` | AGENT API key | (스캐폴딩 기존) | 예 |
| `ANTHROPIC_API_KEY` | **사용 안 함** — `.env.example` 에서 제거 | - | - |

`src/index.ts` 부트:
```ts
const required = ['CLAUDE_CODE_OAUTH_TOKEN', 'INTERNAL_SERVICE_TOKEN', 'WORKPLACE_AGENT_API_KEY'];
for (const k of required) {
  if (!process.env[k]) { console.error(`[ai-agent] ${k} 미설정`); process.exit(1); }
}
```

## 비동기 처리 / 에러

`event-handler` 의 4 핸들러:
```ts
runAgent(envelope).catch((e) =>
  console.error('[event-handler] runAgent 실패', { type: envelope.type, error: e }),
);
// await 없음 — fire-and-forget
```

`routes/events.ts` 의 핸들러는 핸들러를 `await` 하지 않고 즉시 `202 { received: true }`.

unhandled rejection 처리 — `src/index.ts` 의 process-level handler 가 SDK abort 류 메시지 swallow (firehub 패턴):
```ts
process.on('unhandledRejection', (reason: unknown) => {
  const m = reason instanceof Error ? reason.message : String(reason);
  if (m.includes('aborted')) {
    console.warn('[process] suppressed abort rejection:', m);
  } else {
    console.error('[process] unhandled rejection:', reason);
  }
});
```

## 백엔드 권한 분기

`IssueAssigneeService.replace()` 의 정규화·멤버십 검증 이후, diff 계산 직전:

```java
var caller = userRepository.findById(callerId).orElseThrow(...);
if ("AGENT".equals(caller.kind())) {
  // 현재 list 에서 자기 자신만 제거한 결과 외 변경 금지
  Set<Long> currentMinusSelf = new HashSet<>(current);
  currentMinusSelf.remove(callerId);
  if (!target.equals(currentMinusSelf)) {
    throw new IssueAssigneeAgentRestrictionException();
  }
}
```

신규 예외 + `GlobalExceptionHandler` (또는 동등) 에 403 매핑.

## 테스트

### ai-agent 단위
- `system-prompt.ts` — 상수 export 검증 (스냅샷 1개)
- `user-message.ts` — 4 type × 입력 → 문자열 (4 case)
- `mcp/tools.ts` — 각 도구 handler 가 client mock 의 정확한 메서드를 정확한 인자로 호출 (4 case)
- `event-handler.test.ts` — `runAgent` 를 vi.mock, 핸들러가 envelope 그대로 fire-and-forget 호출 + await 안 함 (4 type 케이스 + await 안 함 검증 1 케이스)

### ai-agent 통합 (제한적)
- `clients/workplace-api.test.ts` — nock 으로 신규 메서드 검증:
  - `getIssueDetail` GET 경로/헤더/body 1 케이스
  - `updateIssueStatus` PATCH 1 케이스
  - `unassignSelf` 의 me + GET + PUT 시퀀스 1 케이스
  - `unassignSelf` 의 me 캐시 — 연속 호출 시 /users/me 1회만 1 케이스
- `cli-runner.ts` — child spawn 전체를 모킹하기 어려움. 핵심 args 빌더와 env 빌더 만 단위 함수로 분리해 검증 (spawn 자체는 미테스트). firehub 도 통합 테스트 없음.
- `mcp/workplace-mcp-server.ts` — entry point. 별 자동화 테스트 없음. 수동 검증으로 갈음.

### 백엔드 통합 (`IssueAssigneeServiceAgentTest`)
1. AGENT actor 가 자기 자신만 제거 → 정상
2. AGENT actor 가 다른 사람 제거 → 403
3. AGENT actor 가 새 사람 추가 → 403
4. AGENT actor 가 자기 단독 상태에서 자기 제거 (current=[agent], target=[]) → 정상
5. HUMAN actor 회귀 — 임의 변경 가능

### 수동 e2e (필수)
1. 로컬에서 `claude setup-token` 발급 → `.env.local` 의 `CLAUDE_CODE_OAUTH_TOKEN`
2. workplace-api 9090 + ai-agent 7070 기동 (AGENT API key 발급 + 환경변수)
3. workplace-web 에서 AGENT 를 assignee 로 한 이슈 생성 (본문에 명확한 요구사항)
4. 이슈 상세에서 LLM 응답 코멘트 가시 — `_(자동 응답)_` 접미사 없음
5. 사용자가 추가 코멘트로 질문 → AGENT 가 응답
6. AGENT 가 작업 완료 → `update_status('DONE')` + `unassign_self` 실행 → 활동 타임라인 변화 노출
7. AGENT 가 다른 멤버 추가 시도 (직접 curl) → 백엔드 403 확인

수동 검증 불가 환경이면 단위 + 백엔드 통합으로 갈음, LLM 통합은 검증 못 함을 명시.

## 위험 신호

| # | 위험 | 완화 |
|---|---|---|
| 1 | LLM 비용 폭증 / 무한 루프 | 5b-1 actor=AGENT skip + 5c-1 commented 핸들러 defense + maxTurns 10 + system prompt 의 "5번 이상 반복 금지" |
| 2 | `CLAUDE_CODE_OAUTH_TOKEN` 만료 | 토큰 발급 시 만료 안내. 만료 시 부트 fail-fast 는 아니지만 첫 LLM 호출 실패 → 로그로 인지 |
| 3 | child process 가 hang | 5분 timeout + SIGTERM/SIGKILL |
| 4 | MCP server child 가 죽음 | claude CLI 가 도구 호출 시 에러 메시지 → LLM 이 인지. ai-agent 측은 별 처리 안 함 |
| 5 | AGENT 가 의도치 않게 자기 추가 시도 | 백엔드 분기가 403 |
| 6 | 5c-1 의 ack 코드가 남아 LLM 응답과 동시 발사 | 5c-2 작업 시 ack 코드 완전 제거 — 검증 체크리스트에 명시 |
| 7 | LLM 응답이 비결정적 → CI 자동화 불가 | 본 epic 비목표. 단위·백엔드 통합 + 수동 e2e 로 갈음 |
| 8 | fire-and-forget — ai-agent 죽으면 작업 손실 | 5c-2 한계 인정. 후속에서 큐/outbox |

## 완료 기준 (DoD)

- ai-agent: 5c-1 ack 텍스트 완전 제거 + CLI runner + MCP server entry + 4 도구 + run-agent
- workplace-api: AGENT 권한 분기 + 통합 5 PASS, 기존 회귀 0
- `CLAUDE_CODE_OAUTH_TOKEN` 미설정 시 부트 fail-fast
- `pnpm test` (turbo) + `./gradlew test` 통과
- 수동 e2e: 실제 claude CLI + 구독 토큰으로 LLM 응답 + 도구 호출 동작 확인
- DB 마이그레이션 0

## 영향 범위

- 수정: workplace-api `IssueAssigneeService` + 신규 예외 1 + 통합 테스트 1
- 추가/수정: ai-agent 의 agent·mcp·clients·routes 전반
- workplace-web: 변경 없음 (시각 구분은 5c-3)
- DB: 변경 없음
- Dockerfile: 변경 없음 (스캐폴딩 셋업 그대로 활용)

## 의존성

- Phase 5a (AGENT 유저 + API key) ✅
- workplace-ai-agent 스캐폴딩 (Dockerfile 의 claude CLI 글로벌 설치 + 비루트) ✅
- 5b-1 (이벤트 발사) ✅
- 5c-1 (envelope type 분기 골격) ✅ — 본 epic 이 LLM 으로 갈아끼움

## 후속

- **5c-3**: 프론트엔드 AGENT 시각 구분 (코멘트 / 타임라인)
- **후속**: 큐/outbox, multi-AGENT 라우팅, 메트릭, SDK 모드 추가, session resume

## 커밋

본 epic 은 백엔드 + ai-agent 두 변경 묶음, 단일 commit, 한국어:
```
feat: AGENT CLI LLM 응답 + MCP 도구 + 자기-unassign 권한 — #30 (5c-2)
```

scope 가 두 앱 걸치므로 무영역 또는 `feat(ai-agent,api):` 표기.

push 는 사용자 명시적 승인 후. #30 close 는 5c-3 완료 시점에 결정.
