# ai-agent bootstrap 단일화 — 설계 (#34)

> issue: #34
> 작성일: 2026-05-26
> 의존: #33 (OAuth 토큰 DB 저장) — 로컬 commit 완료, push 보류 중

## 배경

#33 으로 Claude OAuth 토큰을 DB 로 옮겼지만 ai-agent 의 부트스트랩에는 여전히 비밀이 2개:

- `INTERNAL_SERVICE_TOKEN` — workplace-api → ai-agent 인바운드
- `WORKPLACE_AGENT_API_KEY` — ai-agent → workplace-api 아웃바운드 (특정 AGENT 의 API key)

후자의 한계:
- env 비밀 2개 — 일관성 ↓
- "ai-agent 프로세스 1대 = AGENT 1명" 1:1 매핑
- AGENT 추가/교체 시 키 재발급 + 재기동
- envelope 의 assignees 정보 미활용

탐색 결과 **workplace-api 가 이미 `Authorization: Internal <token>` + `X-On-Behalf-Of: <userId>` 패턴 지원** (`JwtAuthenticationFilter` 73-91). 즉 ai-agent 가 헤더만 갈아끼우면 workplace-api 측 변경 0 으로 다중 AGENT 대행 가능.

## 목표

ai-agent 를 **"여러 AGENT 를 대행하는 내부 서비스"** 로 재설계. env 비밀을 `INTERNAL_SERVICE_TOKEN` 1개로 통일. 이벤트 envelope 의 assignees 중 첫 AGENT 를 골라 그 자격으로 workplace-api 호출.

## 비목표 (YAGNI)

- workplace-api Authorization filter 변경 — 이미 충분
- `/internal/*` URL prefix 신설 — 기존 endpoint 그대로 동작
- envelope 당 다중 AGENT 동시 spawn — 첫 1명만 처리
- MCP server 가 envelope 에서 직접 agentId 추출 — child env 에 고정 (1 spawn = 1 AGENT)
- AGENT 본인 자격으로 API key 직접 발급 흐름 보존 — 별도 운영용으로 5a 의 키 발급 화면은 유지하되 ai-agent 부트스트랩과는 무관

## 의사결정 요약

| 결정 | 선택 | 이유 |
|---|---|---|
| 인증 헤더 | `Authorization: Internal <token>` + `X-On-Behalf-Of: <agentId>` | workplace-api 가 이미 지원하는 패턴. 변경 0 |
| AGENT 선택 | `assignees.filter(kind===AGENT)[0]` | 단순. 다중 AGENT 는 v1 비목표 |
| 0 AGENT 인 이벤트 | spawn 생략 + warn 로그 | 응답 대상이 없는 이벤트는 무의미 |
| `/users/me/oauth-token` | 그대로 유지 | Internal + X-On-Behalf-Of 가 principal 을 그 AGENT 로 설정 → /me 그대로 동작 |
| MCP server 의 agentId | child env `ACTING_AGENT_ID` | mcp-config 의 `${VAR}` 치환으로 자연 전달 |
| `WORKPLACE_AGENT_API_KEY` | 제거 (`.env.example` + REQUIRED_ENV + docs) | 더 이상 부트스트랩에 불필요 |
| 다중 AGENT race | parent env 미오염 — `buildChildEnv` 가 child-only env 생성 | spawn 동시성 안전 |
| #33 push 시점 | #34 완료 후 두 commit 함께 push | 중간 상태로 운영 배포되지 않도록 |

## 아키텍처

```
이벤트 도착 (workplace-api → ai-agent /events)
    │
    │  envelopeSchema 검증 (5c-2 그대로)
    ▼
event-handler.handleEvent(env, { client })   ← 5c-2 시그니처 그대로
    │
    │  self-loop 차단 (5c-2)
    ▼
run-agent.runAgent(env, { client })
    │
    │  1) pickActingAgentId(env)  ← 신규
    │     · null 이면 warn + return
    │  2) client.getOAuthToken(agentId)
    │     · 헤더: Authorization: Internal <token>
    │              X-On-Behalf-Of: <agentId>
    │  3) buildChildEnv(parent, token, agentId)
    │     · CLAUDE_CODE_OAUTH_TOKEN, ACTING_AGENT_ID, INTERNAL_SERVICE_TOKEN
    │  4) spawn('claude', args, { env: childEnv })
    ▼
claude CLI process
    │  mcp-config 의 ${ACTING_AGENT_ID}, ${INTERNAL_SERVICE_TOKEN} 치환
    │  도구 호출 시 stdio MCP server 자식 spawn
    ▼
workplace-mcp-server (child)
    │  env 에서 actingAgentId 읽음
    │  buildTools(client, actingAgentId) — agentId 가 closure 로 바인딩
    │  도구 호출 시 client 메서드에 agentId 전달
    ▼
client → workplace-api 호출
    │  Authorization: Internal <token>
    │  X-On-Behalf-Of: <agentId>
    ▼
workplace-api (변경 0)
    │  JwtAuthenticationFilter.authenticateWithInternalToken
    │     → SecurityContext.principal = <agentId>
    │  기존 endpoint 모두 그 AGENT 자격으로 처리
    │  IssueAssigneeService.replace 의 AGENT 분기도 정상 작동
```

## ai-agent 변경 파일

### 신규

| 파일 | 책임 |
|---|---|
| `src/agent/agent-resolver.ts` | `pickActingAgentId(envelope): number | null` |
| `src/agent/agent-resolver.test.ts` | 4 케이스 (1 AGENT / 0 AGENT / HUMAN only / 여러 → 첫 번째) |

### 수정

| 파일 | 변경 |
|---|---|
| `src/clients/workplace-api.ts` | `createWorkplaceApiClient({ baseURL, internalToken })`. 모든 메서드 시그니처 첫 인자 `agentId: number`. `getMyOAuthToken` → `getOAuthToken(agentId)`. `getCachedSelfUserId` 제거. 매 호출 `X-On-Behalf-Of` 헤더 |
| `src/clients/workplace-api.test.ts` | `matchHeader('authorization', /^Internal /)` + `matchHeader('x-on-behalf-of', '201')`. apiKey 케이스 제거 |
| `src/agent/cli-runner.ts` | `buildChildEnv(parent, token, agentId)` 3-arg. `ACTING_AGENT_ID = String(agentId)`. `INTERNAL_SERVICE_TOKEN` 은 parent 의 값 그대로 |
| `src/agent/cli-runner.test.ts` | 3-arg 시그니처 + ACTING_AGENT_ID 검증 케이스 |
| `src/agent/run-agent.ts` | `pickActingAgentId` 호출 → null 이면 warn return → `client.getOAuthToken(agentId)` → `buildChildEnv(env, token, agentId)` |
| `src/agent/run-agent.test.ts` | (a) 0 AGENT 이벤트 시 spawn 0 (b) 1 AGENT 시 정상 |
| `src/agent/event-handler.ts` | 변경 없음 (시그니처 그대로) |
| `src/mcp/workplace-mcp-server.ts` | env 에서 `INTERNAL_SERVICE_TOKEN` + `ACTING_AGENT_ID` 읽음. `createWorkplaceApiClient({baseURL, internalToken})` + `buildTools(client, actingAgentId)` |
| `src/mcp/tools.ts` | `buildTools(client, agentId)` 시그니처. 4 핸들러가 모두 `client.X(agentId, ...)` 호출 |
| `src/mcp/tools.test.ts` | client mock + buildTools 호출 갱신. 각 핸들러가 첫 인자에 agentId 전달 검증 |
| `src/index.ts` | REQUIRED_ENV 에서 `WORKPLACE_AGENT_API_KEY` 제거. createWorkplaceApiClient 인자 `internalToken` |
| `mcp-config.json` | env block 에서 `WORKPLACE_AGENT_API_KEY` 제거 + `ACTING_AGENT_ID` 추가 |
| `.env.example` | `WORKPLACE_AGENT_API_KEY=` 라인 제거. 코멘트 갱신 |
| `CLAUDE.md` | 환경변수 표에서 `WORKPLACE_AGENT_API_KEY` 행 제거 |

## workplace-api 변경 파일

| 파일 | 변경 |
|---|---|
| — | **변경 없음** |

`JwtAuthenticationFilter.authenticateWithInternalToken` 이 이미 `Authorization: Internal` + `X-On-Behalf-Of` 를 처리해 SecurityContext 의 principal 을 그 user_id 로 설정. 기존 모든 endpoint (`/users/me/oauth-token`, `/comments`, `/status`, `/assignees`) 가 그 AGENT 자격으로 정상 동작.

## workplace-web 변경 파일

| 파일 | 변경 |
|---|---|
| — | **변경 없음** |

#33 의 OAuth 토큰 관리 UI 그대로. AGENT API key 발급 UI 도 그대로 (운영용으로 유지 — ai-agent 부트스트랩과 분리).

## 환경변수 비교

### #33 시점
```
INTERNAL_SERVICE_TOKEN
WORKPLACE_API_BASE_URL
WORKPLACE_AGENT_API_KEY     ← bootstrap (AGENT-specific API key)
WORKPLACE_AI_MODEL?
WORKPLACE_AI_MAX_TURNS?
WORKPLACE_AI_TIMEOUT_MS?
```

### #34 후
```
INTERNAL_SERVICE_TOKEN       ← 유일한 부트스트랩
WORKPLACE_API_BASE_URL
WORKPLACE_AI_MODEL?
WORKPLACE_AI_MAX_TURNS?
WORKPLACE_AI_TIMEOUT_MS?
```

## 코드 세부

### `agent-resolver.ts`

```ts
// envelope 의 assignees 에서 대행할 AGENT 1명 선택. 다중 AGENT 는 v1 비목표 — 첫 번째.
// AGENT 가 없는 이벤트 (예: HUMAN-only 이슈) 는 null → run-agent 가 spawn 생략.
import type { IssueEventEnvelope } from '../types/issue-events.js';

export function pickActingAgentId(env: IssueEventEnvelope): number | null {
  const agents = env.payload.assignees.filter((u) => u.kind === 'AGENT');
  return agents.length > 0 ? agents[0].id : null;
}
```

### `cli-runner.ts` 의 `buildChildEnv`

```ts
export function buildChildEnv(
  parent: NodeJS.ProcessEnv,
  token: string,
  agentId: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  env.ACTING_AGENT_ID = String(agentId);
  // INTERNAL_SERVICE_TOKEN 은 parent 그대로 전달 — MCP server child 가 사용
  return env;
}
```

### `workplace-api.ts` (요지)

```ts
export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  internalToken: string;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { Authorization: `Internal ${opts.internalToken}` },
  });

  const onBehalfOf = (agentId: number) => ({
    headers: { 'X-On-Behalf-Of': String(agentId) },
  });

  return {
    async addIssueComment(agentId, issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.post(
        `/projects/${projectKey}/issues/${number}/comments`,
        { body },
        onBehalfOf(agentId),
      );
    },
    async updateIssueStatus(agentId, issueKey, statusKey) { /* PATCH ...status, onBehalfOf */ },
    async getIssueDetail(agentId, issueKey) { /* GET ..., onBehalfOf */ },
    async unassignSelf(agentId, issueKey) { /* GET /users/me?, GET /assignees, PUT /assignees, onBehalfOf */ },
    async getOAuthToken(agentId) {
      const r = await http.get('/users/me/oauth-token', onBehalfOf(agentId));
      return { token: String(r.data?.token ?? ''), label: r.data?.label ?? null };
    },
  };
}
```

`unassignSelf` 흐름이 5c-2 에서는 `/users/me` 호출로 self id 캐시했지만, 이제 `agentId` 가 명시적으로 인자라 그 호출 불필요:

```ts
async unassignSelf(agentId, issueKey) {
  const { projectKey, number } = parseIssueKey(issueKey);
  const r = await http.get(
    `/projects/${projectKey}/issues/${number}/assignees`,
    onBehalfOf(agentId),
  );
  const current: { id: number }[] = Array.isArray(r.data) ? r.data : [];
  const next = current.filter((u) => u.id !== agentId).map((u) => u.id);
  await http.put(
    `/projects/${projectKey}/issues/${number}/assignees`,
    { userIds: next },
    onBehalfOf(agentId),
  );
}
```

### MCP server (`workplace-mcp-server.ts`)

```ts
async function main(): Promise<void> {
  const baseURL = process.env.WORKPLACE_API_BASE_URL;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const actingAgentIdRaw = process.env.ACTING_AGENT_ID;
  const actingAgentId = Number(actingAgentIdRaw);
  if (!baseURL || !internalToken || !Number.isFinite(actingAgentId)) {
    console.error('[workplace-mcp] 환경변수 누락 또는 ACTING_AGENT_ID 형식 오류', {
      hasBaseURL: !!baseURL,
      hasInternalToken: !!internalToken,
      actingAgentIdRaw,
    });
    process.exit(1);
  }

  const client = createWorkplaceApiClient({ baseURL, internalToken });
  const tools = buildTools(client, actingAgentId);
  // ... 나머지 5c-2 의 구조 그대로
}
```

### `tools.ts` 의 `buildTools(client, agentId)`

```ts
export function buildTools(client: WorkplaceApiClient, agentId: number): McpTool[] {
  return [
    {
      name: 'get_issue_detail',
      // ...
      async handler(args) {
        const { issueKey: k } = issueKeyOnly.parse(args);
        const detail = await client.getIssueDetail(agentId, k);
        return JSON.stringify(detail);
      },
    },
    // add_comment / update_status / unassign_self 동일 패턴
  ];
}
```

### `mcp-config.json`

```json
{
  "mcpServers": {
    "workplace": {
      "command": "node",
      "args": ["dist/mcp/workplace-mcp-server.js"],
      "env": {
        "WORKPLACE_API_BASE_URL": "${WORKPLACE_API_BASE_URL}",
        "INTERNAL_SERVICE_TOKEN": "${INTERNAL_SERVICE_TOKEN}",
        "ACTING_AGENT_ID": "${ACTING_AGENT_ID}"
      }
    }
  }
}
```

## 테스트

### 신규

- `agent-resolver.test.ts` — 4 케이스
  - 1 AGENT → 그 id
  - 0 AGENT (HUMAN only) → null
  - 빈 assignees → null
  - 여러 AGENT (3명) → 첫 번째 id

### 수정

- `workplace-api.test.ts` — `matchHeader('authorization', 'Internal test-token')` + `matchHeader('x-on-behalf-of', '201')` 검증. `X-Api-Key` 검증 케이스 제거. `getMyOAuthToken` → `getOAuthToken(agentId)` 갱신
- `cli-runner.test.ts` — `buildChildEnv(parent, token, agentId)` 3-arg. ACTING_AGENT_ID, CLAUDE_CODE_OAUTH_TOKEN 모두 검증
- `run-agent.test.ts` — (a) AGENT 없는 envelope → spawn 미호출 + warn 1 케이스 추가 (b) 1 AGENT 정상 1 케이스 (기존 유지) (c) fetch 실패 1 케이스 (기존 유지)
- `tools.test.ts` — `buildTools(client, 201)` 으로 호출 + 각 핸들러가 client 메서드에 첫 인자 201 전달 검증
- `event-handler.test.ts` — client mock 의 `getOAuthToken` 추가 (`getMyOAuthToken` 제거). 시그니처 그대로

### 회귀 (변경 없는 게 정상)

- 백엔드 모든 통합 테스트 — 0 변경, 모두 PASS
- `IssueAssigneeServiceTest` 의 AGENT 분기 5 케이스 — 변경 없이 PASS (caller principal 이 그 AGENT 의 user_id 라서)
- Playwright E2E `oauth-token.spec.ts` (#33) — UI 미변경, PASS

### 수동 e2e (필수)

1. workplace-web 에서 AGENT 두 명 (A, B) 생성
2. 각자 `claude setup-token` (또는 같은 토큰 — 검증용으로는 무방) 으로 OAuth 토큰 등록
3. AGENT API key 없이 (env 에서 `WORKPLACE_AGENT_API_KEY` 빠진 채로) ai-agent 기동 — 부트 정상
4. 이슈 1 에 A 만 담당 → A 응답
5. 이슈 2 에 B 만 담당 → B 응답 (같은 ai-agent 프로세스, 다른 토큰·다른 AGENT)
6. 이슈 3 에 A, B 모두 담당 → A 만 응답 (첫 번째 AGENT 정책)
7. 이슈 4 에 HUMAN 만 담당 → ai-agent 로그 `assignees 에 AGENT 없음 — skip` + 활동 없음
8. AGENT A 가 unassign_self 호출 → 정상 (#30 의 분기 회귀 검증)
9. AGENT A 가 다른 멤버 추가 시도 → 403 (#30 의 분기)

## 위험

| # | 위험 | 완화 |
|---|---|---|
| 1 | mcp-config 의 `${ACTING_AGENT_ID}` 치환이 동작 안 함 | Claude CLI 의 mcp-config env interpolation 은 표준 동작 (firehub 검증됨). 실패 시 fallback: ai-agent main 이 임시 mcp-config 를 disk 에 쓰고 그 경로를 CLI 인자로 — 본 epic 비목표, 후속 |
| 2 | INTERNAL_SERVICE_TOKEN 유출 시 모든 AGENT 가장 가능 | 5c-2 부터 동일 위험. 운영 환경에서만 strong token + 회전 |
| 3 | X-On-Behalf-Of 누락 시 workplace-api 가 401 — silent | client 의 모든 메서드가 agentId 인자 필수 (TypeScript 강제) |
| 4 | 동시성 race — 한 ai-agent 가 여러 AGENT 동시 spawn 시 parent env 오염 | `buildChildEnv` 가 parent 미오염 child-only env 생성 (Object spread) |
| 5 | 5a 의 AGENT API key 발급 UI 가 더 이상 ai-agent 부트스트랩에는 무관해짐 — 사용자가 혼란 | docs 에 명시: "5a 의 API key 는 외부 서비스가 AGENT 자격으로 호출할 때 사용. ai-agent 자체는 INTERNAL_SERVICE_TOKEN 단일 사용" |
| 6 | 여러 AGENT 가 같은 이슈에 assigned 일 때 첫 번째만 응답 — 사용자가 두 번째 AGENT 기대 | spec 명시 + 첫 번째 AGENT 의 응답에서 그 사실을 코멘트로 알리거나, 운영 정책으로 단일 AGENT 권장 |

## 완료 기준 (DoD)

- ai-agent: env 에서 `WORKPLACE_AGENT_API_KEY` 완전 제거 + 모든 호출에 `Authorization: Internal` + `X-On-Behalf-Of`
- workplace-api: 변경 0, 회귀 0
- workplace-web: 변경 0, 회귀 0
- 신규 단위 테스트 모두 PASS
- 백엔드 통합 + Playwright E2E 회귀 0
- 수동 e2e 9 단계 통과

## 영향 범위

- ai-agent: 클라이언트·CLI runner·MCP server·tools·index·문서
- workplace-api / workplace-web / DB / Dockerfile: 변경 없음

## 의존성

- #30 (5c-2) ✅
- #33 (OAuth 토큰 DB) — 로컬 commit, push 보류 중 → 본 epic 함께 push

## 후속

- 다중 AGENT 동시 처리 (envelope 당 2명 이상이면 각각 spawn)
- INTERNAL_SERVICE_TOKEN 회전 자동화
- mcp-config 동적 생성 (env interpolation 한계 시 fallback)

## 커밋

scope 가 ai-agent 단일 — 단일 commit (한국어):
```
refactor(ai-agent): bootstrap 단일화 — INTERNAL + X-On-Behalf-Of 로 다중 AGENT 대행 — #34
```

push 는 사용자 명시적 승인 후. #33 commit 위에 본 commit 쌓아 두 개 함께 push.
