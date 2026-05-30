# Phase 7b — 홈 컴포즈 엔진 (ai-agent `home` 프로필 + `/home/compose`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자의 자연어 명령을 AI가 `show_*` 표시 지시로 해석해 `{message, widgets[]}` 레이아웃 스펙으로 반환하는 컴포즈 엔진을, ai-agent(`home` MCP 프로필 + 동기 compose 라우트)와 workplace-api(`POST /api/v1/home/compose` 프록시 + 세션 영속)에 걸쳐 구현한다.

**Architecture:** 3-tier. `workplace-web`(7c) → `workplace-api POST /api/v1/home/compose`(이 플랜: 세션 영속 + 프록시) → `workplace-ai-agent POST /home/compose`(이 플랜: CLI 스폰 + stream-json 수집) → `claude` CLI(`home` MCP 프로필, `show_*` 도구). AI는 데이터를 직접 조회하지 않고 `show_*` 도구로 "무엇을 보여줄지"만 지시한다. 프론트(7c)가 위젯 레지스트리로 실제 데이터를 가져와 렌더한다.

**Tech Stack:** ai-agent — Node 22 + TS(ESM, NodeNext) + Express 4 + Zod 4 + `@modelcontextprotocol/sdk` + Vitest 4 + supertest. workplace-api — Spring Boot 3.4 + Java 21 + jOOQ + RestClient + JUnit5 + Mockito + MockRestServiceServer.

---

## 실행 순서 & 범위 주의

- **단일 플랜, 순차 실행.** Part A(ai-agent) 전체를 먼저 끝낸 뒤 Part B(workplace-api)를 진행한다. B의 테스트는 A에서 확정한 compose 계약(요청/응답 JSON)에 의존한다.
- **브랜치:** `feat/phase7b-home-compose` (main 에서 분기). main 에서 직접 구현 금지.
- **DB:** Part B 통합 테스트는 test DB(5435)가 필요 — `pnpm db:up` 선행.
- **stream-json 파서(Task A3)가 최대 리스크.** 현행 `cli-runner.ts` 의 `handleLine` 은 로깅만 하므로 복붙할 수집 로직이 없다. 파서는 손으로 작성한 JSONL fixture 기반 테스트로 방어한다. 실제 캡처 샘플을 얻을 수 있으면(Provisioning 완료 시) 추가 검증하라.

## Provisioning 전제 (구현 비차단, 실런타임 차단)

compose 가 실제로 동작하려면 **OAuth 토큰이 등록된 AGENT 유저(#33)** 한 명을 "홈 컴포저"로 지정하고, ai-agent 에 `WORKPLACE_HOME_COMPOSER_AGENT_ID=<그 agentId>` 를 설정해야 한다. 미설정이면 `/home/compose` 는 503 을 반환하고, **기본 홈(세션 목록/복원/기본 구성)은 compose 없이도 동작한다.** 모든 테스트는 토큰/CLI 경로를 모킹하므로 이 전제는 구현·테스트를 막지 않는다. 이 env 키는 `.env.example` 에 문서화한다.

---

## File Structure

### Part A — workplace-ai-agent (`apps/workplace-ai-agent/`)

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `src/mcp/tools.ts` | `McpProfile` 에 `'home'` 추가 + `home` 분기(4 `show_*` 도구) | 수정 |
| `src/mcp/tools.test.ts` | `home` 프로필 도구 빌드 검증 | 수정 |
| `src/mcp/workplace-mcp-server.ts` | 프로필 선택에 `'home'` 반영 | 수정 |
| `src/agent/mcp-config.ts` | `writeTempMcpConfig` profile 타입에 `'home'` 추가 | 수정 |
| `src/agent/home-system-prompt.ts` | `HOME_SYSTEM_PROMPT` 상수(한국어) | 신규 |
| `src/agent/compose-parser.ts` | stream-json 객체 배열 → `{message, widgets[]}` 순수 파서 + 타입 | 신규 |
| `src/agent/compose-parser.test.ts` | 파서 fixture 테스트 | 신규 |
| `src/agent/cli-runner.ts` | `CliArgsInput.includePartialMessages` 옵션 + `runClaudeCliCollect`(JSONL 라인 수집 반환) | 수정 |
| `src/agent/cli-runner.test.ts` | 새 옵션/수집 러너 테스트 | 수정 |
| `src/agent/run-home-compose.ts` | 토큰 fetch → MCP(home) config → CLI 스폰 → 파서 → `ComposeResult` | 신규 |
| `src/agent/run-home-compose.test.ts` | 러너 오케스트레이션 테스트(모킹) | 신규 |
| `src/routes/home.ts` | `POST /home/compose` 라우터 | 신규 |
| `src/routes/home.test.ts` | 라우트 테스트(supertest) | 신규 |
| `src/index.ts` | `internalAuth` 단일 적용 + home 라우터 등록 | 수정 |
| `.env.example` | `WORKPLACE_HOME_COMPOSER_AGENT_ID` 문서화 | 수정 |

### Part B — workplace-api (`apps/workplace-api/`, base `src/main/java/com/workplace/`)

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `home/outbound/ComposeMessages.java` | `ComposeRequest` / `ContextMessage` / `ComposeResult` 레코드 | 신규 |
| `home/outbound/AiAgentComposeClient.java` | ai-agent `POST /home/compose` 동기 호출(60s, 무재시도) | 신규 |
| `home/outbound/AiAgentComposeException.java` | 게이트웨이 실패 → `@ResponseStatus(BAD_GATEWAY)` | 신규 |
| `home/outbound/HomeComposeConfig.java` | `AiAgentComposeClient` Bean(긴 read timeout RestClient) | 신규 |
| `home/dto/HomeComposeRequest.java` | 컨트롤러 입력 `{sessionId, query}` | 신규 |
| `home/dto/HomeComposeResponse.java` | 응답 `{sessionId, message, widgets}` | 신규 |
| `home/exception/HomeComposeUnavailableException.java` | enabled=false → `@ResponseStatus(SERVICE_UNAVAILABLE)` | 신규 |
| `home/service/HomeComposeService.java` | 세션 ensure/create + context + 영속 + 프록시 오케스트레이션 | 신규 |
| `home/controller/HomeComposeController.java` | `POST /api/v1/home/compose` | 신규 |
| `src/test/.../home/service/HomeComposeServiceTest.java` | 서비스 통합(실 DB + mock client) | 신규 |
| `src/test/.../home/controller/HomeComposeControllerTest.java` | `@WebMvcTest` 라우팅/검증 | 신규 |
| `src/test/.../home/outbound/AiAgentComposeClientTest.java` | `MockRestServiceServer` 단위 | 신규 |

---

# Part A — workplace-ai-agent

### Task A1: `home` MCP 프로필 (4 `show_*` 도구)

**Files:**
- Modify: `apps/workplace-ai-agent/src/mcp/tools.ts`
- Modify: `apps/workplace-ai-agent/src/mcp/workplace-mcp-server.ts:31`
- Modify: `apps/workplace-ai-agent/src/agent/mcp-config.ts:28`
- Test: `apps/workplace-ai-agent/src/mcp/tools.test.ts`

설계 결정: 4개 도구 모두 **균일한 입력 봉투** `{ params?, layout? }` 를 받는다(스펙 §5의 평탄 시그니처보다 위젯 `{type,params,layout}` 계약과 1:1 대응돼 파서가 단순·견고해짐). 각 도구는 데이터를 조회하지 않고 `'{"displayed":true}'` 만 반환한다.

- [ ] **Step 1: 실패 테스트 작성** — `tools.test.ts` 에 추가:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTools } from './tools.js';

// home 프로필은 4개의 표시 지시 도구만 노출하고 데이터 조회를 하지 않는다.
describe('buildTools home 프로필', () => {
  const fakeClient = {} as never; // home 도구는 client 를 호출하지 않으므로 빈 객체로 충분
  const tools = buildTools(fakeClient, 1, 'home');

  it('show_* 4개 도구만 노출', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'show_activity',
      'show_issue_detail',
      'show_issue_list',
      'show_my_tasks',
    ]);
  });

  it('각 도구는 {displayed:true} 만 반환 (데이터 조회 X)', async () => {
    for (const t of tools) {
      const out = await t.handler({});
      expect(JSON.parse(out)).toEqual({ displayed: true });
    }
  });

  it('show_issue_list 는 params/layout 입력 스키마를 통과시킨다', () => {
    const t = tools.find((x) => x.name === 'show_issue_list')!;
    expect(() =>
      t.inputSchema.parse({
        params: { status: 'IN_PROGRESS', priority: ['HIGH'], assignee: 'me' },
        layout: { page: 'current' },
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter workplace-ai-agent test src/mcp/tools.test.ts`
Expected: FAIL — `'home'` 이 `McpProfile` 타입에 없어 타입/런타임 에러.

- [ ] **Step 3: 구현** — `tools.ts` 수정.

(a) 입력 스키마 추가 (파일 상단 스키마 블록 끝, line 29 뒤):

```typescript
// 7b: home 컴포저 표시 지시 도구 — 모든 도구가 균일한 {params?, layout?} 봉투를 받는다.
// layout: 캔버스 배치 규칙(프론트 7c 가 해석). page/replace/pageLabel 모두 선택.
const layoutSchema = z
  .object({
    page: z.enum(['new', 'current']).optional(),
    replace: z.string().optional(),
    pageLabel: z.string().optional(),
  })
  .optional();
// issue_list 필터(스펙 §4.1 검증 완료 범위). 전부 선택 — AI 가 의도에 맞는 것만 채운다.
const issueListParams = z
  .object({
    projectKey: z.string().optional(),
    status: z.string().optional(),
    priority: z.array(z.string()).optional(),
    label: z.string().optional(),
    type: z.string().optional(),
    dueFrom: z.string().optional(),
    dueTo: z.string().optional(),
    q: z.string().optional(),
    blocked: z.boolean().optional(),
    topLevel: z.boolean().optional(),
    assignee: z.string().optional(), // 'me' | '<id>'
    size: z.number().int().positive().optional(),
  })
  .optional();
const showMyTasksInput = z.object({ params: z.object({}).optional(), layout: layoutSchema });
const showIssueListInput = z.object({ params: issueListParams, layout: layoutSchema });
const showIssueDetailInput = z.object({
  params: z.object({ number: z.number().int().positive(), projectKey: z.string().optional() }),
  layout: layoutSchema,
});
const showActivityInput = z.object({
  params: z.object({ actorKind: z.enum(['HUMAN', 'AGENT']).optional() }).optional(),
  layout: layoutSchema,
});
```

(b) `McpProfile` 타입 확장 (line 31):

```typescript
export type McpProfile = 'issue' | 'chat' | 'home';
```

(c) `buildTools` 내부, `if (profile === 'chat') { ... }` 블록 **뒤·기본 issue return 앞** 에 home 분기 추가:

```typescript
  // 7b: home 컴포저 — 표시 지시만(데이터 조회 X). 핸들러는 모두 {displayed:true}.
  if (profile === 'home') {
    const displayed = async () => JSON.stringify({ displayed: true });
    return [
      {
        name: 'show_my_tasks',
        description: '사용자의 할 일 요약 카드(담당/워치)를 화면에 표시합니다.',
        inputSchema: showMyTasksInput,
        handler: displayed,
      },
      {
        name: 'show_issue_list',
        description:
          '필터(params)에 맞는 이슈 목록을 화면에 표시합니다. assignee="me" 로 내 담당만, priority/status/dueTo 등으로 좁힙니다.',
        inputSchema: showIssueListInput,
        handler: displayed,
      },
      {
        name: 'show_issue_detail',
        description: '단일 이슈 상세(번호 지정)를 화면에 표시합니다.',
        inputSchema: showIssueDetailInput,
        handler: displayed,
      },
      {
        name: 'show_activity',
        description: '최근 활동 피드를 표시합니다. actorKind="AGENT" 면 AI 가 한 일만 봅니다.',
        inputSchema: showActivityInput,
        handler: displayed,
      },
    ];
  }
```

(d) `workplace-mcp-server.ts:31` 프로필 선택 — `'home'` 인식:

```typescript
  // 6c/7b: WORKPLACE_MCP_PROFILE 로 도구셋 결정.
  const raw = process.env.WORKPLACE_MCP_PROFILE;
  const profile = raw === 'chat' || raw === 'home' ? raw : 'issue';
  const tools = buildTools(client, actingAgentId, profile);
```

(e) `mcp-config.ts:28` — `writeTempMcpConfig` 의 profile 타입 확장:

```typescript
  profile?: 'issue' | 'chat' | 'home';
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter workplace-ai-agent test src/mcp/tools.test.ts && pnpm --filter workplace-ai-agent typecheck`
Expected: PASS, 타입 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-ai-agent/src/mcp/tools.ts apps/workplace-ai-agent/src/mcp/tools.test.ts apps/workplace-ai-agent/src/mcp/workplace-mcp-server.ts apps/workplace-ai-agent/src/agent/mcp-config.ts
git commit -m "feat(ai-agent): home MCP 프로필 — show_* 4 표시 지시 도구 — #47"
```

---

### Task A2: 홈 컴포저 시스템 프롬프트

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/home-system-prompt.ts`

상수 파일이라 별도 단위 테스트는 없다(Task A4 러너 테스트가 사용처를 커버). 한국어 응답·표시 지시 전용·데이터 직접조회 금지 규칙을 명시한다.

- [ ] **Step 1: 작성**

```typescript
// 7b: 홈 컴포저 시스템 프롬프트. 데이터 조회 금지, 표시 지시(show_*)만. 한국어 한 줄 설명.
export const HOME_SYSTEM_PROMPT = `당신은 Smart Workplace 홈 화면의 "컴포저" 입니다. 사용자의 자연어 요청을 해석해, 어떤 화면(위젯)을 보여줄지 결정합니다. 한국어로 응답합니다.

## 핵심 원칙
- 당신은 **데이터를 직접 조회하지 않습니다.** 오직 show_* 도구로 "무엇을 보여줄지"만 지시합니다. 실제 데이터는 프론트엔드가 가져옵니다.
- 사용자의 의도에 맞는 위젯을 1~3개 골라 show_* 도구로 호출하세요. 불필요하게 많이 호출하지 마세요.

## 사용 가능한 도구 (모두 {params?, layout?} 형태)
- show_my_tasks(): 내 할 일 요약 카드.
- show_issue_list({params}): 이슈 목록. params 예) {assignee:"me", status:"IN_PROGRESS", priority:["HIGH"], dueTo:"2026-06-05", blocked:true}.
- show_issue_detail({params:{number, projectKey?}}): 단일 이슈 상세.
- show_activity({params:{actorKind?}}): 최근 활동. actorKind="AGENT" 면 AI 가 한 일만.

## layout (선택)
- 새 화면으로 전환: layout:{page:"new", pageLabel:"이번 주 마감"}. 현재 화면에 추가: layout:{page:"current"}. 미지정 시 현재 화면.

## 행동 원칙
1. "내 담당/내 할 일/내가 처리할" → assignee:"me". "진행중" → status:"IN_PROGRESS". "막힌/블록" → blocked:true. "AI 가 한 것" → show_activity actorKind:"AGENT".
2. 후속 명령("그 중 HIGH 만")이면 직전 대화 맥락을 반영해 필터를 좁힙니다.
3. 도구 호출 후, 무엇을 보여줬는지 **한국어로 짧게 한 줄** 설명하며 마칩니다. (예: "이번 주 마감 + 내 담당 HIGH 이슈예요.")
4. 이모지 금지. 군더더기 없이.
`;
```

- [ ] **Step 2: 타입체크 + 커밋**

Run: `pnpm --filter workplace-ai-agent typecheck`
Expected: PASS

```bash
git add apps/workplace-ai-agent/src/agent/home-system-prompt.ts
git commit -m "feat(ai-agent): 홈 컴포저 시스템 프롬프트 — #47"
```

---

### Task A3: stream-json → `{message, widgets[]}` 파서 (최대 리스크)

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/compose-parser.ts`
- Test: `apps/workplace-ai-agent/src/agent/compose-parser.test.ts`

계약: 입력은 CLI `--output-format stream-json` 의 NDJSON 각 줄을 `JSON.parse` 한 객체 배열. 출력은 `{ message: string, widgets: Widget[] }`.
- `widgets`: 모든 `assistant` 이벤트의 `message.content[]` 중 `type:'tool_use'` 이고 이름이 `show_*`(MCP 네임스페이스 `mcp__workplace__show_*` 포함) 인 블록을 **등장 순서대로** 매핑. `type = show_ 뒤 토큰`, `params = input.params ?? {}`, `layout = input.layout`(없으면 생략).
- `message`: 종료 `result` 이벤트의 `result` 문자열을 우선 사용, 없으면 assistant `text` 블록들을 join.
- `user`(tool_result)·`system` 이벤트는 무시. 파싱 불가/형상 불일치 줄은 건너뛴다(방어적).

- [ ] **Step 1: 실패 테스트 작성** — `compose-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCompose } from './compose-parser.js';

// 실제 stream-json 형상을 본뜬 fixture: system → assistant(tool_use 2개) → user(tool_result) → result.
const fixture = [
  { type: 'system', subtype: 'init', session_id: 'x' },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'mcp__workplace__show_issue_list',
          input: { params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } },
        },
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'mcp__workplace__show_activity',
          input: { params: { actorKind: 'AGENT' } },
        },
      ],
    },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: '{"displayed":true}' }] }] },
  },
  { type: 'result', subtype: 'success', is_error: false, result: '내 담당 HIGH 이슈와 AI 활동을 보여드려요.' },
];

describe('parseCompose', () => {
  it('tool_use 를 순서대로 위젯으로 수집', () => {
    const out = parseCompose(fixture);
    expect(out.widgets).toEqual([
      { type: 'issue_list', params: { assignee: 'me', priority: ['HIGH'] }, layout: { page: 'current' } },
      { type: 'activity', params: { actorKind: 'AGENT' } },
    ]);
  });

  it('result.result 를 message 로 사용', () => {
    expect(parseCompose(fixture).message).toBe('내 담당 HIGH 이슈와 AI 활동을 보여드려요.');
  });

  it('result 없으면 assistant text 블록을 join 해 message 생성', () => {
    const noResult = [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '진행중 이슈예요.' }, { type: 'tool_use', id: 't', name: 'show_issue_list', input: { params: { status: 'IN_PROGRESS' } } }] },
      },
    ];
    const out = parseCompose(noResult);
    expect(out.message).toBe('진행중 이슈예요.');
    expect(out.widgets).toEqual([{ type: 'issue_list', params: { status: 'IN_PROGRESS' } }]);
  });

  it('params 없는 show_my_tasks 는 빈 params', () => {
    const out = parseCompose([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'show_my_tasks', input: {} }] } },
    ]);
    expect(out.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  it('show_ 가 아닌 tool_use 는 무시', () => {
    const out = parseCompose([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'mcp__workplace__get_issue_detail', input: {} }] } },
    ]);
    expect(out.widgets).toEqual([]);
  });

  it('빈 입력 → 빈 위젯 + 빈 message', () => {
    expect(parseCompose([])).toEqual({ message: '', widgets: [] });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter workplace-ai-agent test src/agent/compose-parser.test.ts`
Expected: FAIL — `parseCompose` 미정의.

- [ ] **Step 3: 구현** — `compose-parser.ts`:

```typescript
// 7b: claude CLI stream-json(NDJSON 파싱 객체 배열) → 홈 레이아웃 스펙 {message, widgets[]}.
// show_* tool_use 를 등장 순서대로 위젯으로, result/assistant text 를 message 로 수집한다.

export interface Widget {
  type: string;
  params: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

export interface ComposeResult {
  message: string;
  widgets: Widget[];
}

// 'mcp__workplace__show_issue_list' / 'show_issue_list' → 'issue_list'. show_* 가 아니면 null.
function widgetTypeFromToolName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const m = name.match(/show_([a-z_]+)$/);
  return m ? m[1] : null;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: { params?: unknown; layout?: unknown };
}

// 단일 stream-json 이벤트 객체를 누적기에 반영.
function handleEvent(ev: unknown, widgets: Widget[], textParts: string[]): string | null {
  if (!ev || typeof ev !== 'object') return null;
  const obj = ev as { type?: string; result?: unknown; message?: { content?: unknown } };

  // 종료 이벤트: 최종 텍스트.
  if (obj.type === 'result') {
    return typeof obj.result === 'string' ? obj.result : null;
  }

  // assistant: content[] 에서 tool_use(show_*) → 위젯, text → message 후보.
  if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
    for (const raw of obj.message.content as ContentBlock[]) {
      if (!raw || typeof raw !== 'object') continue;
      if (raw.type === 'tool_use') {
        const wtype = widgetTypeFromToolName(raw.name);
        if (!wtype) continue;
        const input = raw.input ?? {};
        const widget: Widget = {
          type: wtype,
          params: (input.params as Record<string, unknown>) ?? {},
        };
        if (input.layout != null) widget.layout = input.layout as Record<string, unknown>;
        widgets.push(widget);
      } else if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.trim()) {
        textParts.push(raw.text.trim());
      }
    }
  }
  return null;
}

export function parseCompose(events: unknown[]): ComposeResult {
  const widgets: Widget[] = [];
  const textParts: string[] = [];
  let resultText: string | null = null;
  for (const ev of events) {
    const r = handleEvent(ev, widgets, textParts);
    if (r != null) resultText = r;
  }
  const message = (resultText ?? textParts.join('\n')).trim();
  return { message, widgets };
}

// NDJSON 문자열 라인 배열을 안전 파싱(잘못된 줄 건너뜀) 후 parseCompose.
export function parseComposeLines(lines: string[]): ComposeResult {
  const events: unknown[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      // 비 JSON 줄 무시
    }
  }
  return parseCompose(events);
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter workplace-ai-agent test src/agent/compose-parser.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/workplace-ai-agent/src/agent/compose-parser.ts apps/workplace-ai-agent/src/agent/compose-parser.test.ts
git commit -m "feat(ai-agent): stream-json → 홈 위젯 스펙 파서 — #47"
```

---

### Task A4: 컴포즈 러너 (CLI 수집 변형 + `runHomeCompose`)

**Files:**
- Modify: `apps/workplace-ai-agent/src/agent/cli-runner.ts`
- Modify: `apps/workplace-ai-agent/src/agent/cli-runner.test.ts`
- Create: `apps/workplace-ai-agent/src/agent/run-home-compose.ts`
- Test: `apps/workplace-ai-agent/src/agent/run-home-compose.test.ts`

핵심 차이: 컴포즈는 **요청/응답(동기)** 이라 stdout 라인을 모아 반환해야 한다(기존 `runClaudeCli` 는 void). 또 `--include-partial-messages` 는 tool_use input 을 조각내므로 **컴포즈에선 끈다**(완성된 `assistant` 이벤트만 사용).

- [ ] **Step 1: 실패 테스트 작성** — `cli-runner.test.ts` 에 추가:

```typescript
import { buildCliArgs } from './cli-runner.js';

describe('buildCliArgs includePartialMessages=false', () => {
  it('partial messages 플래그를 제외한다', () => {
    const args = buildCliArgs({
      userMessage: 'q', systemPrompt: 's', model: 'm', maxTurns: 8,
      mcpConfigPath: '/x.json', includePartialMessages: false,
    });
    expect(args).not.toContain('--include-partial-messages');
    expect(args).toContain('stream-json');
  });
  it('기본값은 partial messages 포함(기존 동작 유지)', () => {
    const args = buildCliArgs({
      userMessage: 'q', systemPrompt: 's', model: 'm', maxTurns: 8, mcpConfigPath: '/x.json',
    });
    expect(args).toContain('--include-partial-messages');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter workplace-ai-agent test src/agent/cli-runner.test.ts`
Expected: FAIL — 기본 동작상 항상 포함돼 첫 테스트 실패.

- [ ] **Step 3: `cli-runner.ts` 수정**

(a) `CliArgsInput` 에 옵션 추가(line 13 뒤):

```typescript
  // 7b: 컴포즈(요청/응답)는 partial 이벤트가 tool_use input 을 조각내므로 false 로 끈다. 기본 true(기존 동작).
  includePartialMessages?: boolean;
```

(b) `buildCliArgs` 의 고정 배열에서 `--include-partial-messages` 를 조건부로 — 배열을 빌드 후 필터하거나 분기. 가장 단순하게 끝부분 배열을 분리:

```typescript
export function buildCliArgs(i: CliArgsInput): string[] {
  const allowedTools = i.allowFileRead ? 'mcp__workplace__*,Read' : 'mcp__workplace__*';
  const disallowed = i.allowFileRead
    ? BASE_DISALLOWED.filter((t) => t !== 'Read')
    : BASE_DISALLOWED;
  const includePartial = i.includePartialMessages ?? true;
  const args = [
    '--print', i.userMessage,
    '--system-prompt', i.systemPrompt,
    '--model', i.model,
    '--max-turns', String(i.maxTurns),
    '--allowed-tools', allowedTools,
    '--disallowed-tools', disallowed.join(','),
    '--mcp-config', i.mcpConfigPath,
    '--output-format', 'stream-json',
    '--verbose',
  ];
  if (includePartial) args.push('--include-partial-messages');
  args.push('--strict-mcp-config', '--disable-slash-commands', '--dangerously-skip-permissions');
  return args;
}
```

(c) `runClaudeCli` **아래** 에 수집 변형 추가. 기존 `runClaudeCli` 의 stdout 루프와 동일하되 non-empty 라인을 배열에 모아 close 시 반환:

```typescript
// 7b: stdout 의 NDJSON 라인을 모아 반환(컴포즈 동기 응답용). 기존 runClaudeCli 와 spawn/timeout 동일.
export async function runClaudeCliCollect(i: RunCliInput): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    const child = spawn('claude', i.args, {
      env: i.env,
      cwd: i.cwd ?? os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines: string[] = [];
    let buf = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      console.error(`[${i.logTag}] timeout ${i.timeoutMs}ms, SIGTERM`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, i.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) lines.push(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      console.error(`[${i.logTag}] stderr: ${chunk.toString('utf8').trim()}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) lines.push(buf.trim()); // 마지막 개행 없는 잔여
      if (killed) console.error(`[${i.logTag}] killed (timeout)`);
      else if (code !== 0) console.error(`[${i.logTag}] exit ${code}`);
      else console.log(`[${i.logTag}] done (${lines.length} lines)`);
      resolve(lines);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      console.error(`[${i.logTag}] spawn error:`, e);
      resolve(lines);
    });
  });
}
```

- [ ] **Step 4: cli-runner 테스트 통과 확인**

Run: `pnpm --filter workplace-ai-agent test src/agent/cli-runner.test.ts`
Expected: PASS

- [ ] **Step 5: `run-home-compose.test.ts` 실패 테스트 작성** — `cli-runner`·`mcp-config` 를 모킹해 오케스트레이션을 검증:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'x']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCliCollect: vi.fn(),
}));
vi.mock('./mcp-config.js', () => ({
  writeTempMcpConfig: vi.fn(() => '/tmp/cfg.json'),
  cleanupTempMcpConfig: vi.fn(),
}));

import { runHomeCompose, HomeComposerNotConfiguredError } from './run-home-compose.js';
import { runClaudeCliCollect, buildCliArgs } from './cli-runner.js';

const fakeClient = { getOAuthToken: vi.fn() } as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKPLACE_HOME_COMPOSER_AGENT_ID = '7';
  (fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken =
    vi.fn().mockResolvedValue({ token: 'tok', label: null });
});

describe('runHomeCompose', () => {
  it('CLI 출력 라인을 파싱해 {message, widgets} 반환', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'show_my_tasks', input: {} }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: '할 일이에요.' }),
    ]);
    const out = await runHomeCompose({ query: '내 할 일' }, { client: fakeClient });
    expect(out).toEqual({ message: '할 일이에요.', widgets: [{ type: 'my_tasks', params: {} }] });
  });

  it('composer agentId 미설정 → HomeComposerNotConfiguredError', async () => {
    delete process.env.WORKPLACE_HOME_COMPOSER_AGENT_ID;
    await expect(runHomeCompose({ query: 'x' }, { client: fakeClient })).rejects.toBeInstanceOf(
      HomeComposerNotConfiguredError,
    );
  });

  it('recentContext 를 프롬프트에 임베드해 buildCliArgs 에 전달', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([]);
    await runHomeCompose(
      { query: '그 중 HIGH 만', recentContext: [{ role: 'USER', content: '내 담당 보여줘' }] },
      { client: fakeClient },
    );
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0].userMessage;
    expect(passed).toContain('내 담당 보여줘');
    expect(passed).toContain('그 중 HIGH 만');
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm --filter workplace-ai-agent test src/agent/run-home-compose.test.ts`
Expected: FAIL — `run-home-compose.js` 미존재.

- [ ] **Step 7: 구현** — `run-home-compose.ts`:

```typescript
// 7b: 홈 컴포즈 러너 — composer agentId 토큰 fetch → home MCP config → CLI(home 프로필) 스폰 → 파서.
// 데이터 조회는 show_* 도구가 하지 않으므로 토큰은 순수 Claude LLM 인증용(데이터 권한과 무관).
import { HOME_SYSTEM_PROMPT } from './home-system-prompt.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCliCollect } from './cli-runner.js';
import { parseComposeLines, type ComposeResult } from './compose-parser.js';
import type { RunAgentDeps } from './run-agent.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 8;
const DEFAULT_TIMEOUT_MS = 60_000;

// composer agentId 미설정 — /home/compose 라우트가 503 으로 변환.
export class HomeComposerNotConfiguredError extends Error {
  constructor() {
    super('WORKPLACE_HOME_COMPOSER_AGENT_ID 미설정');
    this.name = 'HomeComposerNotConfiguredError';
  }
}

export interface ContextMessage {
  role: string; // 'USER' | 'ASSISTANT'
  content: string;
}
export interface ComposeInput {
  query: string;
  recentContext?: ContextMessage[];
}

// recentContext 를 단발 --print 프롬프트에 임베드(CLI 는 멀티턴 배열을 받지 않음).
function buildComposeUserMessage(input: ComposeInput): string {
  const ctx = input.recentContext ?? [];
  if (ctx.length === 0) return input.query;
  const lines = ctx.map((m) => `${m.role === 'ASSISTANT' ? 'AI' : '사용자'}: ${m.content}`);
  return `이전 대화:\n${lines.join('\n')}\n\n현재 요청: ${input.query}`;
}

export async function runHomeCompose(
  input: ComposeInput,
  deps: RunAgentDeps,
): Promise<ComposeResult> {
  const agentId = Number(process.env.WORKPLACE_HOME_COMPOSER_AGENT_ID);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    throw new HomeComposerNotConfiguredError();
  }

  const token = (await deps.client.getOAuthToken(agentId)).token;
  const mcpConfigPath = writeTempMcpConfig({
    agentId,
    baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    profile: 'home',
  });

  try {
    const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
    const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
    const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    const args = buildCliArgs({
      userMessage: buildComposeUserMessage(input),
      systemPrompt: HOME_SYSTEM_PROMPT,
      model,
      maxTurns,
      mcpConfigPath,
      includePartialMessages: false,
    });
    const env = buildChildEnv(process.env, token, agentId);
    const lines = await runClaudeCliCollect({ args, env, timeoutMs, logTag: `home-compose:${agentId}` });
    return parseComposeLines(lines);
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
  }
}
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm --filter workplace-ai-agent test src/agent/run-home-compose.test.ts && pnpm --filter workplace-ai-agent typecheck`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/workplace-ai-agent/src/agent/cli-runner.ts apps/workplace-ai-agent/src/agent/cli-runner.test.ts apps/workplace-ai-agent/src/agent/run-home-compose.ts apps/workplace-ai-agent/src/agent/run-home-compose.test.ts
git commit -m "feat(ai-agent): 홈 컴포즈 러너 + CLI 수집 변형 — #47"
```

---

### Task A5: `POST /home/compose` 라우트

**Files:**
- Create: `apps/workplace-ai-agent/src/routes/home.ts`
- Test: `apps/workplace-ai-agent/src/routes/home.test.ts`
- Modify: `apps/workplace-ai-agent/src/index.ts`
- Modify: `apps/workplace-ai-agent/.env.example`

- [ ] **Step 1: 실패 테스트 작성** — `home.test.ts` (supertest, `run-home-compose` 모킹):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-home-compose.js', () => ({
  runHomeCompose: vi.fn(),
  HomeComposerNotConfiguredError: class extends Error {},
}));

import { createHomeRouter } from './home.js';
import { runHomeCompose, HomeComposerNotConfiguredError } from '../agent/run-home-compose.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createHomeRouter({ client: {} as never }));
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /home/compose', () => {
  it('정상 → 200 + {message, widgets}', async () => {
    vi.mocked(runHomeCompose).mockResolvedValue({ message: 'ok', widgets: [{ type: 'my_tasks', params: {} }] });
    const res = await request(buildApp()).post('/home/compose').send({ query: '내 할 일' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'ok', widgets: [{ type: 'my_tasks', params: {} }] });
    expect(runHomeCompose).toHaveBeenCalledWith(
      { query: '내 할 일', recentContext: undefined },
      expect.anything(),
    );
  });

  it('query 누락 → 400', async () => {
    const res = await request(buildApp()).post('/home/compose').send({});
    expect(res.status).toBe(400);
    expect(runHomeCompose).not.toHaveBeenCalled();
  });

  it('composer 미설정 → 503', async () => {
    vi.mocked(runHomeCompose).mockRejectedValue(new HomeComposerNotConfiguredError());
    const res = await request(buildApp()).post('/home/compose').send({ query: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('home_composer_not_configured');
  });

  it('러너 오류 → 502', async () => {
    vi.mocked(runHomeCompose).mockRejectedValue(new Error('cli boom'));
    const res = await request(buildApp()).post('/home/compose').send({ query: 'x' });
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter workplace-ai-agent test src/routes/home.test.ts`
Expected: FAIL — `home.js` 미존재.

- [ ] **Step 3: 구현** — `home.ts`:

```typescript
// 7b: 홈 컴포즈 라우트 — workplace-api 가 동기 호출. {query, recentContext?} → {message, widgets[]}.
import { Router } from 'express';
import { z } from 'zod';

import { type RunAgentDeps } from '../agent/run-agent.js';
import { runHomeCompose, HomeComposerNotConfiguredError } from '../agent/run-home-compose.js';

const composeSchema = z.object({
  query: z.string().min(1),
  recentContext: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .optional(),
});

export function createHomeRouter(deps: RunAgentDeps): Router {
  const router = Router();

  router.post('/home/compose', async (req, res) => {
    const parsed = composeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    try {
      const out = await runHomeCompose(
        { query: parsed.data.query, recentContext: parsed.data.recentContext },
        deps,
      );
      res.status(200).json(out);
    } catch (e) {
      if (e instanceof HomeComposerNotConfiguredError) {
        res.status(503).json({ error: 'home_composer_not_configured' });
        return;
      }
      console.error('[home-compose] 실패:', e instanceof Error ? e.message : String(e));
      res.status(502).json({ error: 'compose_failed' });
    }
  });

  return router;
}
```

- [ ] **Step 4: `index.ts` 수정** — `internalAuth` 를 한 번만 적용하고 home 라우터 등록 (line 36-38 교체):

```typescript
import { createHomeRouter } from './routes/home.js';
// ... (기존 import 들 사이에 추가)

app.use(express.json());
app.use(healthRouter);
app.use(internalAuth);
app.use(createEventsRouter({ client: workplaceApi }));
app.use(createHomeRouter({ client: workplaceApi }));
```

그리고 listen 로그(line 56-57)에 `console.log('  POST /home/compose');` 한 줄 추가.

- [ ] **Step 5: `.env.example` 에 문서화** — 아래 한 줄 추가(있는 변수들 근처):

```
# 7b: 홈 컴포저로 사용할 AGENT(OAuth 토큰 등록된 #33) 의 userId. 미설정 시 /home/compose 503.
WORKPLACE_HOME_COMPOSER_AGENT_ID=
```

- [ ] **Step 6: 통과 확인 (전체 ai-agent)**

Run: `pnpm --filter workplace-ai-agent test && pnpm --filter workplace-ai-agent typecheck && pnpm --filter workplace-ai-agent lint`
Expected: 전체 PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-ai-agent/src/routes/home.ts apps/workplace-ai-agent/src/routes/home.test.ts apps/workplace-ai-agent/src/index.ts apps/workplace-ai-agent/.env.example
git commit -m "feat(ai-agent): POST /home/compose 라우트 — #47"
```

---

# Part B — workplace-api

> Part A 의 compose 계약 확정: 요청 `{query, recentContext?:[{role,content}]}` → 응답 `{message:string, widgets:array}`.

### Task B1: `AiAgentComposeClient` (동기 호출, 60s, 무재시도)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/home/outbound/ComposeMessages.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/home/outbound/AiAgentComposeException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/home/outbound/AiAgentComposeClient.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/home/outbound/HomeComposeConfig.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/home/outbound/AiAgentComposeClientTest.java`

`AiAgentEventClient`(void·1s 백오프·4회 재시도) 를 **재사용하지 않는다.** 컴포즈는 CLI cold-start 로 10~30s 걸리는 동기 호출이라 긴 read timeout + 무재시도가 필요하다.

- [ ] **Step 1: 레코드 + 예외 작성**

`ComposeMessages.java`:
```java
package com.workplace.home.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** ai-agent /home/compose 요청/응답 계약 (7b). */
public final class ComposeMessages {
  private ComposeMessages() {}

  /** compose 요청 본문. recentContext 는 follow-up 연속성용 텍스트 전용 맥락. */
  public record ComposeRequest(String query, List<ContextMessage> recentContext) {}

  /** 세션 최근 메시지(텍스트만 — 위젯 jsonb 제외). */
  public record ContextMessage(String role, String content) {}

  /** compose 응답. widgets 는 JSON 배열(JsonNode 로 받아 그대로 영속·반환). */
  public record ComposeResult(String message, JsonNode widgets) {}
}
```

`AiAgentComposeException.java`:
```java
package com.workplace.home.outbound;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** ai-agent 컴포즈 호출 실패 — 게이트웨이 오류로 매핑. */
@ResponseStatus(HttpStatus.BAD_GATEWAY)
public class AiAgentComposeException extends RuntimeException {
  public AiAgentComposeException(String message, Throwable cause) {
    super(message, cause);
  }
}
```

- [ ] **Step 2: 클라이언트 실패 테스트 작성** — `AiAgentComposeClientTest.java` (`MockRestServiceServer`):

```java
package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class AiAgentComposeClientTest {

  private RestClient.Builder builder;
  private MockRestServiceServer server;
  private AiAgentComposeClient client;

  @BeforeEach
  void setUp() {
    builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new AiAgentComposeClient(builder, "tok-123");
  }

  @Test
  void 정상_응답을_ComposeResult_로_역직렬화() {
    server
        .expect(requestTo("http://ai-agent.test/home/compose"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.query").value("내 할 일"))
        .andRespond(
            withSuccess(
                "{\"message\":\"할 일이에요\",\"widgets\":[{\"type\":\"my_tasks\",\"params\":{}}]}",
                MediaType.APPLICATION_JSON));

    ComposeResult res = client.compose(new ComposeRequest("내 할 일", List.of()));

    assertThat(res.message()).isEqualTo("할 일이에요");
    assertThat(res.widgets().get(0).get("type").asText()).isEqualTo("my_tasks");
    server.verify();
  }

  @Test
  void 서버오류_시_재시도없이_AiAgentComposeException() {
    server
        .expect(requestTo("http://ai-agent.test/home/compose"))
        .andExpect(method(HttpMethod.POST))
        .andRespond(withServerError());

    assertThatThrownBy(() -> client.compose(new ComposeRequest("x", List.of())))
        .isInstanceOf(AiAgentComposeException.class);
    server.verify(); // 단 1회 호출(무재시도) 검증
  }
}
```

- [ ] **Step 3: 실패 확인**

Run: `./gradlew :apps:workplace-api:test --tests "com.workplace.home.outbound.AiAgentComposeClientTest"`
(또는 모듈 디렉토리에서 `./gradlew test --tests "..."`)
Expected: FAIL — `AiAgentComposeClient` 미존재.

- [ ] **Step 4: 구현** — `AiAgentComposeClient.java`:

```java
package com.workplace.home.outbound;

import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent 의 POST /home/compose 를 동기 호출한다 (7b).
 *
 * <ul>
 *   <li>인증: Authorization: Internal {token}
 *   <li>무재시도: CLI cold-start(10~30s) 동기 호출 — 재시도는 지연만 가중. 1회만 시도.
 *   <li>실패(IO/4xx/5xx) 시 AiAgentComposeException(502) 로 변환.
 * </ul>
 */
@Slf4j
public class AiAgentComposeClient {

  private final RestClient restClient;
  private final String internalToken;

  public AiAgentComposeClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /** compose 요청 → 결과. 실패 시 AiAgentComposeException. */
  public ComposeResult compose(ComposeRequest request) {
    try {
      return restClient
          .post()
          .uri("/home/compose")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(request)
          .retrieve()
          .body(ComposeResult.class);
    } catch (RestClientException e) {
      log.error("ai-agent compose 실패: {}", e.getMessage());
      throw new AiAgentComposeException("ai-agent compose 호출 실패", e);
    }
  }
}
```

- [ ] **Step 5: Bean 구성** — `HomeComposeConfig.java` (긴 read timeout):

```java
package com.workplace.home.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/** 홈 컴포즈 전용 RestClient Bean — read timeout 60s(CLI cold-start 수용), 무재시도. */
@Configuration
public class HomeComposeConfig {

  @Bean
  public AiAgentComposeClient aiAgentComposeClient(AiAgentProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.DEFAULTS
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(60));
    var factory = ClientHttpRequestFactories.get(settings);
    var builder = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory);
    return new AiAgentComposeClient(builder, props.internalToken());
  }
}
```

주의: `ClientHttpRequestFactories`/`ClientHttpRequestFactorySettings` 는 Spring Boot 3.4 의 `org.springframework.boot.web.client` 패키지. 만약 버전상 deprecated 경고가 나면 동일 패키지의 권장 API(`ClientHttpRequestFactorySettings.defaults()`)로 맞춘다 — 핵심은 connect 5s / read 60s 설정.

- [ ] **Step 6: 통과 확인**

Run: `./gradlew :apps:workplace-api:test --tests "com.workplace.home.outbound.AiAgentComposeClientTest"`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/home/outbound/ apps/workplace-api/src/test/java/com/workplace/home/outbound/
git commit -m "feat(api): AiAgentComposeClient — 동기 compose 호출(60s, 무재시도) — #47"
```

---

### Task B2: `HomeComposeService` (세션 영속 + 프록시 오케스트레이션)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/home/dto/HomeComposeResponse.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/home/exception/HomeComposeUnavailableException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/home/service/HomeComposeService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/home/service/HomeComposeServiceTest.java`

오케스트레이션 순서(중요): (1) enabled 확인 → (2) 세션 ensure(null→create) → (3) **현재 query 영속 전** 기존 메시지로 recentContext 구성(텍스트 전용, 최근 N=6) → (4) USER 메시지 영속 → (5) compose 호출 → (6) ASSISTANT 메시지 영속(content=message, widgets JSON 직렬화) → (7) 응답 반환. 소유권은 `sessionService.getMessages`/`appendMessage` 가 강제(타인 세션 → 404).

유저 시드는 7a `HomeSessionServiceTest` 의 `user(String n)` 헬퍼(jOOQ `USER` 직접 INSERT)와 동일. 테스트는 `@Transactional`(같은 패턴).

- [ ] **Step 1: DTO + 예외 작성**

`HomeComposeResponse.java`:
```java
package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** compose 응답: 세션 id + AI 한 줄 설명 + 위젯 스펙(JSON 배열). */
public record HomeComposeResponse(UUID sessionId, String message, JsonNode widgets) {}
```

`HomeComposeUnavailableException.java`:
```java
package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** ai-agent 연동 비활성(enabled=false) 시 compose 불가. */
@ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
public class HomeComposeUnavailableException extends RuntimeException {
  public HomeComposeUnavailableException(String message) {
    super(message);
  }
}
```

- [ ] **Step 2: 서비스 통합 실패 테스트 작성** — `HomeComposeServiceTest.java`. 7a `HomeSessionServiceTest` 와 동일한 `@Transactional` + jOOQ `USER` 직접 INSERT 유저 시드. `AiAgentComposeClient` 는 `@MockitoBean`, enabled 는 `@TestPropertySource` 로 true:

```java
package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.dto.HomeComposeResponse;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.dto.HomeSessionResponse;
import com.workplace.home.outbound.AiAgentComposeClient;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

// enabled=true 로 ai-agent 연동 켜고, 실 client 는 mock 으로 대체.
@Transactional
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeComposeServiceTest extends IntegrationTestBase {

  @Autowired HomeComposeService composeService;
  @Autowired HomeSessionService sessionService;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;
  @MockitoBean AiAgentComposeClient composeClient;

  // 7a HomeSessionServiceTest 의 user(String) 헬퍼와 동일.
  private long user(String n) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, n)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, n)
        .set(USER.EMAIL, n + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private JsonNode widgets(String json) throws Exception {
    return objectMapper.readTree(json);
  }

  @Test
  void sessionId_null_이면_새_세션_생성하고_USER_ASSISTANT_영속() throws Exception {
    long uid = user("compose" + System.nanoTime());
    when(composeClient.compose(any()))
        .thenReturn(new ComposeResult("내 할 일이에요", widgets("[{\"type\":\"my_tasks\",\"params\":{}}]")));

    HomeComposeResponse res = composeService.compose(uid, null, "내 할 일");

    assertThat(res.sessionId()).isNotNull();
    assertThat(res.message()).isEqualTo("내 할 일이에요");
    assertThat(res.widgets().get(0).get("type").asText()).isEqualTo("my_tasks");

    List<HomeMessageResponse> msgs = sessionService.getMessages(uid, res.sessionId());
    assertThat(msgs).hasSize(2);
    assertThat(msgs.get(0).role()).isEqualTo("USER");
    assertThat(msgs.get(0).content()).isEqualTo("내 할 일");
    assertThat(msgs.get(1).role()).isEqualTo("ASSISTANT");
    assertThat(msgs.get(1).widgets().get(0).get("type").asText()).isEqualTo("my_tasks");
  }

  @Test
  void 기존_세션의_최근메시지를_recentContext_로_전달_현재query_제외() throws Exception {
    long uid = user("ctx" + System.nanoTime());
    HomeSessionResponse s = sessionService.create(uid);
    // 사전 대화 1턴 적재.
    sessionService.appendMessage(uid, s.id(), "USER", "내 담당 보여줘", null);
    sessionService.appendMessage(
        uid, s.id(), "ASSISTANT", "내 담당이에요", "[{\"type\":\"issue_list\",\"params\":{\"assignee\":\"me\"}}]");
    when(composeClient.compose(any())).thenReturn(new ComposeResult("HIGH 만 추렸어요", widgets("[]")));

    composeService.compose(uid, s.id(), "그 중 HIGH 만");

    ArgumentCaptor<ComposeRequest> captor = ArgumentCaptor.forClass(ComposeRequest.class);
    verify(composeClient).compose(captor.capture());
    ComposeRequest sent = captor.getValue();
    assertThat(sent.query()).isEqualTo("그 중 HIGH 만");
    // recentContext: 직전 2개(USER/ASSISTANT) 텍스트만, 현재 query 는 미포함.
    assertThat(sent.recentContext()).extracting("content")
        .containsExactly("내 담당 보여줘", "내 담당이에요");
  }
}
```

참고: `enabled=false` → `HomeComposeUnavailableException`(503) 경로는 클래스 레벨 `@TestPropertySource` 가 true 라 이 클래스에서 검증할 수 없다. 선택적으로 별도 테스트 클래스(프로퍼티 미설정 → 기본 false)에서 검증하라. 최소 요구는 위 2개 핵심 테스트 PASS.

- [ ] **Step 3: 실패 확인**

Run: `./gradlew :apps:workplace-api:test --tests "com.workplace.home.service.HomeComposeServiceTest"`
Expected: FAIL — `HomeComposeService` 미존재.

- [ ] **Step 4: 구현** — `HomeComposeService.java`:

```java
package com.workplace.home.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.home.dto.HomeComposeResponse;
import com.workplace.home.dto.HomeMessageResponse;
import com.workplace.home.exception.HomeComposeUnavailableException;
import com.workplace.home.outbound.AiAgentComposeClient;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import com.workplace.home.outbound.ComposeMessages.ContextMessage;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 홈 컴포즈 오케스트레이션 (7b): 세션 ensure → recentContext 구성 → USER 영속 → ai-agent 호출 →
 * ASSISTANT(위젯 포함) 영속 → 응답. 소유권은 HomeSessionService 가 강제.
 */
@Service
@RequiredArgsConstructor
public class HomeComposeService {

  /** follow-up 맥락으로 전달할 직전 메시지 최대 개수(토큰 폭주 방지). */
  private static final int CONTEXT_LIMIT = 6;

  private final HomeSessionService sessionService;
  private final AiAgentComposeClient composeClient;
  private final AiAgentProperties aiAgentProperties;
  private final ObjectMapper objectMapper;

  /** sessionId null 이면 새 세션 생성. callerId 소유 세션이 아니면 getMessages/appendMessage 가 404. */
  public HomeComposeResponse compose(long callerId, UUID sessionId, String query) {
    if (!aiAgentProperties.enabled()) {
      throw new HomeComposeUnavailableException("ai-agent 연동이 비활성화됨");
    }

    UUID sid = sessionId != null ? sessionId : sessionService.create(callerId).id();

    // 현재 query 를 적재하기 전, 기존 대화에서 최근 N개를 텍스트 전용 맥락으로.
    List<ContextMessage> recentContext = buildRecentContext(callerId, sid);

    sessionService.appendMessage(callerId, sid, "USER", query, null);

    ComposeResult result = composeClient.compose(new ComposeRequest(query, recentContext));

    String widgetsJson = serializeWidgets(result.widgets());
    sessionService.appendMessage(callerId, sid, "ASSISTANT", result.message(), widgetsJson);

    return new HomeComposeResponse(sid, result.message(), result.widgets());
  }

  /** 세션의 최근 메시지를 텍스트 전용(role+content)으로, 마지막 CONTEXT_LIMIT 개만. */
  private List<ContextMessage> buildRecentContext(long callerId, UUID sessionId) {
    List<HomeMessageResponse> all = sessionService.getMessages(callerId, sessionId);
    int from = Math.max(0, all.size() - CONTEXT_LIMIT);
    return all.subList(from, all.size()).stream()
        .map(m -> new ContextMessage(m.role(), m.content()))
        .toList();
  }

  /** 위젯 JsonNode → 영속용 JSON 문자열. null/누락이면 null(USER 메시지 컨벤션과 동일). */
  private String serializeWidgets(JsonNode widgets) {
    if (widgets == null || widgets.isNull()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(widgets);
    } catch (JsonProcessingException e) {
      // 위젯 직렬화 실패는 응답 자체를 막을 만큼 치명적이지 않음 — 위젯 없이 메시지만 보존.
      return null;
    }
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `./gradlew :apps:workplace-api:test --tests "com.workplace.home.service.HomeComposeServiceTest"`
Expected: PASS (핵심 2 테스트)

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/home/dto/HomeComposeResponse.java apps/workplace-api/src/main/java/com/workplace/home/exception/HomeComposeUnavailableException.java apps/workplace-api/src/main/java/com/workplace/home/service/HomeComposeService.java apps/workplace-api/src/test/java/com/workplace/home/service/HomeComposeServiceTest.java
git commit -m "feat(api): HomeComposeService — 세션 영속 + ai-agent 프록시 오케스트레이션 — #47"
```

---

### Task B3: `POST /api/v1/home/compose` 컨트롤러

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/home/dto/HomeComposeRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/home/controller/HomeComposeController.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/home/controller/HomeComposeControllerTest.java`

컨트롤러 테스트는 7a `HomeSessionControllerTest` 의 `@WebMvcTest` 보안 하네스를 그대로 사용한다(토큰 `"v"` → userId=1L 인증, `Authorization: Bearer v`). 서비스는 `@MockitoBean`.

- [ ] **Step 1: 요청 DTO 작성** — `HomeComposeRequest.java`:

```java
package com.workplace.home.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

/** compose 요청 본문. sessionId null 이면 서비스가 새 세션 생성. query 는 필수. */
public record HomeComposeRequest(UUID sessionId, @NotBlank String query) {}
```

- [ ] **Step 2: 컨트롤러 실패 테스트 작성** — `HomeComposeControllerTest.java`:

```java
package com.workplace.home.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.home.dto.HomeComposeResponse;
import com.workplace.home.service.HomeComposeService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** HomeComposeController @WebMvcTest — 보안 하네스는 HomeSessionControllerTest 와 동일. */
@SuppressWarnings("null")
@WebMvcTest(HomeComposeController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class HomeComposeControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @MockitoBean HomeComposeService composeService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  @Test
  void compose_정상_200() throws Exception {
    UUID sid = UUID.randomUUID();
    var widgets = om.readTree("[{\"type\":\"my_tasks\",\"params\":{}}]");
    when(composeService.compose(eq(1L), isNull(), eq("내 할 일")))
        .thenReturn(new HomeComposeResponse(sid, "할 일이에요", widgets));

    mockMvc
        .perform(
            post("/api/v1/home/compose")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"내 할 일\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.sessionId").value(sid.toString()))
        .andExpect(jsonPath("$.message").value("할 일이에요"))
        .andExpect(jsonPath("$.widgets[0].type").value("my_tasks"));
  }

  @Test
  void query_공백이면_400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/home/compose")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"\"}"))
        .andExpect(status().isBadRequest());
  }
}
```

- [ ] **Step 3: 실패 확인**

Run: `./gradlew :apps:workplace-api:test --tests "com.workplace.home.controller.HomeComposeControllerTest"`
Expected: FAIL — `HomeComposeController` 미존재.

- [ ] **Step 4: 구현** — `HomeComposeController.java`:

```java
package com.workplace.home.controller;

import com.workplace.home.dto.HomeComposeRequest;
import com.workplace.home.dto.HomeComposeResponse;
import com.workplace.home.service.HomeComposeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 홈 컴포즈 — 자연어 명령을 위젯 레이아웃 스펙으로 (7b). 인증 필요(본인 세션). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home/compose")
public class HomeComposeController {

  private final HomeComposeService composeService;

  /** sessionId 미지정 시 새 세션 생성. AI 실행 + user/assistant 메시지 영속 후 결과 반환. */
  @PostMapping
  public HomeComposeResponse compose(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody HomeComposeRequest request) {
    return composeService.compose(callerId, request.sessionId(), request.query());
  }
}
```

- [ ] **Step 5: 통과 확인 (관련 테스트 + 전체 컴파일)**

Run: `./gradlew :apps:workplace-api:test --tests "com.workplace.home.*"`
Expected: PASS (home 패키지 전체). ProjectConflictException 류 flake 발생 시 1회 재시도(메모리: api-gradle-projectkey-flake).

- [ ] **Step 6: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/home/dto/HomeComposeRequest.java apps/workplace-api/src/main/java/com/workplace/home/controller/HomeComposeController.java apps/workplace-api/src/test/java/com/workplace/home/controller/HomeComposeControllerTest.java
git commit -m "feat(api): POST /api/v1/home/compose 컨트롤러 — #47"
```

---

## 최종 검증 (모든 Task 완료 후)

- [ ] **ai-agent 전체**: `pnpm --filter workplace-ai-agent test && pnpm --filter workplace-ai-agent typecheck && pnpm --filter workplace-ai-agent lint`
- [ ] **workplace-api 전체**: `./gradlew :apps:workplace-api:test` (DB 기동 필요). spotless 위반 시 `./gradlew :apps:workplace-api:spotlessApply`.
- [ ] **계약 정합성 점검**: ai-agent 응답 `{message, widgets[]}` 의 키/형상이 `ComposeResult`(api) 와 일치하는지(특히 `widgets` 가 JSON 배열) 확인.
- [ ] 최종 코드 리뷰 서브에이전트 → `superpowers:finishing-a-development-branch`.

## 자기 검토 메모(스펙 대비)

- 스펙 §3 컴포즈 계약(`{sessionId,message,widgets}`) ↔ B3 응답 ✅ / §5 home 프로필 4도구 ↔ A1 ✅ / §7.4 follow-up(최근 N, 텍스트만) ↔ B2 `buildRecentContext`(N=6, role+content) ✅ / §1.1 차이3(Agent SDK 미도입, CLI stream-json) ↔ A3/A4 ✅ / 차이2(단일 응답, 스트리밍 제외) ↔ 동기 compose ✅.
- 7c(프론트)·7d(세션 UI)는 본 플랜 범위 밖. 본 플랜은 compose 엔진 + 영속까지.
- `widgets` 타입 일관성: ai-agent 파서는 `params:{}`/optional `layout` 의 객체 배열 생성 → api `ComposeResult.widgets`(JsonNode) 로 수신 → `home_message.widgets`(jsonb) 저장 → `HomeMessageResponse.widgets`(JsonNode) 로 복원. 전 구간 JSON 배열 형상 유지(7a widgetCount 의 `jsonb_array_length` 전제 충족).
