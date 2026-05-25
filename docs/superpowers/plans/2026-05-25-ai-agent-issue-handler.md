# ai-agent 이벤트 핸들러 + workplace-api 코멘트 응답 Implementation Plan (5c-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** workplace-ai-agent 가 5b-1 의 4종 envelope 을 type 별로 분기해 workplace-api 의 `POST /api/v1/projects/{key}/issues/{number}/comments` 로 한국어 acknowledgment 코멘트를 작성한다. LLM 없음. workplace-api · 프론트 변경 없음.

**Architecture:** zod discriminatedUnion 으로 payload 재검증 → switch 4 case → 핸들러가 ack 텍스트 빌드 → `workplaceApi.addIssueComment` (axios POST + X-Api-Key). closure 없이 client 를 첫 인자로 받는 함수형 핸들러.

**Tech Stack:** TS ES2022 NodeNext / Express 4 / Zod 4 (discriminatedUnion) / axios / Vitest 4 + supertest + nock

---

## 커밋 정책

각 task 는 파일 변경만 수행. **마지막 Task 6 에서 단일 commit**:
```
feat(ai-agent): 이슈 이벤트 핸들러 + workplace-api 코멘트 응답 — #30 (5c-1)
```

## File Structure

신규 (`apps/workplace-ai-agent/src/`):
```
types/
└── issue-events.ts          # zod payload 스키마 4종 + discriminatedUnion + TS 타입
agent/
├── event-handler.ts         # 4 핸들러 함수 (client 첫 인자)
└── event-handler.test.ts
clients/
└── workplace-api.test.ts    # nock + parseIssueKey 단위
```

수정:
- `src/clients/workplace-api.ts` — `addIssueComment` 본문 + `parseIssueKey` export
- `src/routes/events.ts` — payload 재검증 + switch 4 case
- `src/routes/events.test.ts` — 케이스 ④ unknown type 명 교체 + 2 신규
- `src/index.ts` — `createWorkplaceApiClient` 인스턴스 생성, eventsRouter 가 client 참조

`package.json`: devDependencies 에 `nock` 추가.

---

## Task 1: payload 스키마 (types/issue-events.ts)

**Files:**
- Create: `apps/workplace-ai-agent/src/types/issue-events.ts`

- [ ] **Step 1: 파일 작성**

```ts
// 5b-1 이 발사하는 이슈 도메인 이벤트 envelope 의 zod 스키마.
// envelope-only 검증(events.ts) 통과 후 type 별 payload 형태를 재검증한다.
import { z } from 'zod';

const userSummary = z.object({
  id: z.number(),
  username: z.string(),
  kind: z.enum(['HUMAN', 'AGENT']),
});

// 모든 이벤트 공통 — issue 식별·actor·assignees·발생 시각.
const common = {
  projectKey: z.string(),
  issueKey: z.string(),
  issueId: z.number(),
  issueTitle: z.string(),
  actor: userSummary,
  assignees: z.array(userSummary),
  occurredAt: z.string(),
};

export const issueCreatedPayload = z.object({
  ...common,
  status: z.string(),
  priority: z.string(),
});

export const issueAssignedPayload = z.object({
  ...common,
  added: z.array(userSummary),
  removed: z.array(userSummary),
});

export const issueCommentedPayload = z.object({
  ...common,
  commentId: z.number(),
  commentBody: z.string(),
});

export const issueStatusChangedPayload = z.object({
  ...common,
  previousStatus: z.string(),
  newStatus: z.string(),
});

// type 별 분기를 zod 가 알아채도록 discriminatedUnion.
export const issueEventEnvelope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('issue.created'), payload: issueCreatedPayload }),
  z.object({ type: z.literal('issue.assigned'), payload: issueAssignedPayload }),
  z.object({ type: z.literal('issue.commented'), payload: issueCommentedPayload }),
  z.object({
    type: z.literal('issue.status_changed'),
    payload: issueStatusChangedPayload,
  }),
]);

export type IssueCreatedPayload = z.infer<typeof issueCreatedPayload>;
export type IssueAssignedPayload = z.infer<typeof issueAssignedPayload>;
export type IssueCommentedPayload = z.infer<typeof issueCommentedPayload>;
export type IssueStatusChangedPayload = z.infer<typeof issueStatusChangedPayload>;
export type IssueEventEnvelope = z.infer<typeof issueEventEnvelope>;

// 본 ai-agent 가 처리하는 알려진 type 들의 prefix — invalid_payload 와
// unsupported_event_type 분기에 사용.
export const KNOWN_TYPE_PREFIX = 'issue.';
```

- [ ] **Step 2: typecheck 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent typecheck
```
기대: 에러 없음.

---

## Task 2: event-handler.ts (TDD)

**Files:**
- Create: `apps/workplace-ai-agent/src/agent/event-handler.ts`
- Create: `apps/workplace-ai-agent/src/agent/event-handler.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/workplace-ai-agent/src/agent/event-handler.test.ts`:

```ts
// 4 type 별 acknowledgment 핸들러 검증.
// client 는 vi.fn 으로 모킹 — workplace-api 호출은 client.test.ts 가 검증.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import {
  handleIssueAssigned,
  handleIssueCommented,
  handleIssueCreated,
  handleIssueStatusChanged,
} from './event-handler.js';

function mockClient(): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn(),
  };
}

const baseCommon = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
};

describe('event-handler', () => {
  let client: WorkplaceApiClient;

  beforeEach(() => {
    client = mockClient();
  });

  it('handleIssueCreated → ack 코멘트', async () => {
    await handleIssueCreated(client, {
      ...baseCommon,
      status: 'TODO',
      priority: 'MID',
    });
    expect(client.addIssueComment).toHaveBeenCalledOnce();
    const [issueKey, body] = (client.addIssueComment as any).mock.calls[0];
    expect(issueKey).toBe('WP-42');
    expect(body).toContain('새 이슈 생성을 확인했습니다 — WP-42 "분석"');
    expect(body).toContain('_(자동 응답)_');
  });

  it('handleIssueAssigned → ack 코멘트', async () => {
    await handleIssueAssigned(client, {
      ...baseCommon,
      added: baseCommon.assignees,
      removed: [],
    });
    const [issueKey, body] = (client.addIssueComment as any).mock.calls[0];
    expect(issueKey).toBe('WP-42');
    expect(body).toContain('작업을 맡았습니다 — WP-42');
  });

  it('handleIssueCommented → actor username + commentBody 포함', async () => {
    await handleIssueCommented(client, {
      ...baseCommon,
      commentId: 99,
      commentBody: '확인 부탁해요',
    });
    const [, body] = (client.addIssueComment as any).mock.calls[0];
    expect(body).toContain('코멘트 확인했습니다 (by @alice)');
    expect(body).toContain('확인 부탁해요');
  });

  it('handleIssueCommented → 80자 초과 commentBody 는 80자 + …', async () => {
    const long = 'x'.repeat(100);
    await handleIssueCommented(client, {
      ...baseCommon,
      commentId: 99,
      commentBody: long,
    });
    const [, body] = (client.addIssueComment as any).mock.calls[0];
    // 80자 + ellipsis
    expect(body).toContain('x'.repeat(80) + '…');
    // 100자 그대로는 포함하지 않음
    expect(body).not.toContain('x'.repeat(100));
  });

  it('handleIssueStatusChanged → previous → new 포함', async () => {
    await handleIssueStatusChanged(client, {
      ...baseCommon,
      previousStatus: 'TODO',
      newStatus: 'IN_PROGRESS',
    });
    const [, body] = (client.addIssueComment as any).mock.calls[0];
    expect(body).toContain('상태 변경 확인 — TODO → IN_PROGRESS');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test src/agent/event-handler.test.ts
```
기대: FAIL — `Cannot find module './event-handler.js'`

- [ ] **Step 3: 핸들러 구현**

`apps/workplace-ai-agent/src/agent/event-handler.ts`:

```ts
// 4 type 별 acknowledgment 핸들러. LLM 없이 단순 한국어 텍스트로 응답한다.
// 5c-2 가 LLM 도입 시 본 파일을 갈아끼우거나 ack 분기를 옵션화한다.
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type {
  IssueAssignedPayload,
  IssueCommentedPayload,
  IssueCreatedPayload,
  IssueStatusChangedPayload,
} from '../types/issue-events.js';

// 5c-1 단계임을 명시하는 접미사 — 5c-2 LLM 도입 시 제거 예정.
const SUFFIX = ' _(자동 응답)_';
const COMMENT_BODY_TRUNCATE = 80;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export async function handleIssueCreated(
  client: WorkplaceApiClient,
  p: IssueCreatedPayload,
): Promise<void> {
  const body = `새 이슈 생성을 확인했습니다 — ${p.issueKey} "${p.issueTitle}"${SUFFIX}`;
  await safeCall(client, p.issueKey, body);
}

export async function handleIssueAssigned(
  client: WorkplaceApiClient,
  p: IssueAssignedPayload,
): Promise<void> {
  const body = `작업을 맡았습니다 — ${p.issueKey}. 곧 진행하겠습니다.${SUFFIX}`;
  await safeCall(client, p.issueKey, body);
}

export async function handleIssueCommented(
  client: WorkplaceApiClient,
  p: IssueCommentedPayload,
): Promise<void> {
  const snippet = truncate(p.commentBody, COMMENT_BODY_TRUNCATE);
  const body = `코멘트 확인했습니다 (by @${p.actor.username}): "${snippet}"${SUFFIX}`;
  await safeCall(client, p.issueKey, body);
}

export async function handleIssueStatusChanged(
  client: WorkplaceApiClient,
  p: IssueStatusChangedPayload,
): Promise<void> {
  const body = `상태 변경 확인 — ${p.previousStatus} → ${p.newStatus}${SUFFIX}`;
  await safeCall(client, p.issueKey, body);
}

// workplace-api 호출 실패는 swallow — 이벤트 자체는 받았으니 발신자에게
// 202 를 유지한다. 재시도는 5b-1 의 발사 측이 책임.
async function safeCall(
  client: WorkplaceApiClient,
  issueKey: string,
  body: string,
): Promise<void> {
  try {
    await client.addIssueComment(issueKey, body);
  } catch (e) {
    console.error('[event-handler] addIssueComment 실패:', { issueKey, error: e });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test src/agent/event-handler.test.ts
```
기대: 5 passed.

---

## Task 3: workplace-api client 본문 + parseIssueKey (TDD)

**Files:**
- Modify: `apps/workplace-ai-agent/src/clients/workplace-api.ts`
- Create: `apps/workplace-ai-agent/src/clients/workplace-api.test.ts`
- Modify: `apps/workplace-ai-agent/package.json` (nock 추가)

- [ ] **Step 1: nock 의존성 추가**

```bash
cd apps/workplace-ai-agent && pnpm add -D nock@^14.0.11
```
기대: package.json devDependencies 에 `nock` 추가, lockfile 갱신.

- [ ] **Step 2: 실패하는 테스트 작성**

`apps/workplace-ai-agent/src/clients/workplace-api.test.ts`:

```ts
// workplace-api client — POST /comments 흐름 + parseIssueKey 정책 검증.
import { afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';

import { createWorkplaceApiClient, parseIssueKey } from './workplace-api.js';

afterEach(() => {
  nock.cleanAll();
});

describe('parseIssueKey', () => {
  it('WP-42 → projectKey=WP, number=42', () => {
    expect(parseIssueKey('WP-42')).toEqual({ projectKey: 'WP', number: 42 });
  });

  it('A-B-7 → projectKey=A-B, number=7 (lastIndexOf 정책)', () => {
    expect(parseIssueKey('A-B-7')).toEqual({ projectKey: 'A-B', number: 7 });
  });
});

describe('createWorkplaceApiClient', () => {
  const BASE = 'http://api.test';
  const PREFIX = '/api/v1';

  it('addIssueComment → POST /projects/{key}/issues/{number}/comments + X-Api-Key 헤더', async () => {
    const scope = nock(BASE)
      .matchHeader('x-api-key', 'test-key')
      .post(`${PREFIX}/projects/WP/issues/42/comments`, { body: '안녕' })
      .reply(201, {});

    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'test-key',
    });
    await c.addIssueComment('WP-42', '안녕');

    expect(scope.isDone()).toBe(true);
  });

  it('updateIssueStatus 는 5c-1 에서 여전히 throw', async () => {
    const c = createWorkplaceApiClient({
      baseURL: `${BASE}${PREFIX}`,
      apiKey: 'k',
    });
    await expect(c.updateIssueStatus('WP-1', 'DONE')).rejects.toThrow(
      /not implemented|미구현/,
    );
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test src/clients/workplace-api.test.ts
```
기대: FAIL — `parseIssueKey` export 없음, 또는 addIssueComment 가 throw.

- [ ] **Step 4: client 구현**

`apps/workplace-ai-agent/src/clients/workplace-api.ts` 전체 교체:

```ts
// workplace-api 호출용 axios 인스턴스. AGENT API key 인증.
// addIssueComment 는 5c-1 에서 본문 구현. updateIssueStatus 는 5c-2 영역.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';

export interface WorkplaceApiClient {
  // 이슈에 코멘트 작성 — AGENT 권한 (Phase 5c-1).
  addIssueComment(issueKey: string, body: string): Promise<void>;
  // 이슈 상태 변경 — Phase 5c-2 에서 본문 구현 예정.
  updateIssueStatus(issueKey: string, statusKey: string): Promise<void>;
}

// issueKey("WP-42" / "A-B-7") → workplace-api URL 부품. projectKey 에
// 하이픈이 들어갈 수 있어 lastIndexOf 로 분리.
export function parseIssueKey(issueKey: string): {
  projectKey: string;
  number: number;
} {
  const idx = issueKey.lastIndexOf('-');
  return {
    projectKey: issueKey.slice(0, idx),
    number: Number(issueKey.slice(idx + 1)),
  };
}

const NOT_IMPL_UPDATE =
  'updateIssueStatus 는 5c-1 단계에서 미구현 — Phase 5c-2 에서 채움';

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  apiKey: string;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { 'X-Api-Key': opts.apiKey },
  });

  return {
    async addIssueComment(issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.post(`/projects/${projectKey}/issues/${number}/comments`, {
        body,
      });
    },
    async updateIssueStatus(_issueKey, _statusKey) {
      throw new Error(NOT_IMPL_UPDATE);
    },
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test src/clients/workplace-api.test.ts
```
기대: 4 passed.

---

## Task 4: events.ts switch 4 case + payload 재검증 + 테스트 갱신

**Files:**
- Modify: `apps/workplace-ai-agent/src/routes/events.ts`
- Modify: `apps/workplace-ai-agent/src/routes/events.test.ts`

- [ ] **Step 1: events.ts 재작성**

`apps/workplace-ai-agent/src/routes/events.ts` 전체 교체:

```ts
// 이벤트 수신 엔드포인트 — workplace-api 가 도메인 이벤트를 푸시한다.
// envelope({type, payload}) 검증 후 type 별 핸들러 분기 (5c-1).
// 알려진 issue.* 인데 payload 형태가 맞지 않으면 invalid_payload,
// 그 외 type 은 unsupported_event_type.
import { Router } from 'express';
import { z } from 'zod';

import {
  handleIssueAssigned,
  handleIssueCommented,
  handleIssueCreated,
  handleIssueStatusChanged,
} from '../agent/event-handler.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import {
  KNOWN_TYPE_PREFIX,
  issueEventEnvelope,
} from '../types/issue-events.js';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

export function createEventsRouter(client: WorkplaceApiClient): Router {
  const router = Router();

  router.post('/events', async (req, res) => {
    const envelope = envelopeSchema.safeParse(req.body);
    if (!envelope.success) {
      res
        .status(400)
        .json({ error: 'invalid_payload', issues: envelope.error.issues });
      return;
    }

    const { type } = envelope.data;

    const parsed = issueEventEnvelope.safeParse(req.body);
    if (!parsed.success) {
      // 알려진 prefix 면 payload 형태가 잘못된 것 → invalid_payload
      if (type.startsWith(KNOWN_TYPE_PREFIX)) {
        res
          .status(400)
          .json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      // 그 외 type 은 아예 미지원
      res.status(400).json({ error: 'unsupported_event_type', type });
      return;
    }

    const ev = parsed.data;
    try {
      switch (ev.type) {
        case 'issue.created':
          await handleIssueCreated(client, ev.payload);
          break;
        case 'issue.assigned':
          await handleIssueAssigned(client, ev.payload);
          break;
        case 'issue.commented':
          await handleIssueCommented(client, ev.payload);
          break;
        case 'issue.status_changed':
          await handleIssueStatusChanged(client, ev.payload);
          break;
      }
    } catch (e) {
      // 핸들러 내부 실패는 이미 swallow 됐어야 함. 그래도 안전망.
      console.error('[events] handler 예외:', e);
    }

    res.status(202).json({ received: true });
  });

  return router;
}
```

- [ ] **Step 2: events.test.ts 갱신**

`apps/workplace-ai-agent/src/routes/events.test.ts` 전체 교체:

```ts
// POST /events — envelope 검증 + payload 재검증 + 4 type 핸들러 분기.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { internalAuth } from '../middleware/internal-auth.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { createEventsRouter } from './events.js';

function mockClient(): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn(),
  };
}

function buildApp(client: WorkplaceApiClient) {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, createEventsRouter(client));
  return app;
}

const VALID = 'test-token-12345';
const AUTH = `Internal ${VALID}`;

const validCreatedPayload = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' }],
  occurredAt: '2026-05-25T12:00:00Z',
  status: 'TODO',
  priority: 'MID',
};

describe('POST /events', () => {
  let client: WorkplaceApiClient;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    client = mockClient();
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    vi.restoreAllMocks();
  });

  it('인증 없음 → 401', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(401);
  });

  it('envelope 누락(type 없음) → 400 invalid_payload', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .set('Authorization', AUTH)
      .send({ payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('알 수 없는 type → 400 unsupported_event_type', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'wiki.created', payload: { foo: 'bar' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'unsupported_event_type',
      type: 'wiki.created',
    });
  });

  it('issue.assigned payload 의 added 누락 → 400 invalid_payload', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .set('Authorization', AUTH)
      .send({
        type: 'issue.assigned',
        payload: {
          ...validCreatedPayload,
          removed: [],
          // added 누락
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('issue.created 정상 → 202 + addIssueComment 1회', async () => {
    const res = await request(buildApp(client))
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: true });
    expect(client.addIssueComment).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: 테스트 통과 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent test src/routes/events.test.ts
```
기대: 5 passed (인증 1 + envelope 누락 1 + unsupported 1 + invalid_payload 1 + 정상 1).

---

## Task 5: index.ts wire-up

**Files:**
- Modify: `apps/workplace-ai-agent/src/index.ts`

- [ ] **Step 1: index.ts 갱신**

`apps/workplace-ai-agent/src/index.ts` 전체 교체:

```ts
// Express 부트 — 미들웨어 → /health → /events → 전역 에러 핸들러 → graceful shutdown.
// 5c-1 부터 events 라우터가 workplace-api client 를 주입받는다.
import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';

import { createWorkplaceApiClient } from './clients/workplace-api.js';
import { DEFAULT_PORT } from './constants.js';
import { internalAuth } from './middleware/internal-auth.js';
import { healthRouter } from './routes/health.js';
import { createEventsRouter } from './routes/events.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

// workplace-api 호출용 client — AGENT API key 로 인증.
const workplaceApi = createWorkplaceApiClient({
  baseURL: process.env.WORKPLACE_API_BASE_URL,
  apiKey: process.env.WORKPLACE_AGENT_API_KEY ?? '',
});

app.use(express.json());

// /health 는 인증 없이 노출 — k8s 프로브 등을 가정.
app.use(healthRouter);
// /events 는 사내 서비스 인증 필수.
app.use(internalAuth, createEventsRouter(workplaceApi));

// 전역 에러 핸들러 — 라우트에서 처리 못 한 throw 의 안전망.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ai-agent] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(PORT, () => {
  console.log(`workplace-ai-agent listening on :${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /events`);
});

// SIGTERM/SIGINT 시 진행 중 요청 5초 대기 후 강제 종료.
function shutdown(signal: string) {
  console.log(`[ai-agent] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 2: typecheck + build 확인**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent typecheck
pnpm --filter @smart-workplace/workplace-ai-agent build
```
기대: 둘 다 에러 없음. `dist/index.js` 생성.

---

## Task 6: 전체 검증 + 수동 e2e + 단일 commit

- [ ] **Step 1: lint + typecheck + test + build**

```bash
pnpm --filter @smart-workplace/workplace-ai-agent lint
pnpm --filter @smart-workplace/workplace-ai-agent typecheck
pnpm --filter @smart-workplace/workplace-ai-agent test
pnpm --filter @smart-workplace/workplace-ai-agent build
```
기대: 모두 PASS. vitest 약 24 PASS (auth 5 + health 1 + events 5 + event-handler 5 + workplace-api client 4 = 20 + alpha; 정확한 수는 출력 참고).

- [ ] **Step 2: workplace-api 회귀 확인**

```bash
cd apps/workplace-api && ./gradlew test
```
기대: 기존 412 PASS (workplace-api 변경 0이라 회귀 없음).

- [ ] **Step 3: 루트 turbo 파이프라인**

```bash
cd /Users/bluleo78/git/smart-workplace
pnpm test
```
기대: 모두 통과.

- [ ] **Step 4: 수동 end-to-end (가능한 경우)**

> 이 단계는 실제 환경에서 직접 검증. 자동화 불가능한 부분이라 best-effort.

1. workplace-api 9090 기동 (`pnpm --filter @smart-workplace/workplace-api dev`).
2. workplace-web 로 admin 로그인 → `/admin/agents` → AGENT 유저 생성 → API key 발급. 평문 키 (예: `ak_xxxxx`) 복사.
3. workplace-ai-agent 기동:
   ```bash
   INTERNAL_SERVICE_TOKEN=changeme-local \
   WORKPLACE_AGENT_API_KEY=<복사한 ak_xxxxx> \
   WORKPLACE_AI_AGENT_TOKEN=changeme-local \
   pnpm --filter @smart-workplace/workplace-ai-agent dev &
   ```
4. workplace-web 에서 일반 사용자로 로그인 → 프로젝트 → 위 AGENT 유저를 프로젝트 멤버로 추가 → 그 AGENT 를 assignee 로 한 이슈 생성.
5. 이슈 상세 새로고침 → 코멘트 목록에 AGENT 가 작성한 acknowledgment 코멘트 2개 (issue.created + issue.assigned) 보임.
6. 사용자가 코멘트 추가 → 잠시 후 AGENT 의 `코멘트 확인했습니다 (by @...)` 응답 코멘트 보임.
7. self-loop 차단 확인: AGENT 가 작성한 응답 코멘트로 인해 추가 코멘트가 발생하지 않음 (단 1회 응답).

> 환경 구성이 어려우면 skip — 단위·통합 테스트로 의미 검증됨. 수동 미실시 사유 보고.

- [ ] **Step 5: git status 점검**

```bash
git status
git diff --stat
```
기대:
- 신규: `src/types/issue-events.ts`, `src/agent/event-handler.ts`, `src/agent/event-handler.test.ts`, `src/clients/workplace-api.test.ts`, plan markdown
- 수정: `src/routes/events.ts`, `src/routes/events.test.ts`, `src/clients/workplace-api.ts`, `src/index.ts`, `package.json`, `pnpm-lock.yaml`

- [ ] **Step 6: 단일 커밋**

```bash
git add apps/workplace-ai-agent docs/superpowers/plans/2026-05-25-ai-agent-issue-handler.md pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(ai-agent): 이슈 이벤트 핸들러 + workplace-api 코멘트 응답 — #30 (5c-1)

- types/issue-events.ts: zod discriminatedUnion 4 type payload 스키마
- agent/event-handler.ts: 4 type 별 한국어 acknowledgment 텍스트 생성·발사
- clients/workplace-api.ts: addIssueComment 본문 + parseIssueKey 헬퍼
  (updateIssueStatus 는 5c-2 영역, throw 유지)
- routes/events.ts: payload 재검증 (discriminatedUnion) + 4 case 분기
- index.ts: createEventsRouter 에 client 주입
- 단위 테스트: event-handler 5 + workplace-api client 4 + events 5 = 14
- workplace-api·workplace-web 변경 0
EOF
)"
```

기대: pre-commit hook 통과, commit 완료.

- [ ] **Step 7: git log 확인**

```bash
git log --oneline -3
```
기대: 가장 최근 commit 이 본 task 의 메시지.

---

## Self-Review

**Spec coverage:**
- 4 type 별 acknowledgment 텍스트 — Task 2 ✅
- payload discriminatedUnion 재검증 — Task 1 + Task 4 ✅
- workplace-api `addIssueComment` 본문 — Task 3 ✅
- `parseIssueKey` 헬퍼 + lastIndexOf 정책 — Task 3 ✅
- `updateIssueStatus` 5c-1 throw 유지 — Task 3 ✅
- `events.ts` switch 4 case — Task 4 ✅
- `events.test.ts` 갱신 (unsupported type 명 교체) + 신규 케이스 — Task 4 ✅
- `index.ts` wire-up — Task 5 ✅
- workplace-api · 프론트엔드 변경 0 — Task 전반 ✅
- 자동 응답 접미사 — Task 2 ✅
- commentBody 80자 truncate — Task 2 ✅
- DoD 수동 e2e — Task 6 Step 4 ✅
- 단일 commit — Task 6 ✅

**Placeholder scan:** 수동 e2e "best-effort" 외에는 구체 코드/명령.

**Type consistency:** `WorkplaceApiClient`, `createWorkplaceApiClient`, `parseIssueKey`, `createEventsRouter`, `handleIssue*`, `IssueEventEnvelope`, `KNOWN_TYPE_PREFIX` 모든 사용처 일치.
