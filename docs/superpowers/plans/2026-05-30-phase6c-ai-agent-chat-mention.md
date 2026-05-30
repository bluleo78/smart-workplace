# Phase 6c: ai-agent chat @mention 응답 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chat 에서 `@AI` 멘션 시 ai-agent 가 쓰레드·이슈·코멘트·첨부(이미지/PDF 네이티브 Read)를 읽고 LLM 응답을 chat 메시지로 작성한다.

**Architecture:** 기존 이슈 이벤트 핸들러(`POST /events` → zod 검증 → fire-and-forget → `claude` CLI + MCP)를 미러링한 **chat 전용 경로**를 추가한다. chat 전용 MCP 프로필(get_issue_detail 읽기 + get_chat_thread + add_chat_message)과, 첨부를 per-run 임시폴더에 내려받아 CLI `cwd` 로 두고 native `Read` 를 그 폴더 한정 허용한다. workplace-api 는 "멘션된 AGENT 자동 thread 멤버화"만 추가하고, AI 응답의 실시간 노출은 6b SSE 가 처리한다.

**Tech Stack:** Node + Express + TypeScript + vitest, `@modelcontextprotocol/sdk`, `claude` CLI (subscription OAuth), Spring Boot + jOOQ + JUnit.

설계: `docs/superpowers/specs/2026-05-30-phase6c-ai-agent-chat-mention-design.md`

---

## File Structure

**ai-agent (apps/workplace-ai-agent), `src`:**
- `types/chat-events.ts` — 신규: `chat.message.posted` zod 스키마
- `routes/events.ts` — 수정: chat 타입 분기
- `agent/chat-event-handler.ts` — 신규: self-loop 가드 + fire-and-forget
- `agent/chat-agent-resolver.ts` — 신규: mentions 중 첫 AGENT
- `clients/workplace-api.ts` — 수정: chat + attachment client 메서드
- `mcp/tools.ts` — 수정: profile 별 도구셋 (issue / chat)
- `mcp/workplace-mcp-server.ts` — 수정: `WORKPLACE_MCP_PROFILE` 읽기
- `agent/mcp-config.ts` — 수정: profile 옵션
- `agent/cli-runner.ts` — 수정: `allowFileRead` 옵션 + `cwd` 옵션
- `agent/chat-user-message.ts` — 신규: chat 프롬프트 빌더
- `agent/chat-system-prompt.ts` — 신규: chat 시스템 프롬프트
- `agent/attachment-prep.ts` — 신규: 첨부 다운로드 + 용량가드 + manifest
- `agent/run-chat-agent.ts` — 신규: 오케스트레이션

**workplace-api (apps/workplace-api):**
- `chat/service/ChatMessageService.java` — 수정: 멘션된 AGENT 자동 멤버화

ai-agent 테스트 실행: `cd apps/workplace-ai-agent && npx vitest run <file>`
workplace-api 테스트 실행: `cd apps/workplace-api && ./gradlew test --tests <FQCN>`

---

# Part A — ai-agent (workplace-ai-agent)

작업 디렉터리: `apps/workplace-ai-agent`.

### Task A1: chat.message.posted 이벤트 스키마 + 라우트 분기

**Files:**
- Create: `src/types/chat-events.ts`
- Modify: `src/routes/events.ts`
- Test: `src/routes/events.test.ts`

- [ ] **Step 1: 스키마 작성** — `src/types/chat-events.ts`:

```typescript
// 6c: workplace-api 가 발사하는 chat.message.posted 이벤트 envelope 의 zod 스키마.
import { z } from 'zod';

const userSummary = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string().nullable().optional(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

export const chatMessagePostedPayload = z.object({
  projectKey: z.string(),
  issueKey: z.string(),
  issueId: z.number(),
  threadId: z.number(),
  messageId: z.number(),
  actor: userSummary,
  body: z.string(),
  mentions: z.array(userSummary),
  occurredAt: z.string(),
});

export const chatEventEnvelope = z.object({
  type: z.literal('chat.message.posted'),
  payload: chatMessagePostedPayload,
});

export type ChatMessagePostedPayload = z.infer<typeof chatMessagePostedPayload>;
export type ChatEventEnvelope = z.infer<typeof chatEventEnvelope>;

export const CHAT_MESSAGE_POSTED = 'chat.message.posted';
```

- [ ] **Step 2: 실패 테스트 추가** — `src/routes/events.test.ts` 에 추가. 기존 fixture 패턴(`AUTH` 헤더, supertest `app`)을 따른다. 먼저 파일을 읽어 기존 `app`/`AUTH`/mock 구성을 확인하고 아래를 추가:

```typescript
  it('valid chat.message.posted → 202 + handleChatEvent 호출', async () => {
    const payload = {
      projectKey: 'WP', issueKey: 'WP-1', issueId: 1, threadId: 5, messageId: 9,
      actor: { id: 7, username: 'alice', name: 'Alice', kind: 'HUMAN' },
      body: '@AI 요약해줘',
      mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
      occurredAt: '2026-05-30T12:00:00Z',
    };
    const res = await request(app)
      .post('/events').set('Authorization', AUTH)
      .send({ type: 'chat.message.posted', payload });
    expect(res.status).toBe(202);
    expect(handleChatEvent).toHaveBeenCalledOnce();
  });

  it('chat.message.posted 잘못된 payload → 400 invalid_payload', async () => {
    const res = await request(app)
      .post('/events').set('Authorization', AUTH)
      .send({ type: 'chat.message.posted', payload: { threadId: 'nope' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
```

테스트 상단에 `handleChatEvent` mock 추가 (기존 `handleEvent` mock 패턴과 동일):
```typescript
vi.mock('../agent/chat-event-handler.js', () => ({ handleChatEvent: vi.fn() }));
import { handleChatEvent } from '../agent/chat-event-handler.js';
```

- [ ] **Step 3: 실패 확인** — `npx vitest run src/routes/events.test.ts` → FAIL (chat-event-handler 없음 / 라우트 미분기).

- [ ] **Step 4: 라우트 분기 구현** — `src/routes/events.ts` 를 수정. import 추가:
```typescript
import { handleChatEvent } from '../agent/chat-event-handler.js';
import { chatEventEnvelope, CHAT_MESSAGE_POSTED } from '../types/chat-events.js';
```
`const { type } = envelope.data;` 직후, 기존 issue 처리 위에 분기 추가:
```typescript
    if (type === CHAT_MESSAGE_POSTED) {
      const chat = chatEventEnvelope.safeParse(req.body);
      if (!chat.success) {
        res.status(400).json({ error: 'invalid_payload', issues: chat.error.issues });
        return;
      }
      handleChatEvent(chat.data, deps);
      res.status(202).json({ received: true });
      return;
    }
```

- [ ] **Step 5: 핸들러 stub** — A2 전까지 컴파일되도록 `src/agent/chat-event-handler.ts` 최소 stub 생성(실구현은 A2):
```typescript
import type { EventHandlerDeps } from './event-handler.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';
export function handleChatEvent(_env: ChatEventEnvelope, _deps: EventHandlerDeps): void {}
```

- [ ] **Step 6: 통과 확인** — `npx vitest run src/routes/events.test.ts` → PASS.

- [ ] **Step 7: 커밋**
```bash
git add apps/workplace-ai-agent/src/types/chat-events.ts apps/workplace-ai-agent/src/routes/events.ts apps/workplace-ai-agent/src/routes/events.test.ts apps/workplace-ai-agent/src/agent/chat-event-handler.ts
git commit -m "feat(ai-agent): chat.message.posted 이벤트 스키마 + 라우트 분기 — #38"
```

---

### Task A2: chat 이벤트 핸들러 (self-loop 가드 + fire-and-forget)

**Files:**
- Modify: `src/agent/chat-event-handler.ts`
- Test: `src/agent/chat-event-handler.test.ts` (신규)

- [ ] **Step 1: 실패 테스트** — `src/agent/chat-event-handler.test.ts` (기존 `event-handler.test.ts` 패턴):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./run-chat-agent.js', () => ({ runChatAgent: vi.fn() }));
import { runChatAgent } from './run-chat-agent.js';
import { handleChatEvent } from './chat-event-handler.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';

const base = {
  projectKey: 'WP', issueKey: 'WP-1', issueId: 1, threadId: 5, messageId: 9,
  body: '@AI', mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' as const }],
  occurredAt: '2026-05-30T12:00:00Z',
};
const env = (actorKind: 'HUMAN' | 'AGENT'): ChatEventEnvelope => ({
  type: 'chat.message.posted',
  payload: { ...base, actor: { id: 7, username: 'a', name: 'A', kind: actorKind } },
});

describe('handleChatEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('HUMAN actor → runChatAgent 호출', () => {
    handleChatEvent(env('HUMAN'), { client: {} as never });
    expect(runChatAgent).toHaveBeenCalledOnce();
  });

  it('AGENT actor → self-loop skip', () => {
    handleChatEvent(env('AGENT'), { client: {} as never });
    expect(runChatAgent).not.toHaveBeenCalled();
  });

  it('runChatAgent reject → throw 안함', () => {
    vi.mocked(runChatAgent).mockRejectedValueOnce(new Error('boom'));
    expect(() => handleChatEvent(env('HUMAN'), { client: {} as never })).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/agent/chat-event-handler.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/agent/chat-event-handler.ts` 교체:
```typescript
// 6c: chat.message.posted → runChatAgent fire-and-forget. self-loop 가드.
import { runChatAgent } from './run-chat-agent.js';
import type { EventHandlerDeps } from './event-handler.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';

export function handleChatEvent(env: ChatEventEnvelope, deps: EventHandlerDeps): void {
  // AGENT 가 작성한 메시지엔 응답하지 않음 (self-loop 차단). workplace-api 도 거르지만 이중.
  if (env.payload.actor.kind === 'AGENT') return;
  runChatAgent(env, deps).catch((e) => {
    console.error('[chat-event-handler] runChatAgent 실패', {
      threadId: env.payload.threadId,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
}
```

- [ ] **Step 4: run-chat-agent stub** — A12 전까지 컴파일되게 `src/agent/run-chat-agent.ts` 최소 stub:
```typescript
import type { RunAgentDeps } from './run-agent.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';
export async function runChatAgent(_env: ChatEventEnvelope, _deps: RunAgentDeps): Promise<void> {}
```

- [ ] **Step 5: 통과 확인** — `npx vitest run src/agent/chat-event-handler.test.ts` → PASS.

- [ ] **Step 6: 커밋**
```bash
git add apps/workplace-ai-agent/src/agent/chat-event-handler.ts apps/workplace-ai-agent/src/agent/chat-event-handler.test.ts apps/workplace-ai-agent/src/agent/run-chat-agent.ts
git commit -m "feat(ai-agent): chat 이벤트 핸들러 self-loop 가드 + fire-and-forget — #38"
```

---

### Task A3: chat agent 리졸버 (mentions 중 첫 AGENT)

**Files:**
- Create: `src/agent/chat-agent-resolver.ts`
- Test: `src/agent/chat-agent-resolver.test.ts`

- [ ] **Step 1: 실패 테스트** — `src/agent/chat-agent-resolver.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { pickMentionedAgentId } from './chat-agent-resolver.js';
import type { ChatMessagePostedPayload } from '../types/chat-events.js';

const payload = (mentions: ChatMessagePostedPayload['mentions']): ChatMessagePostedPayload => ({
  projectKey: 'WP', issueKey: 'WP-1', issueId: 1, threadId: 5, messageId: 9,
  actor: { id: 7, username: 'a', name: 'A', kind: 'HUMAN' },
  body: '@AI', mentions, occurredAt: '2026-05-30T12:00:00Z',
});

describe('pickMentionedAgentId', () => {
  it('mentions 중 첫 AGENT id', () => {
    expect(pickMentionedAgentId(payload([
      { id: 7, username: 'a', name: 'A', kind: 'HUMAN' },
      { id: 99, username: 'ai', name: 'AI', kind: 'AGENT' },
    ]))).toBe(99);
  });
  it('AGENT 없으면 null', () => {
    expect(pickMentionedAgentId(payload([
      { id: 7, username: 'a', name: 'A', kind: 'HUMAN' },
    ]))).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/agent/chat-agent-resolver.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/agent/chat-agent-resolver.ts`:
```typescript
// 6c: chat 메시지의 mentions 에서 대행할 AGENT 1명 선택 (다중 AGENT 는 비목표 — 첫 번째).
import type { ChatMessagePostedPayload } from '../types/chat-events.js';

export function pickMentionedAgentId(payload: ChatMessagePostedPayload): number | null {
  const agents = payload.mentions.filter((u) => u.kind === 'AGENT');
  return agents.length > 0 ? agents[0].id : null;
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/agent/chat-agent-resolver.test.ts` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-ai-agent/src/agent/chat-agent-resolver.ts apps/workplace-ai-agent/src/agent/chat-agent-resolver.test.ts
git commit -m "feat(ai-agent): chat mentions AGENT 리졸버 — #38"
```

---

### Task A4: client — chat 메시지 read/write 메서드

**Files:**
- Modify: `src/clients/workplace-api.ts`
- Test: `src/clients/workplace-api.test.ts`

- [ ] **Step 1: 실패 테스트** — `src/clients/workplace-api.test.ts` 에 추가. 기존 테스트가 axios 를 어떻게 mock 하는지 먼저 읽고 그 패턴에 맞춘다(`vi.mock('axios')` 또는 `axios-mock-adapter`). 추가 테스트:
```typescript
  it('getChatMessages → GET /chat/threads/{id}/messages?limit=, X-On-Behalf-Of', async () => {
    // mock GET 응답: { items: [{id:1, authorName:'A', authorKind:'HUMAN', body:'hi', createdAt:'t'}], nextCursor:null, hasMore:false }
    const items = await client.getChatMessages(99, 5, 20);
    expect(items[0].body).toBe('hi');
    // 요청 검증: URL 에 /chat/threads/5/messages, headers['X-On-Behalf-Of']==='99'
  });

  it('addChatMessage → POST /chat/threads/{id}/messages {body}', async () => {
    await client.addChatMessage(99, 5, '답변');
    // 요청 검증: POST /chat/threads/5/messages, body.body==='답변', X-On-Behalf-Of '99'
  });
```
> 어서션의 구체 형태는 기존 테스트의 mock 검증 스타일(예: `mock.history.post[0]`)에 맞춰 작성한다.

- [ ] **Step 2: 실패 확인** — `npx vitest run src/clients/workplace-api.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/clients/workplace-api.ts`. 인터페이스에 추가:
```typescript
  getChatMessages(agentId: number, threadId: number, limit: number): Promise<ChatMessageItem[]>;
  addChatMessage(agentId: number, threadId: number, body: string): Promise<void>;
```
파일 상단(IssueDetail import 근처)에 타입 추가:
```typescript
export interface ChatMessageItem {
  id: number;
  authorName: string;
  authorKind: 'HUMAN' | 'AGENT';
  body: string;
  createdAt: string;
  deleted: boolean;
}
```
`createWorkplaceApiClient` 의 return 객체에 메서드 추가(getOAuthToken 위):
```typescript
    async getChatMessages(agentId, threadId, limit) {
      const r = await http.get(
        `/chat/threads/${threadId}/messages?limit=${limit}`,
        onBehalfOf(agentId),
      );
      const items: ChatMessageItem[] = Array.isArray(r.data?.items) ? r.data.items : [];
      return items;
    },

    async addChatMessage(agentId, threadId, body) {
      await http.post(`/chat/threads/${threadId}/messages`, { body }, onBehalfOf(agentId));
    },
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/clients/workplace-api.test.ts` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-ai-agent/src/clients/workplace-api.ts apps/workplace-ai-agent/src/clients/workplace-api.test.ts
git commit -m "feat(ai-agent): chat 메시지 read/write client 메서드 — #38"
```

---

### Task A5: client — 이슈 첨부 list/download 메서드

**Files:**
- Modify: `src/clients/workplace-api.ts`
- Test: `src/clients/workplace-api.test.ts`

- [ ] **Step 1: 실패 테스트** — `workplace-api.test.ts` 에 추가:
```typescript
  it('listIssueAttachments → GET /projects/{key}/issues/{n}/attachments', async () => {
    // mock 응답: [{ fileId: 3, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 100 }]
    const list = await client.listIssueAttachments(99, 'WP-1');
    expect(list[0]).toMatchObject({ fileId: 3, originalName: 'a.png', mimeType: 'image/png' });
  });

  it('downloadIssueAttachment → GET .../attachments/{fileId}/content (arraybuffer)', async () => {
    // mock 응답: arraybuffer Buffer.from('PNGDATA'), content-type image/png
    const res = await client.downloadIssueAttachment(99, 'WP-1', 3);
    expect(Buffer.isBuffer(res.data)).toBe(true);
    expect(res.mimeType).toBe('image/png');
  });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/clients/workplace-api.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/clients/workplace-api.ts`. 인터페이스에 추가:
```typescript
  listIssueAttachments(agentId: number, issueKey: string): Promise<AttachmentMeta[]>;
  downloadIssueAttachment(
    agentId: number, issueKey: string, fileId: number,
  ): Promise<{ data: Buffer; mimeType: string }>;
```
타입 추가:
```typescript
export interface AttachmentMeta {
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}
```
return 객체에 메서드 추가:
```typescript
    async listIssueAttachments(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/attachments`,
        onBehalfOf(agentId),
      );
      const list: AttachmentMeta[] = Array.isArray(r.data) ? r.data : [];
      return list;
    },

    async downloadIssueAttachment(agentId, issueKey, fileId) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/attachments/${fileId}/content`,
        { ...onBehalfOf(agentId), responseType: 'arraybuffer' },
      );
      const mimeType = String(r.headers['content-type'] ?? 'application/octet-stream');
      return { data: Buffer.from(r.data as ArrayBuffer), mimeType };
    },
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/clients/workplace-api.test.ts` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-ai-agent/src/clients/workplace-api.ts apps/workplace-ai-agent/src/clients/workplace-api.test.ts
git commit -m "feat(ai-agent): 이슈 첨부 list/download client 메서드 — #38"
```

---

### Task A6: MCP 도구 프로필 (issue / chat) + chat 도구

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/workplace-mcp-server.ts`
- Test: `src/mcp/tools.test.ts`

chat 프로필은 **읽기 get_issue_detail + get_chat_thread + 쓰기 add_chat_message** 만 노출한다(이슈 상태/코멘트 변경 도구는 chat 에서 제외 — Out of scope).

- [ ] **Step 1: 실패 테스트** — `src/mcp/tools.test.ts` 에 추가. 기존 테스트가 `buildTools(client, agentId)` 를 어떻게 부르는지 확인 후, profile 인자 형태로 확장:
```typescript
  it('chat 프로필: get_issue_detail, get_chat_thread, add_chat_message 만', () => {
    const names = buildTools(fakeClient, 99, 'chat').map((t) => t.name).sort();
    expect(names).toEqual(['add_chat_message', 'get_chat_thread', 'get_issue_detail']);
  });

  it('issue 프로필(기본): 기존 4개 그대로', () => {
    const names = buildTools(fakeClient, 99, 'issue').map((t) => t.name).sort();
    expect(names).toEqual(['add_comment', 'get_issue_detail', 'unassign_self', 'update_status']);
  });

  it('add_chat_message handler → client.addChatMessage(agentId, threadId, body)', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    const tools = buildTools({ ...fakeClient, addChatMessage: spy } as never, 99, 'chat');
    const tool = tools.find((t) => t.name === 'add_chat_message')!;
    await tool.handler({ threadId: 5, body: '답변' });
    expect(spy).toHaveBeenCalledWith(99, 5, '답변');
  });

  it('get_chat_thread handler → client.getChatMessages(agentId, threadId, 50)', async () => {
    const spy = vi.fn().mockResolvedValue([{ id: 1, authorName: 'A', authorKind: 'HUMAN', body: 'hi', createdAt: 't', deleted: false }]);
    const tools = buildTools({ ...fakeClient, getChatMessages: spy } as never, 99, 'chat');
    const tool = tools.find((t) => t.name === 'get_chat_thread')!;
    const out = await tool.handler({ threadId: 5 });
    expect(spy).toHaveBeenCalledWith(99, 5, 50);
    expect(out).toContain('hi');
  });
```
> 기존 issue 프로필 테스트가 `buildTools(client, agentId)` 2-인자로 호출 중이면, 그 호출들을 `buildTools(client, agentId, 'issue')` 로 갱신하거나 profile 기본값을 'issue' 로 둬서 깨지지 않게 한다(아래 구현은 기본값 'issue').

- [ ] **Step 2: 실패 확인** — `npx vitest run src/mcp/tools.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/mcp/tools.ts`. `buildTools` 시그니처를 profile 추가로 변경하고 chat 도구를 정의:
```typescript
const addChatMessageInput = z.object({
  threadId: z.number().int().positive(),
  body: z.string().min(1),
});
const getChatThreadInput = z.object({
  threadId: z.number().int().positive(),
});

export type McpProfile = 'issue' | 'chat';

export function buildTools(
  client: WorkplaceApiClient,
  agentId: number,
  profile: McpProfile = 'issue',
): McpTool[] {
  const getIssueDetailTool: McpTool = {
    name: 'get_issue_detail',
    description: '이슈의 본문·상태·담당자·코멘트 등 전체 컨텍스트를 JSON 으로 반환합니다.',
    inputSchema: issueKey,
    async handler(args) {
      const { issueKey: k } = issueKey.parse(args);
      return JSON.stringify(await client.getIssueDetail(agentId, k));
    },
  };

  if (profile === 'chat') {
    return [
      getIssueDetailTool,
      {
        name: 'get_chat_thread',
        description: '현재 chat thread 의 최근 메시지 목록을 JSON 으로 반환합니다(과거 흐름 확인용).',
        inputSchema: getChatThreadInput,
        async handler(args) {
          const { threadId } = getChatThreadInput.parse(args);
          return JSON.stringify(await client.getChatMessages(agentId, threadId, 50));
        },
      },
      {
        name: 'add_chat_message',
        description: 'chat thread 에 답변 메시지를 작성합니다. 본문은 마크다운 지원. 정확히 한 번만 호출하세요.',
        inputSchema: addChatMessageInput,
        async handler(args) {
          const { threadId, body } = addChatMessageInput.parse(args);
          await client.addChatMessage(agentId, threadId, body);
          return 'ok';
        },
      },
    ];
  }

  // profile === 'issue' — 기존 4개 도구 (get_issue_detail + 쓰기 3개)
  return [
    getIssueDetailTool,
    {
      name: 'add_comment',
      description: '이슈에 코멘트를 작성합니다. 본문은 마크다운을 지원합니다.',
      inputSchema: addCommentInput,
      async handler(args) {
        const { issueKey: k, body } = addCommentInput.parse(args);
        await client.addIssueComment(agentId, k, body);
        return 'ok';
      },
    },
    {
      name: 'update_status',
      description: '이슈의 상태를 변경합니다. 허용값: TODO / IN_PROGRESS / DONE / CANCELED.',
      inputSchema: updateStatusInput,
      async handler(args) {
        const { issueKey: k, status } = updateStatusInput.parse(args);
        await client.updateIssueStatus(agentId, k, status);
        return 'ok';
      },
    },
    {
      name: 'unassign_self',
      description: '자기 자신을 이슈 담당자에서 제외합니다. 작업 완료·반려 시 사용합니다.',
      inputSchema: issueKey,
      async handler(args) {
        const { issueKey: k } = issueKey.parse(args);
        await client.unassignSelf(agentId, k);
        return 'ok';
      },
    },
  ];
}
```

- [ ] **Step 4: 서버에서 profile 읽기** — `src/mcp/workplace-mcp-server.ts` 에서 `const tools = buildTools(client, actingAgentId);` 를 다음으로 교체:
```typescript
  const profile = process.env.WORKPLACE_MCP_PROFILE === 'chat' ? 'chat' : 'issue';
  const tools = buildTools(client, actingAgentId, profile);
```

- [ ] **Step 5: 통과 확인** — `npx vitest run src/mcp/tools.test.ts` → PASS.

- [ ] **Step 6: 커밋**
```bash
git add apps/workplace-ai-agent/src/mcp/tools.ts apps/workplace-ai-agent/src/mcp/workplace-mcp-server.ts apps/workplace-ai-agent/src/mcp/tools.test.ts
git commit -m "feat(ai-agent): MCP 프로필(issue/chat) + chat get_chat_thread/add_chat_message 도구 — #38"
```

---

### Task A7: mcp-config profile 옵션

**Files:**
- Modify: `src/agent/mcp-config.ts`
- Test: `src/agent/mcp-config.test.ts` (없으면 생성)

- [ ] **Step 1: 실패 테스트** — `src/agent/mcp-config.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';

describe('writeTempMcpConfig profile', () => {
  let p = '';
  afterEach(() => { if (p) cleanupTempMcpConfig(p); });

  it('profile=chat → env.WORKPLACE_MCP_PROFILE=chat', () => {
    p = writeTempMcpConfig({ agentId: 99, baseURL: 'http://x', internalToken: 't', profile: 'chat' });
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.mcpServers.workplace.env.WORKPLACE_MCP_PROFILE).toBe('chat');
  });

  it('profile 생략 → issue 기본', () => {
    p = writeTempMcpConfig({ agentId: 99, baseURL: 'http://x', internalToken: 't' });
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.mcpServers.workplace.env.WORKPLACE_MCP_PROFILE).toBe('issue');
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/agent/mcp-config.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/agent/mcp-config.ts` 의 `writeTempMcpConfig` opts 타입에 `profile?: 'issue' | 'chat'` 추가, env 에 주입:
```typescript
export function writeTempMcpConfig(opts: {
  agentId: number;
  baseURL: string;
  internalToken: string;
  profile?: 'issue' | 'chat';
}): string {
  const config = {
    mcpServers: {
      workplace: {
        command: 'node',
        args: [MCP_SERVER_JS],
        env: {
          WORKPLACE_API_BASE_URL: opts.baseURL,
          INTERNAL_SERVICE_TOKEN: opts.internalToken,
          ACTING_AGENT_ID: String(opts.agentId),
          WORKPLACE_MCP_PROFILE: opts.profile ?? 'issue',
        },
      },
    },
  };
  const p = path.join(tmpdir(), `workplace-mcp-config-${randomUUID()}.json`);
  writeFileSync(p, JSON.stringify(config), 'utf8');
  return p;
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/agent/mcp-config.test.ts` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-ai-agent/src/agent/mcp-config.ts apps/workplace-ai-agent/src/agent/mcp-config.test.ts
git commit -m "feat(ai-agent): mcp-config profile 옵션 — #38"
```

---

### Task A8: cli-runner — Read 허용 옵션 + cwd 옵션

**Files:**
- Modify: `src/agent/cli-runner.ts`
- Test: `src/agent/cli-runner.test.ts`

- [ ] **Step 1: 실패 테스트** — `src/agent/cli-runner.test.ts` 에 추가:
```typescript
  it('allowFileRead=true → allowed-tools 에 Read 포함, disallowed 에서 Read 제외', () => {
    const args = buildCliArgs({
      userMessage: 'm', systemPrompt: 's', model: 'x', maxTurns: 5,
      mcpConfigPath: '/tmp/c.json', allowFileRead: true,
    });
    const allowed = args[args.indexOf('--allowed-tools') + 1];
    const disallowed = args[args.indexOf('--disallowed-tools') + 1];
    expect(allowed).toContain('Read');
    expect(allowed).toContain('mcp__workplace__*');
    expect(disallowed.split(',')).not.toContain('Read');
  });

  it('allowFileRead 생략 → 기존대로 Read 차단', () => {
    const args = buildCliArgs({
      userMessage: 'm', systemPrompt: 's', model: 'x', maxTurns: 5, mcpConfigPath: '/tmp/c.json',
    });
    const allowed = args[args.indexOf('--allowed-tools') + 1];
    const disallowed = args[args.indexOf('--disallowed-tools') + 1];
    expect(allowed).toBe('mcp__workplace__*');
    expect(disallowed.split(',')).toContain('Read');
  });
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/agent/cli-runner.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/agent/cli-runner.ts`. `CliArgsInput` 에 `allowFileRead?: boolean` 추가, `buildCliArgs` 를 수정:
```typescript
export interface CliArgsInput {
  userMessage: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  mcpConfigPath: string;
  allowFileRead?: boolean;
}

const BASE_DISALLOWED = [
  'Bash', 'BashOutput', 'KillShell',
  'Read', 'Write', 'Edit', 'NotebookEdit',
  'Glob', 'Grep',
  'WebFetch', 'WebSearch',
  'Task', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TaskUpdate',
  'TodoWrite',
  'Skill', 'ToolSearch', 'SlashCommand',
  'AskUserQuestion', 'SendUserFile', 'ScheduleWakeup', 'ShareOnboardingGuide',
  'Monitor', 'LSP',
];

export function buildCliArgs(i: CliArgsInput): string[] {
  const allowedTools = i.allowFileRead ? 'mcp__workplace__*,Read' : 'mcp__workplace__*';
  const disallowed = i.allowFileRead
    ? BASE_DISALLOWED.filter((t) => t !== 'Read')
    : BASE_DISALLOWED;
  return [
    '--print', i.userMessage,
    '--system-prompt', i.systemPrompt,
    '--model', i.model,
    '--max-turns', String(i.maxTurns),
    '--allowed-tools', allowedTools,
    '--disallowed-tools', disallowed.join(','),
    '--mcp-config', i.mcpConfigPath,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--dangerously-skip-permissions',
  ];
}
```
`RunCliInput` 에 `cwd?: string` 추가하고 spawn 에 사용:
```typescript
export interface RunCliInput {
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  logTag: string;
  cwd?: string;
}
```
`runClaudeCli` 의 spawn 라인 `cwd: os.tmpdir(),` 를 `cwd: i.cwd ?? os.tmpdir(),` 로 교체.

- [ ] **Step 4: 통과 확인** — `npx vitest run src/agent/cli-runner.test.ts` → PASS (기존 테스트 포함).

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-ai-agent/src/agent/cli-runner.ts apps/workplace-ai-agent/src/agent/cli-runner.test.ts
git commit -m "feat(ai-agent): cli-runner Read 허용 + cwd 옵션 — #38"
```

---

### Task A9: 첨부 준비 (다운로드 + 용량가드 + manifest)

**Files:**
- Create: `src/agent/attachment-prep.ts`
- Test: `src/agent/attachment-prep.test.ts`

용량 상수: 파일당 최대 10MB, 합계 최대 30MB 초과분은 skip.

- [ ] **Step 1: 실패 테스트** — `src/agent/attachment-prep.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareAttachments } from './attachment-prep.js';

describe('prepareAttachments', () => {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'att-test-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const client = {
    listIssueAttachments: vi.fn(),
    downloadIssueAttachment: vi.fn(),
  } as never;

  it('첨부 다운로드 → 파일 기록 + manifest', async () => {
    (client.listIssueAttachments as any).mockResolvedValue([
      { fileId: 3, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 5 },
    ]);
    (client.downloadIssueAttachment as any).mockResolvedValue({ data: Buffer.from('PNGAB'), mimeType: 'image/png' });

    const manifest = await prepareAttachments(client, 99, 'WP-1', dir);

    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({ originalName: 'a.png', skipped: false });
    expect(existsSync(manifest[0].localPath!)).toBe(true);
    expect(readFileSync(manifest[0].localPath!, 'utf8')).toBe('PNGAB');
  });

  it('파일당 상한 초과 → skip', async () => {
    (client.listIssueAttachments as any).mockResolvedValue([
      { fileId: 4, originalName: 'big.bin', mimeType: 'application/octet-stream', sizeBytes: 11 * 1024 * 1024 },
    ]);
    const manifest = await prepareAttachments(client, 99, 'WP-1', dir);
    expect(manifest[0].skipped).toBe(true);
    expect(client.downloadIssueAttachment).not.toHaveBeenCalled();
  });

  it('첨부 없음 → 빈 manifest', async () => {
    (client.listIssueAttachments as any).mockResolvedValue([]);
    expect(await prepareAttachments(client, 99, 'WP-1', dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/agent/attachment-prep.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/agent/attachment-prep.ts`:
```typescript
// 6c: 이슈 첨부를 per-run 임시폴더로 다운로드. 용량 가드 + manifest 반환.
// 모델은 이 manifest 의 localPath 를 Read 로 직접 읽는다(이미지/PDF/텍스트 네이티브).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 파일당 10MB
const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 합계 30MB

export interface AttachmentManifestEntry {
  fileId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  skipped: boolean;
  skipReason?: string;
  localPath?: string;
}

// 안전한 파일명 — 경로 분리자/상위 이동 제거.
function safeName(name: string): string {
  return path.basename(name).replace(/[^\w.\-가-힣 ]+/g, '_');
}

export async function prepareAttachments(
  client: WorkplaceApiClient,
  agentId: number,
  issueKey: string,
  destDir: string,
): Promise<AttachmentManifestEntry[]> {
  const list = await client.listIssueAttachments(agentId, issueKey);
  const manifest: AttachmentManifestEntry[] = [];
  let total = 0;

  for (const a of list) {
    const base: AttachmentManifestEntry = {
      fileId: a.fileId,
      originalName: a.originalName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      skipped: false,
    };
    if (a.sizeBytes > MAX_FILE_BYTES) {
      manifest.push({ ...base, skipped: true, skipReason: '파일당 상한(10MB) 초과' });
      continue;
    }
    if (total + a.sizeBytes > MAX_TOTAL_BYTES) {
      manifest.push({ ...base, skipped: true, skipReason: '합계 상한(30MB) 초과' });
      continue;
    }
    try {
      const { data } = await client.downloadIssueAttachment(agentId, issueKey, a.fileId);
      const localPath = path.join(destDir, `${a.fileId}-${safeName(a.originalName)}`);
      writeFileSync(localPath, data);
      total += a.sizeBytes;
      manifest.push({ ...base, localPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      manifest.push({ ...base, skipped: true, skipReason: `다운로드 실패: ${msg}` });
    }
  }
  return manifest;
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/agent/attachment-prep.test.ts` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-ai-agent/src/agent/attachment-prep.ts apps/workplace-ai-agent/src/agent/attachment-prep.test.ts
git commit -m "feat(ai-agent): 첨부 다운로드 + 용량가드 + manifest — #38"
```

---

### Task A10: chat user message 빌더

**Files:**
- Create: `src/agent/chat-user-message.ts`
- Test: `src/agent/chat-user-message.test.ts`

- [ ] **Step 1: 실패 테스트** — `src/agent/chat-user-message.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildChatUserMessage } from './chat-user-message.js';
import type { ChatMessagePostedPayload } from '../types/chat-events.js';
import type { ChatMessageItem } from '../clients/workplace-api.js';
import type { AttachmentManifestEntry } from './attachment-prep.js';

const payload: ChatMessagePostedPayload = {
  projectKey: 'WP', issueKey: 'WP-1', issueId: 1, threadId: 5, messageId: 9,
  actor: { id: 7, username: 'alice', name: 'Alice', kind: 'HUMAN' },
  body: '@AI 첨부 요약해줘',
  mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
  occurredAt: '2026-05-30T12:00:00Z',
};
const recent: ChatMessageItem[] = [
  { id: 8, authorName: 'Alice', authorKind: 'HUMAN', body: '이전 메시지', createdAt: 't', deleted: false },
];

describe('buildChatUserMessage', () => {
  it('trigger·thread·이슈키·threadId 포함', () => {
    const msg = buildChatUserMessage(payload, recent, []);
    expect(msg).toContain('WP-1');
    expect(msg).toContain('첨부 요약해줘');
    expect(msg).toContain('이전 메시지');
    expect(msg).toContain('5'); // threadId
  });
  it('첨부 manifest 의 localPath·skip 사유 표기', () => {
    const att: AttachmentManifestEntry[] = [
      { fileId: 3, originalName: 'a.png', mimeType: 'image/png', sizeBytes: 5, skipped: false, localPath: '/tmp/x/3-a.png' },
      { fileId: 4, originalName: 'big.bin', mimeType: 'application/octet-stream', sizeBytes: 99, skipped: true, skipReason: '상한 초과' },
    ];
    const msg = buildChatUserMessage(payload, recent, att);
    expect(msg).toContain('/tmp/x/3-a.png');
    expect(msg).toContain('a.png');
    expect(msg).toContain('상한 초과');
  });
  it('첨부 없음 → 첨부 섹션에 없음 표기', () => {
    expect(buildChatUserMessage(payload, recent, [])).toContain('첨부 없음');
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/agent/chat-user-message.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/agent/chat-user-message.ts`:
```typescript
// 6c: chat.message.posted → Claude CLI user message. trigger + thread 흐름 + 첨부 manifest.
import type { ChatMessagePostedPayload } from '../types/chat-events.js';
import type { ChatMessageItem } from '../clients/workplace-api.js';
import type { AttachmentManifestEntry } from './attachment-prep.js';

export function buildChatUserMessage(
  payload: ChatMessagePostedPayload,
  recentMessages: ChatMessageItem[],
  attachments: AttachmentManifestEntry[],
): string {
  // 오래된→최신 순으로 노출 (목록은 보통 최신 DESC 로 오므로 역순 정렬).
  const ordered = [...recentMessages].sort((a, b) => a.id - b.id);
  const thread = ordered
    .map((m) => `- [${m.authorName}${m.authorKind === 'AGENT' ? '/AI' : ''}] ${m.deleted ? '(삭제됨)' : m.body}`)
    .join('\n');

  const attachmentSection =
    attachments.length === 0
      ? '첨부 없음'
      : attachments
          .map((a) =>
            a.skipped
              ? `- ${a.originalName} (${a.mimeType}, ${a.sizeBytes}B) — 건너뜀: ${a.skipReason}`
              : `- ${a.originalName} (${a.mimeType}, ${a.sizeBytes}B) → 로컬경로: ${a.localPath}`,
          )
          .join('\n');

  return (
    `[이벤트: chat.message.posted]\n` +
    `이슈 ${payload.issueKey} 의 chat thread(threadId=${payload.threadId})에서 당신(@${'AI'})이 멘션됐습니다.\n` +
    `멘션한 사람: @${payload.actor.username}\n` +
    `멘션 메시지: "${payload.body}"\n\n` +
    `## 최근 thread 흐름 (오래된→최신)\n${thread || '(이전 메시지 없음)'}\n\n` +
    `## 이슈 첨부파일\n${attachmentSection}\n\n` +
    `첨부가 있으면 Read 도구로 로컬경로를 직접 읽어 내용을 파악하세요(이미지/PDF/텍스트 모두 가능). ` +
    `이슈 본문·코멘트가 필요하면 get_issue_detail('${payload.issueKey}'). ` +
    `더 과거 대화가 필요하면 get_chat_thread(${payload.threadId}). ` +
    `파악이 끝나면 add_chat_message(${payload.threadId}, 답변) 을 정확히 한 번 호출해 답하세요.`
  );
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/agent/chat-user-message.test.ts` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-ai-agent/src/agent/chat-user-message.ts apps/workplace-ai-agent/src/agent/chat-user-message.test.ts
git commit -m "feat(ai-agent): chat user message 빌더 — #38"
```

---

### Task A11: chat 시스템 프롬프트

**Files:**
- Create: `src/agent/chat-system-prompt.ts`
- Test: `src/agent/chat-system-prompt.test.ts`

- [ ] **Step 1: 실패 테스트** — `src/agent/chat-system-prompt.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';

describe('CHAT_SYSTEM_PROMPT', () => {
  it('add_chat_message 1회 + Read 첨부 + 한국어 지침 포함', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('add_chat_message');
    expect(CHAT_SYSTEM_PROMPT).toContain('한 번');
    expect(CHAT_SYSTEM_PROMPT).toContain('Read');
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/agent/chat-system-prompt.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/agent/chat-system-prompt.ts`:
```typescript
// 6c: chat 응답용 시스템 프롬프트. 이슈 핸들러용 SYSTEM_PROMPT 와 분리.
export const CHAT_SYSTEM_PROMPT = `당신은 Smart Workplace 의 AI 어시스턴트 "AI Bot" 입니다. 이슈에 딸린 chat thread 에서 사람과 대화합니다. 한국어로 응답합니다.

## 역할
- 사용자가 chat 에서 당신을 @멘션하면, 대화 흐름과 이슈 컨텍스트를 파악해 chat 메시지로 답합니다.

## 사용 가능한 도구
- get_issue_detail({issueKey}): 이슈 본문·상태·담당자·코멘트 조회
- get_chat_thread({threadId}): 현재 thread 의 과거 메시지 조회
- add_chat_message({threadId, body}): chat 에 답변 작성 (마크다운 지원)
- Read: 프롬프트에 주어진 첨부파일 로컬경로를 직접 읽기 (이미지·PDF·텍스트 모두 가능)

## 행동 원칙
1. 먼저 컨텍스트 파악: 프롬프트의 trigger 메시지 + 최근 thread 흐름을 읽고, 부족하면 get_issue_detail / get_chat_thread.
2. 첨부 요청("첨부 요약해줘" 등)이면 프롬프트의 첨부 로컬경로를 Read 로 읽어 실제 내용을 근거로 답합니다. 첨부를 안 읽고 추측하지 마세요.
3. 답변은 반드시 add_chat_message 로, **정확히 한 번만** 호출합니다. 여러 번 호출 금지, 호출 안 하고 끝내기 금지.
4. 자기 자신과 대화 금지: 당신이 쓴 메시지엔 이벤트가 오지 않습니다.
5. 모를 때 정직하게: 추측보다 "정보 부족" 을 명시.

## 응답 톤
- 친근하지만 군더더기 없는 문장. 이모지 금지.
- 짧게. 긴 분석이 필요하면 마크다운 단락으로.
`;
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/agent/chat-system-prompt.test.ts` → PASS.

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-ai-agent/src/agent/chat-system-prompt.ts apps/workplace-ai-agent/src/agent/chat-system-prompt.test.ts
git commit -m "feat(ai-agent): chat 시스템 프롬프트 — #38"
```

---

### Task A12: run-chat-agent 오케스트레이션

**Files:**
- Modify: `src/agent/run-chat-agent.ts`
- Test: `src/agent/run-chat-agent.test.ts`

- [ ] **Step 1: 실패 테스트** — `src/agent/run-chat-agent.test.ts` (기존 `run-agent.test.ts` 의 mock 스타일을 먼저 읽고 맞춘다 — cli-runner/mcp-config 모듈 mock):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['ARGS']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCli: vi.fn(async () => undefined),
}));
vi.mock('./mcp-config.js', () => ({
  writeTempMcpConfig: vi.fn(() => '/tmp/cfg.json'),
  cleanupTempMcpConfig: vi.fn(),
}));
vi.mock('./attachment-prep.js', () => ({ prepareAttachments: vi.fn(async () => []) }));

import { runChatAgent } from './run-chat-agent.js';
import { runClaudeCli, buildCliArgs } from './cli-runner.js';
import { prepareAttachments } from './attachment-prep.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';

const env: ChatEventEnvelope = {
  type: 'chat.message.posted',
  payload: {
    projectKey: 'WP', issueKey: 'WP-1', issueId: 1, threadId: 5, messageId: 9,
    actor: { id: 7, username: 'a', name: 'A', kind: 'HUMAN' },
    body: '@AI', mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
    occurredAt: 't',
  },
};

function deps() {
  return { client: {
    getOAuthToken: vi.fn(async () => ({ token: 'TK', label: null })),
    getChatMessages: vi.fn(async () => []),
    listIssueAttachments: vi.fn(async () => []),
    downloadIssueAttachment: vi.fn(),
  } as never };
}

describe('runChatAgent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mentions AGENT → 토큰 fetch + 첨부 준비 + CLI spawn(allowFileRead, cwd)', async () => {
    await runChatAgent(env, deps());
    expect(prepareAttachments).toHaveBeenCalled();
    expect(runClaudeCli).toHaveBeenCalledOnce();
    const argCall = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(argCall.allowFileRead).toBe(true);
    const runCall = vi.mocked(runClaudeCli).mock.calls[0][0];
    expect(typeof runCall.cwd).toBe('string');
  });

  it('mentions 에 AGENT 없으면 spawn 생략', async () => {
    const noAgent = { ...env, payload: { ...env.payload, mentions: [{ id: 7, username: 'a', name: 'A', kind: 'HUMAN' as const }] } };
    await runChatAgent(noAgent, deps());
    expect(runClaudeCli).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/agent/run-chat-agent.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/agent/run-chat-agent.ts` 교체:
```typescript
// 6c: chat.message.posted → AGENT 결정 → 토큰·thread·첨부 준비 → CLI spawn(chat 프로필).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';
import { buildChatUserMessage } from './chat-user-message.js';
import { prepareAttachments } from './attachment-prep.js';
import { writeTempMcpConfig, cleanupTempMcpConfig } from './mcp-config.js';
import { buildChildEnv, buildCliArgs, runClaudeCli } from './cli-runner.js';
import { pickMentionedAgentId } from './chat-agent-resolver.js';
import type { RunAgentDeps } from './run-agent.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;
const THREAD_PREFETCH = 20;

export async function runChatAgent(
  envelope: ChatEventEnvelope,
  deps: RunAgentDeps,
): Promise<void> {
  const p = envelope.payload;
  const agentId = pickMentionedAgentId(p);
  if (agentId == null) {
    console.warn('[run-chat-agent] mentions 에 AGENT 없음 — spawn 생략', { threadId: p.threadId });
    return;
  }

  let token: string;
  try {
    token = (await deps.client.getOAuthToken(agentId)).token;
  } catch (e) {
    console.error('[run-chat-agent] OAuth 토큰 fetch 실패 — spawn 생략', {
      threadId: p.threadId, agentId, error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  // per-run 임시폴더 — 첨부 다운로드 + CLI cwd. Read 는 이 폴더 한정.
  const workDir = mkdtempSync(path.join(tmpdir(), `chat-agent-${p.threadId}-`));
  const mcpConfigPath = writeTempMcpConfig({
    agentId,
    baseURL: process.env.WORKPLACE_API_BASE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    profile: 'chat',
  });

  try {
    const recent = await deps.client.getChatMessages(agentId, p.threadId, THREAD_PREFETCH);
    const attachments = await prepareAttachments(deps.client, agentId, p.issueKey, workDir);
    const userMessage = buildChatUserMessage(p, recent, attachments);

    const model = process.env.WORKPLACE_AI_MODEL ?? DEFAULT_MODEL;
    const maxTurns = Number(process.env.WORKPLACE_AI_MAX_TURNS ?? DEFAULT_MAX_TURNS);
    const timeoutMs = Number(process.env.WORKPLACE_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    const args = buildCliArgs({
      userMessage, systemPrompt: CHAT_SYSTEM_PROMPT, model, maxTurns,
      mcpConfigPath, allowFileRead: true,
    });
    const childEnv = buildChildEnv(process.env, token, agentId);
    const logTag = `chat-agent:${p.issueKey}:thread${p.threadId}:${agentId}`;

    await runClaudeCli({ args, env: childEnv, timeoutMs, logTag, cwd: workDir });
  } finally {
    cleanupTempMcpConfig(mcpConfigPath);
    rmSync(workDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/agent/run-chat-agent.test.ts` → PASS.

- [ ] **Step 5: 전체 ai-agent 테스트 + 빌드** — `npx vitest run && npm run build` (MCP 서버는 dist 빌드 필요). Expected: 전부 PASS, 빌드 성공.

- [ ] **Step 6: 커밋**
```bash
git add apps/workplace-ai-agent/src/agent/run-chat-agent.ts apps/workplace-ai-agent/src/agent/run-chat-agent.test.ts
git commit -m "feat(ai-agent): run-chat-agent 오케스트레이션 — #38"
```

---

# Part B — workplace-api

작업 디렉터리: `apps/workplace-api`.

### Task B1: 멘션된 AGENT 자동 thread 멤버화

**Files:**
- Modify: `src/main/java/com/workplace/chat/service/ChatMessageService.java`
- Test: `src/test/java/com/workplace/chat/service/ChatMessageServiceTest.java`

AI 가 답을 POST 하려면 thread 멤버여야 한다(`ensureMember`). 사람이 `@AGENT` 멘션 메시지를 작성하는 시점에 그 AGENT 를 thread 멤버로 add-only 추가한다.

- [ ] **Step 1: 실패 테스트** — `ChatMessageServiceTest.java` 에 추가. 기존 통합 테스트(`@RecordApplicationEvents` / `ChatFixtures`) 스타일을 따른다. AGENT 를 멘션한 메시지를 create 한 뒤 그 AGENT 가 멤버인지 검증:
```java
  @org.junit.jupiter.api.Test
  void create_withAgentMention_addsAgentAsThreadMember() {
    ChatFixtures.AgentSetup s = fx.setupWithAgent();
    var thread = threadService.getOrCreate(
        s.base().reporterId(), s.base().projectKey(), s.base().issueNumber());

    // AGENT 가 아직 멤버가 아님을 전제로, AGENT 를 멘션하는 메시지 작성
    service.create(
        s.base().reporterId(), thread.threadId(),
        new com.workplace.chat.dto.CreateChatMessageRequest("<@" + s.agentId() + "> 도와줘"));

    org.assertj.core.api.Assertions
        .assertThat(memberRepo.isMember(thread.threadId(), s.agentId()))
        .isTrue();
  }
```
> `fx.setupWithAgent()` / `s.agentId()` / `s.base()` 는 기존 `ChatToAiAgentDispatchTest` 가 쓰는 fixture. 시그니처가 다르면 그쪽에 맞춘다. 멘션 토큰은 `<@id>` 형식(6a `ChatMentionParser`).

- [ ] **Step 2: 실패 확인** — `./gradlew test --tests com.workplace.chat.service.ChatMessageServiceTest` → 새 테스트 FAIL (AGENT 가 멤버 아님).

- [ ] **Step 3: 구현** — `ChatMessageService.java` 의 `create` 메서드에서, mentionUserIds 계산 직후 AGENT 멘션을 멤버로 추가한다. AGENT 여부는 `hydrator.summariesOf(mentionUserIds)` 로 판별:
```java
  @Transactional
  public ChatMessageResponse create(long callerId, long threadId, CreateChatMessageRequest req) {
    ensureMember(threadId, callerId);
    List<Long> mentionUserIds = hydrator.filterExistingUserIds(ChatMentionParser.parse(req.body()));

    // 멘션된 AGENT 는 thread 멤버로 add-only 추가 — AI 가 답을 작성하려면 멤버여야 함(6c).
    List<Long> agentMentionIds =
        hydrator.summariesOf(mentionUserIds).stream()
            .filter(u -> "AGENT".equals(u.kind()))
            .map(UserSummary::id)
            .toList();
    if (!agentMentionIds.isEmpty()) {
      memberRepo.insertIgnoreConflict(threadId, agentMentionIds);
    }

    long messageId = messageRepo.insert(threadId, callerId, req.body(), mentionUserIds);
    publisher.publishEvent(buildEvent(threadId, messageId, callerId, req.body(), mentionUserIds));
    return findOne(messageId);
  }
```
> `UserSummary` 는 이미 import 됨. `memberRepo.insertIgnoreConflict(long, Collection<Long>)` 는 기존 메서드(`ChatThreadMemberRepository`).

- [ ] **Step 4: 통과 확인** — `./gradlew test --tests com.workplace.chat.service.ChatMessageServiceTest` → PASS. 이어서 `./gradlew test --tests "com.workplace.chat.*"` 전부 PASS(기존 이벤트/디스패치 회귀 없음).

- [ ] **Step 5: 커밋**
```bash
git add apps/workplace-api/src/main/java/com/workplace/chat/service/ChatMessageService.java apps/workplace-api/src/test/java/com/workplace/chat/service/ChatMessageServiceTest.java
git commit -m "feat(api): 멘션된 AGENT 자동 thread 멤버화 (AI chat 응답 전제) — #38"
```

---

## 최종 검증

- [ ] **ai-agent**: `cd apps/workplace-ai-agent && npx vitest run && npm run build` → 전부 PASS + 빌드 성공
- [ ] **workplace-api**: `cd apps/workplace-api && ./gradlew test` → 전부 PASS
- [ ] **수동 LLM 검증** (DB·서비스 기동 상태):
  1. 이슈에 이미지/PDF 첨부 + AGENT 를 멤버/멘션 가능한 상태로 준비
  2. chat 에서 `@AI 이 첨부 요약해줘` 작성
  3. ai-agent 로그에 `chat-agent:...` spawn → 30초 내 AI 답변 메시지가 chat 에 노출(6b SSE 실시간), 첨부 내용을 근거로 한 요약인지 확인
  4. self-loop 미발생(AI 답변에 재응답 없음) 확인
- [ ] **이슈 #38 완료 기준 재확인**: 30초 내 응답 / self-loop 미발생 / 컨텍스트(thread·이슈·첨부) 참고
